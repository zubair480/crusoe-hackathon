# Sunny — paste this entire prompt into your coding assistant

You are implementing Sunny's component of ThermalDesk in the `crusoe-hackathon` repository. Work on `codex/sunny-crusoe-analysis`. Read AGENTS.md, README.md, docs/integration.md, contracts/v1.schema.json, and the fixtures before editing. Implement the work; do not stop at a plan.

## Your responsibility

Own input checks, Crusoe inference, draft findings/recommendations, and comparison of completion evidence. Your paths are `packages/analysis/` and `docs/handoffs/sunny.md`. Do not build a separate frontend or implement purchasing, scheduling, or workbook writes.

## Build

1. Export `analyzeInspection` and `compareCompletion` in TypeScript using the shared contract.
2. Start with one documented input/export format. Validate supplied measurements, units, asset identity, and evidence availability. Calculate numeric differences with ordinary code. Never manufacture temperatures from a heatmap's colors or infer missing operating conditions.
3. Use Crusoe's currently documented API and a model appropriate to the supported inputs. Verify current model availability; do not copy a deprecated model identifier from an old example. An image-capable model and a text-only model are not interchangeable.
4. Create structured draft observations, evidence references, missing-data flags, and proposed next actions. Unknown technical specifications stay unknown. Human review supplies or confirms any repair parts/specifications.
5. All analysis output is a draft or needs-information result. Approval is a separate recorded decision; a model must not set its own recommendation to approved.
6. Compare original findings and the approved repair scope with completion evidence. Flag wrong assets, missing receipts/evidence where required, inconsistent observations, and inadequate comparison conditions. Return a VerificationDraft, never an autonomous certification that the equipment is safe.
7. Record provider/model identifiers, request references when available, latency, and usage metadata. Keep credentials and sensitive content out of routine logs.
8. Handle malformed output, timeouts, rate limits, and absent credentials. A deterministic fixture adapter may unblock integration but must be labeled simulated.

Isaac supplies evidence. Zubair supplies review screens. Ali acts on the reviewed version and manages the repair. Do not replace either entire pipeline with a standalone model demo.

## Acceptance checks

- A genuine Crusoe call produces schema-valid, source-linked draft output when access exists.
- The draft never claims professional approval or invents unsupported part specifications.
- Missing inputs yield needs-information with clear reasons.
- Completion evidence for DEMO-B cannot resolve a job for DEMO-A.
- A failed model call leaves the case recoverable and does not trigger downstream action.

The synthetic fixture is a workflow demonstration, not a diagnostic accuracy evaluation. Document what a real technical evaluation still requires.

## Finish

Deliver a usable increment in this order: a real Crusoe request with measured result and schema validation; inspection draft/needs-information output; then completion comparison. Check current official docs at https://docs.crusoecloud.com/managed-ai/overview/. Keep fixture inference clearly simulated; a live Crusoe operation is required to demonstrate the targeted overall-prize integration.

Read docs/product-scope.md and docs/team-coordination.md. Start by running `python scripts/team_status.py` from the repository root. At milestones, immediately on a blocker, before pausing, and roughly every 10 minutes during active work, update and push ONLY your own handoff following that guide. Record the latest pushed implementation commit, exact exported signatures, tests, integration modes, and named requests. Read teammates' status before changing an integration. This is active-agent reporting, not an unattended background timer.

Verify `git branch --show-current` is `codex/sunny-crusoe-analysis` before editing. Use your own clone. Publish your function signatures and example input/output after the first runnable increment; do not wait until the whole module is done. Treat fixtures as demonstrations, not proof of completed integrations. Both primary sponsors must have actual use evidenced for the intended prize entries.

Run meaningful package checks. Write setup and usage instructions, including model/input limitations and example outputs. Update `docs/handoffs/sunny.md` with API exports, checks, actual live/simulated status, and remaining issues. Commit and push to your branch. Open a PR into main; do not merge it or alter teammates' modules to make a local demo appear complete.
