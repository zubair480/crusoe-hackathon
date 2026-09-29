# Isaac handoff

- **Updated (UTC):** 2026-09-29T20:22Z
- **Owner / branch:** Isaac · `codex/isaac-repair-coordination`
- **Owned paths:** `packages/coordination/`, `docs/handoffs/isaac.md`
- **Status:** IN PROGRESS. Nothing runnable is pushed yet. This commit is status only.
- **Latest pushed implementation commit:** none
- **Uncommitted local work:** package scaffolding and the coordinator engine are being written now.

## Current task

Increment 1: persisted, approval-gated repair job and typed event handling.
Then increment 2 (part sourcing, technician outreach, booking, schedule callback) and
increment 3 (follow-up, cancellation recovery, completion and closure).

## Public API being implemented (planned, NOT yet pushed)

Package `@thermaldesk/coordination`, entry `packages/coordination/src/index.ts`. Every
operation is async and returns the v1 `RepairJob` data object (no envelope), with the exact
snake_case property names of `contracts/v1.schema.json`.

```ts
createRepairJob(
  input: { recommendation: Recommendation; authority: Authority | null;
           job_id?: string; requirements?: Partial<JobRequirements> },
  context: CoordinationContext
): Promise<RepairJob>

advanceRepairJob(
  job_id: string, event: WorkflowEvent, context: CoordinationContext
): Promise<RepairJob>

coordinateRepair(
  job_id: string, adapters: CoordinationAdapters, context: CoordinationContext
): Promise<RepairJob>

// context = { repository: JobRepository; clock?: Clock; config?: Partial<CoordinationConfig> }
```

`WorkflowEvent` is a discriminated union on `type`. Every event carries a caller-supplied
`event_id`; re-sending the same `event_id` returns the stored outcome and repeats no side effect.

| `type` | Sent by | Payload |
|---|---|---|
| `authority_configured` | Zubair (app) | `authority: Authority` |
| `recommendation_revised` | Zubair (app) | `recommendation: Recommendation` |
| `recommendation_approved` | Zubair (app) | `recommendation: Recommendation` |
| `technician_responded` | communication channel | `technician_id`, `response: 'accepted' \| 'declined'`, `response_reference`, `mode` |
| `technician_cancelled` | communication channel / app | `technician_id`, `reason` |
| `parts_order_updated` | supplier channel / app | `part_id`, `order_status`, `estimated_delivery_at?` |
| `work_started` | app | `technician_id` |
| `completion_evidence_received` | Ali (via app) | `completion: CompletionEvidence` |
| `verification_draft_received` | Sunny (via app) | `verification: VerificationDraft` |
| `closure_review_recorded` | Zubair (app) | `review: ClosureReview` |
| `exception_approved` | app | `exception: 'schedule_before_parts'`, `approved_by`, `reason` |
| `job_cancelled` | app | `cancelled_by`, `reason` |

## Requests to teammates

- **Zubair:** I will call your Excel adapter through this injected interface. Please confirm it
  or tell me your actual signature and I will wrap it.

  ```ts
  interface ScheduleAdapter {
    mode: 'live' | 'sandbox' | 'simulated';
    syncSchedule(request: {
      job_id: string;
      idempotency_key: string;   // stable per logical update; safe to dedupe on
      reason: 'booking_confirmed' | 'booking_cancelled' | 'closure_verified' | 'job_cancelled';
      row: { job_id: string; asset_id: string; site_id: string;
             technician_id: string | null; technician_name: string | null;
             start_at: string | null; end_at: string | null;
             parts_status: string; job_status: string; last_updated_at: string };
      job: RepairJob;
    }): Promise<ActionReceipt>;  // action_type must be 'schedule_sync'
  }
  ```

  A failed or thrown sync is recorded as `failed` and reported to the manager as not updated.
- **Zubair:** the v1 `RepairJob` has no field for why a job is `blocked` or
  `awaiting_authorization`. I will expose reasons through a separate read operation
  (`getJobDetail`) rather than change the contract. Tell me if you would prefer a contract field.
- **Ali:** send completion evidence as the v1 `CompletionEvidence` object. I keep evidence-level
  `asset_id` values exactly as received; a mismatch keeps the job open.
- **Sunny:** send the v1 `VerificationDraft`. I reject one whose `completion_version` or
  `recommendation_version` is not the current one for the job.

## Integration modes (actual, as of this update)

| Integration | Mode | Note |
|---|---|---|
| Suppliers | not implemented | simulated adapter planned first |
| Technician and manager communication | not implemented | simulated adapter planned first |
| Schedule (Excel) | not configured | depends on Zubair's `syncSchedule` |
| BAND | not used | baseline is an in-process job queue |

## Blockers

None.
