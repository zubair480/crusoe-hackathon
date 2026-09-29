# Shared interfaces and integration plan

## One product, four independent components

```text
Ali: inspection inputs + Plaud transcript
    -> Sunny: checks + Crusoe draft recommendation
    -> Zubair: evidence/recommendation review screen
    -> Isaac: approved repair job + parts + technicians + follow-up
    -> Zubair: confirmed schedule -> Excel write/read-back
    -> Isaac: manager notification with accurate action status
    -> Ali: completion photos, receipts, technician comments
    -> Sunny: completion comparison and missing-evidence flags
    -> Zubair: human verification screen
    -> Isaac: close approved job
    -> Zubair: final Excel status + report
```

The ownership above is the shared source of truth. Outgoing calls/messages belong to Isaac; recording/transcription belongs to Ali. Do not expect Plaud to be the telephone provider.

## Shared language and layout

Use TypeScript. Zubair establishes the root workspace and Next.js app in `apps/web/`. Component packages are `packages/intake`, `packages/analysis`, `packages/coordination`, and `packages/excel`. Each package should have a small documented public API and its own meaningful tests.

Use `contracts/v1.schema.json` as the source of truth for exchanged JSON. Version 1 contains InspectionPackage, Recommendation, RepairJob, CompletionEvidence, VerificationDraft, and ActionReceipt. Fixture files are envelopes containing the corresponding object type.

Each package may have richer internal types. Its public interface must accept/return the shared representation. Objects reference evidence IDs and persistent file URIs; do not send binary image data through every state object. No credentials belong in the contract.

## Required public operations

| Owner | Operation | Input -> output |
|---|---|---|
| Ali | `createInspectionPackage` | uploaded files, asset/site IDs, available notes/transcript -> InspectionPackage |
| Ali | `collectCompletionEvidence` | job ID, files, receipts, technician comments -> CompletionEvidence |
| Sunny | `analyzeInspection` | InspectionPackage -> draft Recommendation |
| Sunny | `compareCompletion` | RepairJob + approved Recommendation + CompletionEvidence -> VerificationDraft |
| Isaac | `createRepairJob` | approved Recommendation + configured authority -> RepairJob |
| Isaac | `advanceRepairJob` | RepairJob ID + typed workflow event -> persisted RepairJob |
| Isaac | `coordinateRepair` | RepairJob ID + configured supplier, technician, communication, and scheduling adapters -> RepairJob |
| Zubair | `syncSchedule` | job ID + confirmed booking or verified closure event -> ActionReceipt |
| Zubair | `exportReport` | current case, Recommendation, RepairJob, CompletionEvidence, VerificationDraft -> downloadable report reference |

Zubair implements thin web API routes calling these functions. A module can initially be developed with injected fixture adapters. It must not require another person's unmerged UI just to exercise its public operations.

## Approval and workflow rules

- A Recommendation is `draft`, `needs_information`, `approved`, or `rejected`. It has a positive integer version. Approval references that version. Modifying the technical scope or parts invalidates the old approval.
- An approved recommendation and applicable spending/dispatch authority permit creating an active repair job. Fixture authority applies only to simulated adapters.
- RepairJob status: `planning`, `awaiting_authorization`, `coordinating`, `scheduled`, `in_progress`, `awaiting_verification`, `closed`, `blocked`, or `cancelled`.
- Procurement and technician selection can advance independently. Do not call a job scheduled until the technician/appointment is confirmed and the parts situation supports the plan, or an explicitly approved exception exists.
- An external action receipt has an idempotency key, mode, status, and evidence/reference. `requested`, `pending`, `confirmed`, `failed`, and `not_configured` are distinct. In a real purchase, a submitted request and an accepted supplier order can be different events.
- Match the approved part specification. Do not invent wire sizes or approve substitutes. Ask for a scope revision where needed.
- A cancelled technician booking or late part triggers follow-up/replanning. Keep the prior events in the history.
- CompletionEvidence does not itself close a job. Sunny's VerificationDraft describes checks and missing evidence. A qualified review decides closure. Zubair records that decision; Isaac enforces it.
- Keep unresolved findings explicit. A final report may describe an incomplete job; it must not falsely mark it fixed.

## Excel contract

The first demo uses one agreed `.xlsx` schedule. Use columns `job_id`, `asset_id`, `site_id`, `technician_id`, `technician_name`, `start_at`, `end_at`, `parts_status`, `job_status`, and `last_updated_at`.

`job_id` is the stable row key; row number is not an identity. Zubair must update the correct row, preserve other jobs/formulas, reread the workbook, and return an ActionReceipt with the result. Serialize writes or detect conflicting edits. Do not claim a local downloadable workbook is a live Microsoft 365 sync. If a hosted workbook is used later, document the actual connector and permissions.

The database/job store is the canonical execution state. Import meaningful manual workbook changes through an explicit reconciliation operation rather than overwriting them without checking. Isaac receives failed sync results and prevents inaccurate manager updates.

## Shared fixtures and first end-to-end run

Current development constraint: do not spend API credits. Keep external integrations simulated, `THERMALDESK_ANALYSIS_MODE=fixture`, and `CRUSOE_LIVE_REQUESTS_ENABLED=false`. The sponsor demonstration described below is a future milestone requiring explicit spending authorization, not permission to run paid tests now. Keys alone never grant that permission.

- `fixtures/inspection.json`: fictional initial evidence, not a diagnostic benchmark.
- `fixtures/approved-recommendation.json`: synthetic approved recommendation for exercising execution while the analysis UI is still being built.
- `fixtures/completion-wrong-asset.json`: intentionally mismatched follow-up image. A successful test keeps the job open.

The data contain no actual customer, technician, supplier, or purchasing authority. Synthetic measurements/part IDs are not real repair instructions.

First demonstrate one job with an actual Crusoe call and a real Plaud-derived transcript, clearly labeled test communications/procurement, an actual workbook change, a follow-up evidence check, a recorded review, and a final report. Fixture adapters permit development before access is ready, but unavailable sponsor integrations remain explicit prize-readiness blockers. Disclose them.

The incomplete inspection fixture must produce a needs-information result. To exercise execution, deliberately load the separate synthetic approved recommendation; do not present that switch as evidence that the initial inspection was validly diagnosed or reviewed.

Public operations are async and return the data object for the named schema definition; the `{kind, data}` envelope is for saved exchange files and fixtures. Use the exact snake_case property names in v1. Application input types may include uploaded file references and adapters, but public business output must validate against v1. Publish exact TypeScript function signatures in the owner's handoff before another owner integrates them.

JSON Schema verifies shape, not all business invariants. Enforce same case/site/asset and recommendation version across records; retain an evidence-level asset mismatch rather than rewriting it. Bind closure to the current recommendation, completion, and verification versions. Changing any relevant evidence after review invalidates the affected review. Validate evidence IDs against the case's stored evidence. Serialize state transitions using state_version, and enforce action idempotency in persistent storage.

To check the published fixtures: `python -m pip install -r requirements-dev.txt`, then `python scripts/validate_contracts.py`. These checks do not validate electrical accuracy or prove the application works.

## Merge plan

All four working branches start from the same planning/contract commit. Each person works independently against the schema and fixtures.

1. Zubair establishes the root workspace without changing contract semantics; merge that foundation early.
2. Merge ready feature PRs into `main` after their package checks pass. The contract permits intake and analysis to arrive independently.
3. Isaac and Zubair integrate workflow events, approval gates, and the Excel adapter.
4. Run both entire pipelines against the shared fixture. Exercise cancellation/retry and wrong-asset completion paths.
5. Fix integration issues on the responsible owner's branch or a clearly coordinated integration change. Do not use force pushes to combine work.

To bring shared work into your branch:

```bash
git fetch origin
git merge origin/main
```

Do not merge a branch just because its presentation looks complete. Verify returned objects, actual adapter outcomes, and the final artifact. Every PR uses the repository template and updates its handoff.

## Implemented backend handoff

Isaac's announced scheduling port is supported by `createScheduleAdapter` in `@thermaldesk/excel`. See the package README for persisted fingerprint callbacks and transaction ownership. Keep blocked reasons in `getJobDetail` outside the v1 record, as Isaac proposed; no shared schema change is required.

Zubair's backend and workbook adapter are available in PR #1 on `codex/zubair-app-integration`. Claude owns the 3D frontend. See `docs/frontend-handoff.md` for exact endpoints, command names, revision handling and local development proxy setup. `TeamPorts` in `apps/web/lib/model.ts` defines the app-side seam for teammate modules; adapt module exports at the composition root rather than creating a second UI or job store. The app's persistent fixture coordinator is for demo/testing only and must be replaced with Isaac's production coordinator when available.

The npm workspace generates shared types with `npm run contracts:generate`. `npm test` checks workflow gates and actual workbook behavior; `npm run typecheck` and `npm run build` check the app. `node apps/web/scripts/smoke.mjs` exercises the HTTP demo once against the local server; `--reset-demo` explicitly permits a rerun that resets this demo's state/workbook. Initial evidence remains stored locally; the demo reset does not recursively remove uploads.
