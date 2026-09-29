# Isaac — paste this entire prompt into your coding assistant

You are implementing Isaac's component of ThermalDesk in https://github.com/zubair480/crusoe-hackathon. Implement the work; do not stop at a plan.

ThermalDesk has TWO connected pipelines: inspection evidence -> AI analysis -> human-approved repair recommendation; then approved recommendation -> parts and technician coordination -> booking -> Excel update -> manager notification -> repair -> completion evidence -> human verification -> final report. Your work supplies evidence at the start and at repair completion.

## Start now

Use your own clone, never a working directory another teammate is using:

```bash
git clone https://github.com/zubair480/crusoe-hackathon.git
cd crusoe-hackathon
git fetch origin
git switch --track origin/codex/isaac-plaud-intake
```

If you already have this clone and branch, use `git switch codex/isaac-plaud-intake` instead. Preserve any existing local work.

This prompt is being published first so you can begin immediately. The shared foundation is being added next. Read AGENTS.md, README.md, docs/integration.md, contracts/v1.schema.json, and fixtures when present. If those files are not present yet, start the Plaud access check and a package-local adapter; do not wait or invent a competing shared contract. Use `git fetch origin` and `git merge origin/main` at your next coherent checkpoint to receive the foundation. Do not overwrite root files or teammates' work.

## Your responsibility

Own Plaud integration and evidence intake for BOTH the initial inspection and the eventual repair completion. Your paths are `packages/intake/` and `docs/handoffs/isaac.md`. Do not build a separate dashboard or change the shared schema unilaterally.

## Build

First prove Plaud access. Read the current official documentation at https://docs.plaud.ai/. Identify the supported interface actually available to our account and verify its authentication and any device requirements. Retrieve one authorized recording's transcript before building around an assumed API. If access is blocked, record the exact blocker immediately and implement the labeled fallback below. A fallback keeps development moving; it is not proof of a working Plaud integration for the prize.

1. Export `createInspectionPackage` and `collectCompletionEvidence` in TypeScript using the shared contract.
2. Accept image/file references, case/site/asset identifiers, original technician notes, available measurements, and available equipment history. Preserve source files and source identifiers.
3. Connect Plaud through a documented interface actually available to the account. Verify access and SDK/device/account prerequisites. Retrieve real transcript text and timestamps when available; never fabricate a Plaud response. Provide a labeled imported-transcript adapter if access is unavailable.
4. Distinguish initial observations from later repair comments. Associate all evidence with the correct asset and case; retain uncertain associations for review.
5. Provide metadata validation, duplicate-input handling, and clear errors for absent or unsupported files. Preserve capture timestamps and transcript references when available without inventing them.
6. Support completion inputs: technician comments, receipts, before/after photos, and follow-up measurements. Attach them to the existing job without overwriting the original inspection.
7. Export small documented operations that Zubair can call from the common application. Inject storage/transcription adapters so the package can run before other branches merge.

Plaud handles recording/transcription. Ali owns outgoing calls, SMS/email, technician outreach, and booking. Coordinate through shared records rather than adding a second communication system.

Export the operations from `packages/intake/src/index.ts`. Until the shared contract arrives, keep provider-specific retrieval and normalization separate so it can be mapped without a rewrite. Use source identifiers, case/site/equipment identifiers, evidence type, capture time when known, transcript segments, and integration mode (`live`, `sandbox`, or `simulated`). Keep ambiguous equipment associations unresolved.

## Demonstrate meaningful Plaud use

With a consenting teammate, process two fictional repair statements through Plaud when access is available: "The repair is complete on panel DEMO-A" and "The part has not arrived; we have not completed the repair." Preserve this distinction in structured completion evidence so the second job remains open. Include a separate wrong-equipment example. Do not reduce these statements to a generic summary that loses the outstanding work.

The target sponsor award is Best Use of Plaud, listed as $1,000 cash on the event page. Preserve evidence of the actual Plaud operation and disclose any fallback. The public prize description does not establish whether a specific import/integration route qualifies; do not claim eligibility is guaranteed.

## Acceptance checks

- The inspection fixture becomes a schema-valid InspectionPackage with resolvable evidence references.
- A real or explicitly simulated transcript has the correct integration mode and retains source information.
- Completion evidence attaches to an existing case/job and retains its asset identity.
- The wrong-asset fixture remains visibly mismatched; do not relabel it to make it pass.
- Missing files, unavailable Plaud access, and repeated uploads produce useful outcomes without losing evidence.

Use fictional data or explicitly authorized demo material. List environment variable names only in `.env.example`. Do not contact third parties.

## Finish

Work in three increments: (1) real transcript retrieval or a precise access blocker plus a runnable fallback; (2) initial inspection intake; (3) completion intake and mismatch checks. Push a coherent increment as soon as it works so the other teammates can integrate before everything is complete.

At startup, after a milestone, immediately when blocked, before pausing, and roughly every 10 minutes during active work, read the central coordination instructions and publish status using the repository's status tool once it is available. Until then, update `docs/handoffs/isaac.md` with current task, last pushed commit, exported interfaces, actual Plaud access status, tests, blockers, next step, and requests for teammates. Do not claim a background process is updating status while your agent is stopped.

Run meaningful package checks. Write package usage/setup instructions and update `docs/handoffs/isaac.md` with exported operations, sample inputs/outputs, commands, actual integration modes, and remaining issues. Commit and push to your branch. Open a PR targeting main with a concise summary and verification evidence. Do not merge it yourself or edit teammates' owned paths to conceal missing dependencies.
