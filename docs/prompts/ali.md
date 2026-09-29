# Ali — paste this entire prompt into your coding assistant

You are implementing Ali's component of ThermalDesk in the `crusoe-hackathon` repository. Work on `codex/ali-repair-coordination`. Read AGENTS.md, README.md, docs/integration.md, contracts/v1.schema.json, and the fixtures before editing. Implement the work; do not stop at a plan.

## Your responsibility

Own the repair coordinator, canonical repair-job state, persistent event history, and external action adapters. Your paths are `packages/coordination/` and `docs/handoffs/ali.md`. Zubair owns the common UI, Excel adapter, and report. Isaac owns evidence intake; Sunny owns analysis.

## Build

1. Export `createRepairJob`, `advanceRepairJob`, and `coordinateRepair` in TypeScript. Use a persistent repository abstraction; provide a working local implementation suitable for the demo, with a documented shared-app wiring path.
2. Validate the recommendation's versioned approval and configured authority before executing actions. A changed technical scope or part specification requires a new approval.
3. Source only the approved part/quantity from allowed suppliers. Capture price, availability, delivery estimate, and purchase outcome separately. Missing specifications and proposed substitutions return to the reviewer. Never autonomously decide wire sizes or equivalent parts.
4. Contact a suitable shortlist from the customer's approved technician roster. Consider supplied qualifications, location, availability, and job timing. Own the actual calling or SMS/email adapter. Plaud is not your outbound calling provider. Select the simplest available communication channel first and document what is implemented.
5. Confirm an appointment and align it with parts availability. Booking, ordering, and notification actions require evidence of their outcomes. Operate within configured authority and escalate exceptions; avoid repeated approvals when existing authorization covers the action.
6. Call Zubair's injected `syncSchedule` adapter after confirmed booking. Capture its result. Inform the manager accurately about the finding, approved action, technician, schedule, parts status, and any unsuccessful update.
7. Keep the job alive through nonresponses, cancellations, late parts, and missing completion evidence. Implement at least one real exception path and persistent follow-up due times; the demo can advance a controlled clock rather than waiting hours.
8. Record receipts, provider references, idempotency keys, integration mode, timestamps, and errors. Retrying must not produce duplicate purchases, bookings, or notifications.
9. Accept completion evidence events and await Sunny's comparison plus the recorded final human review. Close only when required verification is accepted. Publish closure to the Excel adapter and report timeline.
10. If BAND is available and the team includes its sponsor track, use it for genuine dependent worker handoffs and expose its execution events. A status-only log does not qualify. Keep a simple job-queue implementation available as the application's baseline; clearly identify which one runs.

## External action boundaries

Use simulated suppliers and consenting teammate/test recipients for the initial demo. Credentials alone do not authorize actual purchases or calls to unrelated people. Implement the real adapters where authorized access permits, but require explicit configuration of live recipients, suppliers, and spending authority. Keep simulated outcomes visibly simulated.

## Acceptance checks

- An unapproved or changed-version recommendation cannot create a live purchase/booking.
- A confirmed job produces one schedule-sync request and an accurate manager update.
- A technician cancellation causes replanning without duplicate orders.
- A repeated event produces the same outcome rather than repeating the external side effect.
- Wrong-asset or missing completion evidence keeps the job open.
- Restarting the worker preserves job status and pending follow-up work.

## Finish

Deliver a usable increment in this order: persisted approval-gated job and typed event handling; part sourcing plus technician outreach/booking and schedule callback; then follow-up, cancellation recovery, completion and closure. Use an injected test clock. BAND is optional for this two-prize plan; finish the loop before adding it.

Read docs/product-scope.md and docs/team-coordination.md. Start by running `python scripts/team_status.py` from the repository root. At milestones, immediately on a blocker, before pausing, and roughly every 10 minutes during active work, update and push ONLY your own handoff following that guide. Record the latest pushed implementation commit, exact exported signatures, tests, integration modes, and named requests. Read teammates' status before changing an integration. This is active-agent reporting, not an unattended background timer.

Verify `git branch --show-current` is `codex/ali-repair-coordination` before editing. Use your own clone. Publish your function signatures and example input/output after the first runnable increment; do not wait until the whole module is done. Treat fixtures as demonstrations, not proof of completed integrations. Both primary sponsors must have actual use evidenced for the intended prize entries.

Run meaningful state-transition and adapter tests. Write public API, setup, event, and simulation instructions. Update `docs/handoffs/ali.md` with implemented paths, dependencies on Zubair's adapters, live/sandbox/simulated status, and remaining issues. Commit and push your branch. Open a PR into main and include one happy-path trace and one exception trace. Do not merge it or rewrite teammates' owned modules.
