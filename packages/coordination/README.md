# @thermaldesk/coordination

Repair coordinator for ThermalDesk. It owns the canonical repair-job state, the persisted
event history and the external action adapters. Owner: Isaac.

Every integration shipped here is **simulated**. No supplier, technician, manager or workbook
is contacted. BAND is not used; the runtime is an in-process job queue.

## Setup

Requires Node.js 20 or newer.

```bash
cd packages/coordination
npm install --no-package-lock   # Zubair owns the shared lockfile
npm test                        # type-check, build, 19 tests
npm run demo                    # prints a happy-path and an exception trace
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

## Not implemented

- No live or sandbox adapter. Calls, SMS and email are not implemented; the only
  communication adapter is simulated.
- No real supplier integration.
- BAND is not used.
