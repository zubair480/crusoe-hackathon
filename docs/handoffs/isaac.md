# Isaac handoff

- **Updated (UTC):** 2026-09-29T20:42Z
- **Owner / branch:** Isaac · `codex/isaac-repair-coordination`
- **Owned paths:** `packages/coordination/`, `docs/handoffs/isaac.md`
- **Status:** all three increments implemented and tested with SIMULATED adapters only.
- **Latest pushed implementation commit:** `4721273`
- **Uncommitted local work:** none

## What works

`packages/coordination` exports `createRepairJob`, `advanceRepairJob` and `coordinateRepair`
on the v1 contract. Setup, wiring and rules are in `packages/coordination/README.md`.

```bash
cd packages/coordination
npm install --no-package-lock
npm test      # 19 tests, all passing
npm run demo  # happy-path and exception traces
```

## Exported signatures

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

processDueFollowUps(adapters: CoordinationAdapters, context: CoordinationContext): Promise<FollowUpResult[]>
runWorkerTick(adapters: CoordinationAdapters, context: CoordinationContext): Promise<WorkerTickResult>
getRepairJob(job_id: string, context: CoordinationContext): Promise<RepairJob>
getJobDetail(job_id: string, context: CoordinationContext): Promise<JobDetail>
getJobTimeline(job_id: string, context: CoordinationContext): Promise<TimelineEvent[]>
listRepairJobs(context: CoordinationContext): Promise<RepairJob[]>

// context  = { repository: JobRepository; clock?: Clock; config?: Partial<CoordinationConfig> }
// adapters = { suppliers: SupplierAdapter[]; roster: TechnicianRoster | null;
//              communication: CommunicationAdapter | null; schedule: ScheduleAdapter | null;
//              manager: ManagerContact | null }
```

Example: `createRepairJob({ recommendation: <fixtures/approved-recommendation.json data>, authority, job_id: 'JOB-001' }, context)`
returns a `RepairJob` with `status: 'planning'`, `state_version: 1`, `parts_status: 'not_ordered'`,
`booking: null`, `actions: []`, `unresolved_findings: ['FIND-001']`.

Workflow event types: `authority_configured`, `recommendation_revised`,
`recommendation_approved`, `technician_responded`, `technician_cancelled`,
`parts_order_updated`, `work_started`, `completion_evidence_received`,
`verification_draft_received`, `closure_review_recorded`, `exception_approved`,
`job_cancelled`. Payloads are listed in the package README.

## Persistence

`createFileJobRepository({ directory })` stores one JSON file per job, replaced atomically,
with a lock file and a compare-and-swap on `state_version`. Use a git-ignored directory such
as `data/private/coordination`. `createInMemoryJobRepository()` is for tests.

## Checks performed

`npm test` in `packages/coordination`: 19 tests, 19 passing. Every `RepairJob` the tests
produce is validated against `contracts/v1.schema.json`.

| Acceptance check | Result |
|---|---|
| Unapproved or changed-version recommendation cannot create a purchase or booking | pass |
| Confirmed job produces one schedule-sync request and an accurate manager update | pass |
| Technician cancellation replans without a duplicate order | pass |
| Repeated event produces the same outcome, no repeated side effect | pass |
| Wrong-asset or missing completion evidence keeps the job open | pass |
| Restarting the worker preserves status and pending follow-up work | pass |

Also covered: scope changed after approval, simulated authority refusing a live adapter,
missing authority, spending limit, substitution and missing specification, technician
nonresponse, parts delay, schedule write failure with retry, interrupted action not repeated,
verified closure published to the schedule adapter and the timeline.

## Integration modes (actual)

| Integration | Mode | What ran |
|---|---|---|
| Suppliers | simulated | `createSimulatedSupplier`. No purchase was made. |
| Technician roster | simulated | `createSimulatedRoster`. Fictional technicians. |
| Technician and manager communication | simulated | `createSimulatedCommunication`. Nobody was contacted. |
| Calls, SMS, email | not implemented | No live or sandbox adapter exists. |
| Schedule (Excel) | simulated stand-in | `createSimulatedSchedule`. No workbook was changed. |
| Job store | local files | Real persistence on local disk. |
| BAND | not used | The baseline in-process job queue runs. |

Nothing outside this machine changed. No live integration has been exercised.

## Dependencies and requests

- **Zubair:** implement this interface in `packages/excel`, or tell me your signature and I
  will wrap it. Set `deduplicates_by_key: true` if a repeated write for the same job is safe.

  ```ts
  interface ScheduleAdapter {
    mode: 'live' | 'sandbox' | 'simulated';
    deduplicates_by_key?: boolean;
    syncSchedule(request: {
      job_id: string;
      idempotency_key: string;
      reason: 'booking_confirmed' | 'booking_cancelled' | 'closure_verified' | 'job_cancelled';
      row: { job_id: string; asset_id: string; site_id: string;
             technician_id: string | null; technician_name: string | null;
             start_at: string | null; end_at: string | null;
             parts_status: string; job_status: string; last_updated_at: string };
      job: RepairJob;
    }): Promise<ActionReceipt>;  // action_type 'schedule_sync', same job_id
  }
  ```

- **Zubair:** the package pins its dev dependencies and ignores its own lockfile. Add
  `packages/coordination` to the workspace when the root exists.
- **Zubair:** v1 `RepairJob` has no field for why a job is `blocked` or
  `awaiting_authorization`. `getJobDetail` returns the open escalations. Say so if you want a
  contract field instead.
- **Ali:** send the v1 `CompletionEvidence` through `completion_evidence_received`. Evidence
  `asset_id` values are stored as received; a mismatch keeps the job open.
- **Sunny:** send the v1 `VerificationDraft` through `verification_draft_received`. A draft
  for an older completion or recommendation version is rejected as `stale_verification`.

## Remaining issues

- No live or sandbox communication adapter. A real channel needs an account, credentials and
  an explicit list of consenting recipients.
- No real supplier integration.
- The schedule stand-in is not the Excel adapter. Integration with `packages/excel` is open.
- A late part without a new estimate is escalated to the manager; it is not replanned until
  a `parts_order_updated` event carries the new estimate.
- A `keep_open` review or an incomplete report returns the job to `in_progress`. Rebooking a
  technician after that is left to a `technician_cancelled` or `job_cancelled` decision.
- Not yet run inside the shared Next.js app.

## Blockers

None.

## Traces from `npm run demo` (all integrations simulated)

```text
=== HAPPY PATH (all integrations SIMULATED) ===
  1 v1 planning               job_created: Repair job created from recommendation REC-001 v1, approved by DEMO-REVIEWER (simulated approval).
  2 v2 coordinating           status_changed: Status planning -> coordinating: Approval and authority are valid.
  3 v2 coordinating           action_requested [simulated]: Quote for 1 each of DEMO-PART-01 from Demo Supplier A (attempt 1)
  4 v3 coordinating           action_recorded [simulated]: Quote for 1 each of DEMO-PART-01 from Demo Supplier A: confirmed
  5 v4 coordinating           action_requested [simulated]: Order 1 each of DEMO-PART-01 from Demo Supplier A for 125.00 USD (attempt 1)
  6 v5 coordinating           action_recorded [simulated]: Order 1 each of DEMO-PART-01 from Demo Supplier A for 125.00 USD: confirmed
  7 v6 coordinating           follow_up_scheduled: Follow-up parts_delivery for DEMO-PART-01 due 2026-09-30T20:00:00.000Z (attempt 1)
  8 v6 coordinating           shortlist_built [simulated]: Booking round 1: shortlisted Dana Demo, Eli Example from the approved roster (simulated).
  9 v6 coordinating           action_requested [simulated]: Offer 2026-09-30T21:00:00.000Z to Dana Demo by simulated (attempt 1)
 10 v7 coordinating           action_recorded [simulated]: Offer 2026-09-30T21:00:00.000Z to Dana Demo by simulated: confirmed
 11 v8 coordinating           follow_up_scheduled: Follow-up technician_response for JOB-001-OFF-0001 due 2026-09-29T21:00:00.000Z (attempt 1)
 12 v9 scheduled              technician_responded: Dana Demo accepted 2026-09-30T21:00:00.000Z to 2026-09-30T23:00:00.000Z (reply SIM-IN-0001).
 13 v9 coordinating           follow_up_done: Follow-up technician_response for JOB-001-OFF-0001: Technician accepted.
 14 v9 coordinating           action_recorded [simulated]: Booking confirmed with Dana Demo for 2026-09-30T21:00:00.000Z: confirmed
 15 v9 scheduled              status_changed: Status coordinating -> scheduled: The technician and appointment are confirmed and the parts situation supports the plan.
 16 v9 scheduled              follow_up_scheduled: Follow-up completion_evidence for g1 due 2026-10-01T01:00:00.000Z (attempt 1)
 17 v10 scheduled              action_requested [simulated]: Update the schedule workbook (booking_confirmed) (attempt 1)
 18 v11 scheduled              action_recorded [simulated]: Update the schedule workbook (booking_confirmed): confirmed
 19 v12 scheduled              action_requested [simulated]: Inform the manager: Repair booked with Dana Demo for 2026-09-30T21:00:00.000Z (attempt 1)
 20 v13 scheduled              action_recorded [simulated]: Inform the manager: Repair booked with Dana Demo for 2026-09-30T21:00:00.000Z: confirmed
 21 v15 in_progress            work_started: Dana Demo started work.
 22 v15 in_progress            status_changed: Status scheduled -> in_progress: Dana Demo started work.
 23 v16 awaiting_verification  completion_evidence_received: Completion evidence COMP-001:v1 recorded (complete).
 24 v16 in_progress            follow_up_done: Follow-up completion_evidence for g1: Completion evidence COMP-001:v1 received.
 25 v16 awaiting_verification  status_changed: Status in_progress -> awaiting_verification: Completion evidence COMP-001:v1 received.
 26 v16 awaiting_verification  follow_up_scheduled: Follow-up verification_pending for COMP-001:v1 due 2026-09-30T20:00:00.000Z (attempt 1)
 27 v17 awaiting_verification  verification_draft_received: Verification draft VER-001:v1 recorded: ready_for_review (simulated analysis).
 28 v17 awaiting_verification  follow_up_done: Follow-up verification_pending for COMP-001:v1: Verification draft received.
 29 v17 awaiting_verification  follow_up_scheduled: Follow-up verification_pending for review:VER-001:v1 due 2026-09-30T20:00:00.000Z (attempt 1)
 30 v18 closed                 closure_review_recorded: Reviewer DEMO-REVIEWER approved closure (simulated review) against verification VER-001 v1.
 31 v18 awaiting_verification  follow_up_done: Follow-up verification_pending for review:VER-001:v1: Closure review recorded.
 32 v18 closed                 status_changed: Status awaiting_verification -> closed: Closure approved by DEMO-REVIEWER (simulated review).
 33 v18 closed                 follow_up_cancelled: Follow-up parts_delivery for DEMO-PART-01: The job is closed.
 34 v19 closed                 action_requested [simulated]: Update the schedule workbook (closure_verified) (attempt 1)
 35 v20 closed                 action_recorded [simulated]: Update the schedule workbook (closure_verified): confirmed
 36 v21 closed                 closure_published: Repair verified and closed. Schedule workbook updated.
 37 v21 closed                 action_requested [simulated]: Inform the manager: Repair verified and closed (attempt 1)
 38 v22 closed                 action_recorded [simulated]: Inform the manager: Repair verified and closed: confirmed

=== EXCEPTION PATH: no reply, then cancellation (all integrations SIMULATED) ===
  1 v1 planning               job_created: Repair job created from recommendation REC-001 v1, approved by DEMO-REVIEWER (simulated approval).
  2 v2 coordinating           status_changed: Status planning -> coordinating: Approval and authority are valid.
  3 v2 coordinating           action_requested [simulated]: Quote for 1 each of DEMO-PART-01 from Demo Supplier A (attempt 1)
  4 v3 coordinating           action_recorded [simulated]: Quote for 1 each of DEMO-PART-01 from Demo Supplier A: confirmed
  5 v4 coordinating           action_requested [simulated]: Order 1 each of DEMO-PART-01 from Demo Supplier A for 125.00 USD (attempt 1)
  6 v5 coordinating           action_recorded [simulated]: Order 1 each of DEMO-PART-01 from Demo Supplier A for 125.00 USD: confirmed
  7 v6 coordinating           follow_up_scheduled: Follow-up parts_delivery for DEMO-PART-01 due 2026-09-30T20:00:00.000Z (attempt 1)
  8 v6 coordinating           shortlist_built [simulated]: Booking round 1: shortlisted Dana Demo, Eli Example from the approved roster (simulated).
  9 v6 coordinating           action_requested [simulated]: Offer 2026-09-30T21:00:00.000Z to Dana Demo by simulated (attempt 1)
 10 v7 coordinating           action_recorded [simulated]: Offer 2026-09-30T21:00:00.000Z to Dana Demo by simulated: confirmed
 11 v8 coordinating           follow_up_scheduled: Follow-up technician_response for JOB-001-OFF-0001 due 2026-09-29T21:00:00.000Z (attempt 1)
 12 v9 coordinating           follow_up_done: Follow-up technician_response for JOB-001-OFF-0001: Dana Demo did not reply by 2026-09-29T21:00:00.000Z. The next technician is contacted.
 13 v9 coordinating           action_requested [simulated]: Offer 2026-09-30T21:00:00.000Z to Eli Example by simulated (attempt 1)
 14 v10 coordinating           action_recorded [simulated]: Offer 2026-09-30T21:00:00.000Z to Eli Example by simulated: confirmed
 15 v11 coordinating           follow_up_scheduled: Follow-up technician_response for JOB-001-OFF-0002 due 2026-09-29T22:01:00.000Z (attempt 1)
 16 v12 scheduled              technician_responded: Eli Example accepted 2026-09-30T21:00:00.000Z to 2026-09-30T23:00:00.000Z (reply SIM-IN-0002).
 17 v12 coordinating           follow_up_done: Follow-up technician_response for JOB-001-OFF-0002: Technician accepted.
 18 v12 coordinating           action_recorded [simulated]: Booking confirmed with Eli Example for 2026-09-30T21:00:00.000Z: confirmed
 19 v12 scheduled              status_changed: Status coordinating -> scheduled: The technician and appointment are confirmed and the parts situation supports the plan.
 20 v12 scheduled              follow_up_scheduled: Follow-up completion_evidence for g1 due 2026-10-01T01:00:00.000Z (attempt 1)
 21 v13 scheduled              action_requested [simulated]: Update the schedule workbook (booking_confirmed) (attempt 1)
 22 v14 scheduled              action_recorded [simulated]: Update the schedule workbook (booking_confirmed): confirmed
 23 v15 scheduled              action_requested [simulated]: Inform the manager: Repair booked with Eli Example for 2026-09-30T21:00:00.000Z (attempt 1)
 24 v16 scheduled              action_recorded [simulated]: Inform the manager: Repair booked with Eli Example for 2026-09-30T21:00:00.000Z: confirmed
 25 v18 coordinating           technician_cancelled: Eli Example cancelled the 2026-09-30T21:00:00.000Z appointment: Vehicle breakdown. Replanning without a new parts order.
 26 v18 scheduled              follow_up_cancelled: Follow-up completion_evidence for g1: Eli Example cancelled: Vehicle breakdown
 27 v18 scheduled              booking_round_cancelled: Booking round 1 ended: Eli Example cancelled: Vehicle breakdown
 28 v18 coordinating           status_changed: Status scheduled -> coordinating: Eli Example cancelled: Vehicle breakdown
 29 v19 coordinating           action_requested [simulated]: Update the schedule workbook (booking_cancelled) (attempt 1)
 30 v20 coordinating           action_recorded [simulated]: Update the schedule workbook (booking_cancelled): confirmed
 31 v21 coordinating           action_requested [simulated]: Inform the manager: Appointment with Eli Example cancelled (Eli Example cancelled: Vehicle breakdown) (attempt 1)
 32 v22 coordinating           action_recorded [simulated]: Inform the manager: Appointment with Eli Example cancelled (Eli Example cancelled: Vehicle breakdown): confirmed
 33 v23 coordinating           shortlist_built [simulated]: Booking round 2: shortlisted Dana Demo from the approved roster (simulated).
 34 v23 coordinating           action_requested [simulated]: Offer 2026-09-30T21:00:00.000Z to Dana Demo by simulated (attempt 1)
 35 v24 coordinating           action_recorded [simulated]: Offer 2026-09-30T21:00:00.000Z to Dana Demo by simulated: confirmed
 36 v25 coordinating           follow_up_scheduled: Follow-up technician_response for JOB-001-OFF-0003 due 2026-09-29T22:01:00.000Z (attempt 1)
```
