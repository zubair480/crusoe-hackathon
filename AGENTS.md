# Build instructions for every coding assistant

## Product scope

Build both pipelines in README.md: inspection-to-approved-recommendation AND approved-repair-to-verified-completion. Thermal analysis alone, dispatch alone, or a dashboard populated with invented results is incomplete.

This repository starts as a planning and contract foundation. Do not describe unimplemented integrations, fixtures, or synthetic approvals as production capabilities or real-world actions.

## Read before coding

1. `README.md`
2. `docs/integration.md`
3. `contracts/v1.schema.json`
4. `docs/prompts/<your-person>.md`
5. The relevant files in `fixtures/`
6. `docs/product-scope.md`, `docs/team-coordination.md`, and `docs/prize-audit.md`

Run `python scripts/team_status.py` at startup to read everyone's latest pushed handoff. Follow the coordination guide: publish your own status after milestones, immediately on a blocker, before pausing, and roughly every 10 minutes while actively working. Include UTC time, latest pushed implementation commit, interfaces, verification, actual integration modes, blockers and named dependency requests. Each handoff lives on its owner's branch. No idle/background update service is implied.

## Branches and ownership

| Owner | Branch | Owned paths |
|---|---|---|
| Zubair | `codex/zubair-app-integration` | `apps/web/`, `packages/excel/`, root workspace configuration, `contracts/`, `docs/integration.md`, `docs/handoffs/zubair.md` |
| Isaac | `codex/isaac-repair-coordination` | `packages/coordination/`, `docs/handoffs/isaac.md` |
| Sunny | `codex/sunny-crusoe-analysis` | `packages/analysis/`, `docs/handoffs/sunny.md` |
| Ali | `codex/ali-plaud-intake` | `packages/intake/`, `docs/handoffs/ali.md` |

Shared contract changes are coordinated through Zubair. Propose the change in your handoff rather than silently changing another component's assumptions. Add tests inside your owned package. Put your environment variable names and examples in your package's `.env.example` and README; never commit real values. Zubair owns the shared lockfile.

## Implementation shape

- Use TypeScript for shared application modules. Zubair owns the Next.js application. Export callable package functions; do not create competing dashboards or standalone applications.
- Import and emit the shared contract. Generate TypeScript types from the JSON Schema or maintain a clearly mapped adapter; do not create incompatible copies of the business objects.
- Inject external adapters so a component can run against deterministic fixtures before credentials exist.
- Isaac owns job state transitions, persisted execution events, and the repair job's canonical state. The web app calls this service. Other packages return evidence, drafts, or action results.
- Zubair owns Excel reads/writes and the schedule view. Publishing a scheduling event does not prove the workbook changed; wait for the adapter result.
- Persist job identifiers and idempotency keys for external actions. A retry must not create a second order, booking, or notification.
- Use source references and preserve original evidence. Measurements and arithmetic are deterministic inputs, not values invented by a model.

## External actions and approvals

- The recommendation review gate and the completion verification gate are separate. Approval identifies the exact recommendation or verification version.
- Purchasing and booking require an approved job and customer-configured authority. Use the existing authority for routine actions; escalate out-of-scope actions rather than demanding repeated approval for everything.
- A code-building request does not authorize calling actual technicians, buying actual supplies, or messaging third parties. Live demos use explicitly authorized recipients and purchasing environments. Simulated and sandbox actions must remain visibly labeled.
- Never claim `confirmed` solely because a request was generated. Record the real adapter response, provider reference, and any subsequent confirmation required for that action.
- Do not release a technical repair recommendation or certify a repair on AI output alone. Synthetic reviewer fixtures are demonstration data, not genuine professional approval.

## Completion discipline

Implement and verify your assigned component. Test its meaningful success and failure paths. Update `docs/handoffs/<name>.md` with exported functions, setup, commands, checks performed, live/simulated integrations, and remaining issues. Open a PR into `main`; do not merge or overwrite teammates' work without coordination.

If an integration is unavailable, preserve the interface and implement a clearly labeled fixture adapter so the team can continue. Do not silently substitute a different sponsor integration or call the mock live.
