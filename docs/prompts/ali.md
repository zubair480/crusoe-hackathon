# Ali — paste this entire prompt into your coding assistant

You are implementing Ali's component of ThermalDesk in https://github.com/zubair480/crusoe-hackathon. Implement the work; do not stop at a plan.

ThermalDesk has TWO connected pipelines: inspection evidence -> AI analysis -> human-approved repair recommendation; then approved recommendation -> parts and technician coordination -> booking -> Excel update -> manager notification -> repair -> completion evidence -> human verification -> final report. Your work supplies evidence at the start and at repair completion.

## Start now

Use your own clone, never a working directory another teammate is using:

```bash
git clone https://github.com/zubair480/crusoe-hackathon.git
cd crusoe-hackathon
git fetch origin
git switch --track origin/codex/ali-plaud-intake
```

If you already have this clone and branch, use `git switch codex/ali-plaud-intake` instead. Preserve any existing local work.

Read AGENTS.md, README.md, docs/product-scope.md, docs/integration.md, contracts/v1.schema.json, and fixtures. If you cloned the early prompt-only commit, use `git fetch origin` and `git merge origin/main` at a coherent checkpoint to receive the shared foundation. Preserve existing work and resolve conflicts instead of overwriting files.

## Your responsibility

Own Plaud integration and evidence intake for BOTH the initial inspection and the eventual repair completion. Your paths are `packages/intake/` and `docs/handoffs/ali.md`. Do not build a separate dashboard or change the shared schema unilaterally.

## Build

First prove Plaud access. Read the current official documentation at https://docs.plaud.ai/. Identify the supported interface actually available to our account and verify its authentication and any device requirements. Retrieve one authorized recording's transcript before building around an assumed API. If access is blocked, record the exact blocker immediately and implement the labeled fallback below. A fallback keeps development moving; it is not proof of a working Plaud integration for the prize.

The event's linked sponsor guide is https://drive.google.com/file/d/1XOznnXQZXAZoUA7AN1qf1yNnTvS7RLXN/view. It describes device capture, device binding to a mobile application, and speaker-labeled transcription. Verify access before choosing this path. Do not start a separate mobile application merely to satisfy an assumed requirement; report the prerequisite and coordinate the smallest supported path. See docs/prize-audit.md.

1. Export `createInspectionPackage` and `collectCompletionEvidence` in TypeScript using the shared contract.
2. Accept image/file references, case/site/asset identifiers, original technician notes, available measurements, and available equipment history. Preserve source files and source identifiers.
3. Connect Plaud through a documented interface actually available to the account. Verify access and SDK/device/account prerequisites. Retrieve real transcript text and timestamps when available; never fabricate a Plaud response. Provide a labeled imported-transcript adapter if access is unavailable.
4. Distinguish initial observations from later repair comments. Associate all evidence with the correct asset and case; retain uncertain associations for review.
5. Provide metadata validation, duplicate-input handling, and clear errors for absent or unsupported files. Preserve capture timestamps and transcript references when available without inventing them.
6. Support completion inputs: technician comments, receipts, before/after photos, and follow-up measurements. Attach them to the existing job without overwriting the original inspection.
7. Export small documented operations that Zubair can call from the common application. Inject storage/transcription adapters so the package can run before other branches merge.

Plaud handles recording/transcription. Isaac owns outgoing calls, SMS/email, technician outreach, and booking. Coordinate through shared records rather than adding a second communication system.

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

Deliver a usable increment in this order: Plaud access proof (or exact blocker and labeled fallback), initial evidence intake, then completion intake with identity/missing-evidence checks.

Read docs/product-scope.md and docs/team-coordination.md. Start by running `python scripts/team_status.py` from the repository root. At milestones, immediately on a blocker, before pausing, and roughly every 10 minutes during active work, update and push ONLY your own handoff following that guide. Record the latest pushed implementation commit, exact exported signatures, tests, integration modes, and named requests. Read teammates' status before changing an integration. This is active-agent reporting, not an unattended background timer.

Verify `git branch --show-current` is `codex/ali-plaud-intake` before editing. Use your own clone. Publish your function signatures and example input/output after the first runnable increment; do not wait until the whole module is done. Treat fixtures as demonstrations, not proof of completed integrations. Both primary sponsors must have actual use evidenced for the intended prize entries.

Work in three increments: (1) real transcript retrieval or a precise access blocker plus a runnable fallback; (2) initial inspection intake; (3) completion intake and mismatch checks. Push a coherent increment as soon as it works so the other teammates can integrate before everything is complete.

At startup, after a milestone, immediately when blocked, before pausing, and roughly every 10 minutes during active work, read the central coordination instructions and publish status using the repository's status tool once it is available. Until then, update `docs/handoffs/ali.md` with current task, last pushed commit, exported interfaces, actual Plaud access status, tests, blockers, next step, and requests for teammates. Do not claim a background process is updating status while your agent is stopped.

Run meaningful package checks. Write package usage/setup instructions and update `docs/handoffs/ali.md` with exported operations, sample inputs/outputs, commands, actual integration modes, and remaining issues. Commit and push to your branch. Open a PR targeting main with a concise summary and verification evidence. Do not merge it yourself or edit teammates' owned paths to conceal missing dependencies.
