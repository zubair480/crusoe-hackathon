# @thermaldesk/coordination

Repair coordinator for ThermalDesk. It owns the canonical repair-job state, the persisted
event history and the external action adapters. Owner: Isaac.

Every supplier, messaging and schedule adapter shipped here is **simulated**. No supplier,
technician, manager or workbook is contacted.

A job runs on one of two runtimes, recorded with the job: `job_queue` (baseline) or `band`.
The Band runtime is implemented and has run on Band: on 2026-09-29 the five registered agents
took the fictional job `JOB-001` from kickoff to a confirmed booking and a report in a Band
room. Suppliers, messaging and the schedule stayed simulated in that run.

## Setup

Requires Node.js 20 or newer.

```bash
cd packages/coordination
npm install --no-package-lock   # Zubair owns the shared lockfile
npm test                        # type-check, build, 26 tests
npm run demo                    # baseline: a happy-path and an exception trace
npm run band:demo               # the crew in a SIMULATED room
npm run band:check              # is agent_config.yaml complete?
npm run band                    # connect the crew to Band (needs credentials)
npm run band:accept -- JOB-001  # record a SIMULATED technician acceptance
```

## Public API

All operations are async and return the v1 `RepairJob` data object with the exact
snake_case names of `contracts/v1.schema.json`.

```ts
createRepairJob(
  input: { recommendation: Recommendation; authority: Authority | null;
           job_id?: string; requirements?: Partial<JobRequirements> },
  context: CoordinationContext
): Promise<RepairJob>

advanceRepairJob(job_id: string, event: WorkflowEvent, context: CoordinationContext): Promise<RepairJob>

coordinateRepair(
  job_id: string, adapters: CoordinationAdapters, context: CoordinationContext,
  options?: { current_recommendation?: Recommendation }
): Promise<RepairJob>

processDueFollowUps(adapters, context): Promise<FollowUpResult[]>
runWorkerTick(adapters, context): Promise<WorkerTickResult>
getRepairJob(job_id, context): Promise<RepairJob>
getJobDetail(job_id, context): Promise<JobDetail>       // why a job waits, what is due
getJobTimeline(job_id, context): Promise<TimelineEvent[]> // the report timeline
listRepairJobs(context): Promise<RepairJob[]>
```

`context` is `{ repository, clock?, config? }`. `adapters` is
`{ suppliers, roster, communication, schedule, manager }`; pass `null` for an absent adapter
and the coordinator records `not_configured` instead of pretending.

## Wiring it into the shared app

```ts
import {
  createFileJobRepository, createRepairJob, advanceRepairJob, coordinateRepair, runWorkerTick,
} from '@thermaldesk/coordination';

const context = {
  repository: createFileJobRepository({ directory: process.env.COORDINATION_DATA_DIR! }),
};
const adapters = { suppliers, roster, communication, schedule: { mode, syncSchedule }, manager };

const job = await createRepairJob({ recommendation, authority }, context);
await coordinateRepair(job.job_id, adapters, context);              // after creation
await advanceRepairJob(job.job_id, event, context);                 // from a route or webhook
await coordinateRepair(job.job_id, adapters, context);              // does the work the event left
setInterval(() => runWorkerTick(adapters, context), 60_000);        // follow-ups
```

`advanceRepairJob` only changes state. External actions run in `coordinateRepair` and in the
worker, so an event handler never buys, books or notifies by itself.

To use another store, implement `JobRepository` (`insert`, `load`, `save`, `list`). `save`
must be a compare-and-swap on `job.state_version`.

## Workflow events

Each event carries a caller-supplied `event_id`. Re-sending it returns the stored outcome.
The same id with a different payload raises `event_id_conflict`. An event a business rule
refuses is written to the history as rejected, changes nothing else and raises
`EventRejectedError` with a `code`.

| `type` | Payload |
|---|---|
| `authority_configured` | `authority` |
| `recommendation_revised` | `recommendation` |
| `recommendation_approved` | `recommendation` |
| `technician_responded` | `technician_id`, `response`, `response_reference`, `mode` |
| `technician_cancelled` | `technician_id`, `reason` |
| `parts_order_updated` | `part_id`, `order_status`, `estimated_delivery_at?` |
| `work_started` | `technician_id` |
| `completion_evidence_received` | `completion` |
| `verification_draft_received` | `verification` |
| `closure_review_recorded` | `review` |
| `exception_approved` | `exception: 'schedule_before_parts'`, `approved_by`, `reason` |
| `job_cancelled` | `cancelled_by`, `reason` |

## Rules the coordinator enforces

- **Approval.** A job is created only from an approved recommendation whose approval names
  its exact version. A hash of the scope and parts detects a change under an unchanged
  version number. A changed scope stops purchases, outreach and bookings until a new
  approval arrives.
- **Authority.** Each action needs an unexpired authority that allows its action type. A
  simulated approval or authority covers only simulated adapters.
- **Parts.** Only the approved part and quantity are ordered, from the injected suppliers.
  A substitution or a missing specification goes to the reviewer and is never accepted.
  Price, availability, delivery estimate and purchase outcome are stored separately.
- **Technicians.** The shortlist comes from the injected roster and is ranked by supplied
  qualifications, approved sites, availability and distance. Offers go out one at a time.
- **Booking.** The technician's reply is the evidence of the booking. A job is `scheduled`
  only when the order is confirmed to arrive before the appointment, plus a buffer.
- **Idempotency.** The intent is persisted before an adapter is called. A known outcome is
  never repeated. An interrupted call is repeated only when the provider deduplicates on the
  idempotency key; otherwise it stays `pending` and is escalated.
- **Closure.** A job closes only on an `approve_closure` review bound to the current
  recommendation, completion and verification versions, with evidence for the right asset
  and a `ready_for_review` draft.

## Follow-up and exceptions

Due times are persisted with the job, so a restarted worker continues. Implemented paths:
technician nonresponse, technician cancellation, parts delay, late delivery, schedule write
failure with retry, missing completion evidence, overdue verification.

## Configuration

`context.config` overrides these defaults.

| Name | Default |
|---|---|
| `shortlist_size` | 3 |
| `technician_response_minutes` | 60 |
| `parts_buffer_minutes` | 60 |
| `completion_grace_minutes` | 120 |
| `completion_reminder_limit` | 2 |
| `verification_reminder_minutes` | 1440 |
| `retry_delay_minutes` | 15 |
| `max_action_attempts` | 3 |
| `scheduling_horizon_days` | 14 |

Environment variable names are in `.env.example`.

## Band runtime

Five agents coordinate one repair through a Band room. Each is a separately registered Band
agent with its own connection. No agent calls another; each acts only when it is @mentioned.

| Agent | The one job it owns |
|---|---|
| `RepairCoordinator` | Opens the case, decides which specialists it needs and recruits them |
| `PartsSourcer` | Gets quotes and orders the approved parts once the critic has approved |
| `AuthorityCritic` | Approves or blocks every purchase and booking |
| `TechDispatcher` | Plans the appointment after the handed-over parts estimate, contacts technicians |
| `ScheduleReporter` | Updates the schedule and reports to the person who asked |

Agents have no model behind them. Their decisions are deterministic rules over the job store.

**Flow.** A person writes `@RepairCoordinator coordinate JOB-001`. The coordinator recruits
the specialists the case needs and mentions `PartsSourcer`. The sourcer gets quotes and asks
`AuthorityCritic` for a verdict. On approval it orders and hands the delivery estimate to
`TechDispatcher`, which offers an appointment after that estimate. When the technician has
accepted, the dispatcher asks the critic again, confirms the booking, recruits
`ScheduleReporter`, and the reporter answers the person with one recommendation.

**What the room carries, and the engine enforces:**

- *Verdict that can be blocked.* On the `band` runtime a parts order and a booking are not
  executed until a verdict is recorded. A blocked order never reaches the supplier.
- *Dependent handoff.* The dispatcher plans from the delivery estimate in the sourcer's
  message. Without that handoff no technician is contacted.
- *Roster decided at runtime.* A job without parts never recruits `PartsSourcer`.
  `ScheduleReporter` joins only when there is something to publish.

**Delete test.** Without the room a `band` job orders nothing and contacts nobody
(`test/band.test.ts`). The baseline `job_queue` runtime stays available for jobs that do not
use Band.

### Run it on Band

Requires Node.js 22.12 or newer.

1. Sign up at https://app.band.ai and register five agents at https://app.band.ai/agents with
   exactly these names: `RepairCoordinator`, `PartsSourcer`, `AuthorityCritic`,
   `TechDispatcher`, `ScheduleReporter`.
2. `cp agent_config.yaml.example agent_config.yaml` and fill in each `agent_id` and `api_key`.
   The file is git-ignored.
3. `npm run band:check`, then `npm run band`. It seeds the fictional job `JOB-001`.
4. In Band, open a room, add `RepairCoordinator`, and write
   `@RepairCoordinator coordinate JOB-001`.
5. Record the technician's reply: `npm run band:accept -- JOB-001` (simulated), or
   `advanceRepairJob` from a real channel. Then write `@RepairCoordinator update JOB-001`.

Notes from the live run:

- Band's free plan allows 5 participants in a room. The crew is you plus five agents, so
  `PartsSourcer` leaves once the parts are ordered and `ScheduleReporter` takes its seat.
- Agents rejoin the rooms they belong to after a restart (`autoSubscribeExistingRooms`).
- `BAND_DEBUG=1 npm run band` prints what the SDK does.
- To run the demo again, stop the crew, delete `.data/band/JOB-001.json` and use a new room.

`createCrewHandler(role, deps)` returns the handler of one agent, and
`startBandCrew(options)` connects all five. The critic's extra rules are set with
`policy: { max_single_order_minor, blocked_supplier_ids }`.

## Not implemented

- No live or sandbox adapter. Calls, SMS and email are not implemented; the only
  communication adapter is simulated.
- No real supplier integration.
- On Band, one flow was run: kickoff to booking and report. The blocked-purchase path and the
  no-parts path were run only in the simulated room.
- The application does not yet post job events into the room by itself; a person writes
  `update <job id>`.
