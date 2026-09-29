# Zubair — paste this entire prompt into your coding assistant

You are implementing Zubair's component of ThermalDesk in the `crusoe-hackathon` repository. Work on `codex/zubair-app-integration`. Read AGENTS.md, README.md, docs/integration.md, contracts/v1.schema.json, and the fixtures before editing. Implement the work; do not stop at a plan.

## Your responsibility

Own the shared application, review gates, Excel adapter, final report, and integration of both pipelines. Your paths are `apps/web/`, `packages/excel/`, root workspace configuration, `contracts/`, `docs/integration.md`, and `docs/handoffs/zubair.md`. Coordinate contract changes instead of altering interfaces without telling the other owners.

## Build

1. Establish the TypeScript workspace and Next.js app. Choose and document one package manager and commit its lockfile. Make the root foundation a small early PR so other branches can merge it. Do not relocate or rewrite their feature modules.
2. Build one case screen covering original evidence, draft findings, missing information, recommendation approval, parts, technician/appointment, execution history, completion evidence, verification, and report export. Keep it usable by a facilities manager; show business status instead of infrastructure jargon.
3. Provide thin server routes that call the agreed package operations. Use dependency-injected fixture adapters while a teammate's package is unavailable, visibly marked simulated. Do not build competing intake, model, or coordination implementations.
4. Make recommendation approval and final verification separate. Record reviewer identity, timestamp, and the reviewed version. Changing the scope invalidates the corresponding prior approval. A synthetic reviewer record is marked demo data.
5. Implement `syncSchedule` in `packages/excel`. Work with an actual `.xlsx` file for the demo. Match rows by job_id, preserve unrelated content/formulas, detect or serialize conflicting writes, and reread the result before confirming success. Return an ActionReceipt to Ali. Clearly distinguish this file-based demo from live Microsoft 365 sync.
6. Handle schedule changes and closure updates through the same adapter. Surface failures rather than displaying invented success. Reconcile manual workbook edits explicitly with Ali's canonical job state.
7. Implement `exportReport`. Include the original finding/evidence, approved scope, parts and purchasing status, technician, appointment, actual completion details, comments, receipts/photos, reviewer decision, remaining open issues, and which actions were simulated. Do not claim a repair succeeded merely because a report can be downloaded.
8. Provide a seeded demo with the shared fixtures and a reset that affects only demo records. No private customer files or secrets belong in the repository.
9. Assemble Isaac's intake, Sunny's Crusoe analysis, and Ali's coordinator once their PRs are ready. Preserve the full inspection pipeline and full execution pipeline.

## Acceptance checks

- One case goes from inspection inputs to reviewed recommendation, repair job, verified closure, workbook update, and final report.
- A pending approval prevents external execution.
- A confirmed booking changes the correct actual workbook row; failed writes remain failures.
- Completion evidence for the wrong asset cannot close the case.
- A cancelled technician produces an understandable manager-visible status.
- Final report contents agree with stored action receipts and the workbook.
- Live, sandbox, simulated, unavailable, and failed integrations are honestly distinguishable.

## Finish

Deliver a usable increment in this order: root workspace plus shared types and fixture-wired case screen; review gates and actual workbook update; then integrated timeline and final report. Publish the root workspace early so feature owners can merge it. Product scope comes before submission. Read docs/prize-audit.md later for readiness requirements; do not submit the hackathon entry as part of this coding task.

Read docs/product-scope.md and docs/team-coordination.md. Start by running `python scripts/team_status.py` from the repository root. At milestones, immediately on a blocker, before pausing, and roughly every 10 minutes during active work, update and push ONLY your own handoff following that guide. Record the latest pushed implementation commit, exact exported signatures, tests, integration modes, and named requests. Read teammates' status before changing an integration. This is active-agent reporting, not an unattended background timer.

Verify `git branch --show-current` is `codex/zubair-app-integration` before editing. Use your own clone. Publish your function signatures and example input/output after the first runnable increment; do not wait until the whole module is done. Treat fixtures as demonstrations, not proof of completed integrations. Both primary sponsors must have actual use evidenced for the intended prize entries.

Run appropriate build/type and integration checks once the relevant packages exist. Update docs/handoffs/zubair.md with setup, commands, workbook location/mode, report output, integrated packages, and remaining issues. Commit and push your branch and open a PR into main. As integration owner, coordinate merge order and review teammates' PRs; do not force-push main or silently overwrite their work. A working interface alone is not completion: demonstrate both full pipelines.
