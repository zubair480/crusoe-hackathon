# crusoe-hackathon

**ThermalDesk turns thermal inspections into completed, verified repairs.**

This repository currently contains the build plan, individual coding prompts, shared data contract, and synthetic fixtures. The application and integrations are not implemented yet.

## Keep both pipelines

**Inspection:** images + equipment records + technician notes -> AI-assisted analysis -> reviewed recommendation -> approved repair scope.

**Execution:** approved repair scope -> source approved parts -> contact qualified technicians -> confirm delivery and book -> update Excel -> notify manager -> track work -> collect receipts, photos, and comments -> review verification -> final report.

Unresolved findings stay open. Repair results feed the equipment history for the next inspection.

## Pick your branch and prompt

| Person | Working branch | Responsibility | Prompt to give your coding assistant |
|---|---|---|---|
| Zubair | `codex/zubair-app-integration` | Application, review screens, Excel, report, final integration | [Zubair prompt](docs/prompts/zubair.md) |
| Ali | `codex/ali-repair-coordination` | Repair workflow, parts, technician contact/booking, manager notifications, follow-up; BAND if used | [Ali prompt](docs/prompts/ali.md) |
| Sunny | `codex/sunny-crusoe-analysis` | Crusoe, input checks, draft findings and repair recommendations, completion comparison | [Sunny prompt](docs/prompts/sunny.md) |
| Isaac | `codex/isaac-plaud-intake` | Plaud, original inspection evidence, completion photos and technician comments | [Isaac prompt](docs/prompts/isaac.md) |

Start with [the product scope](docs/product-scope.md), [AGENTS.md](AGENTS.md), [the shared contract](contracts/v1.schema.json), and [the integration guide](docs/integration.md). Then paste your entire role prompt into your coding assistant. Your prompt instructs it to implement your component, not simply discuss a plan. The product name and customer positioning remain a working proposal; no business validation or completed application is claimed.

**Shared coordination:** [Live team status and update instructions](docs/team-coordination.md). Each link reads the owner's branch, so status is available before feature code merges. Agents should run `python scripts/team_status.py` and update their own handoff roughly every 10 minutes during active work, after milestones, when blocked, and before pausing.

**Prize audit:** [Verified requirements and access checks](docs/prize-audit.md). The documented targets are $5,000 cash from Crusoe and $1,000 cash from Plaud; combined eligibility is unverified. Product development comes before submission.

Each person should use their own clone or checkout. Do not switch branches in a working directory another teammate is using.

```bash
git clone https://github.com/zubair480/crusoe-hackathon.git
cd crusoe-hackathon
git fetch origin
```

Run the command for your name:

```bash
# Zubair
git switch --track origin/codex/zubair-app-integration
# Ali
git switch --track origin/codex/ali-repair-coordination
# Sunny
git switch --track origin/codex/sunny-crusoe-analysis
# Isaac
git switch --track origin/codex/isaac-plaud-intake
```

Use `git switch <your-branch>` instead if your local branch already exists.

## First shared demo

Use [the inspection fixture](fixtures/inspection.json) and [the approved recommendation fixture](fixtures/approved-recommendation.json). Both are fictional. Exercise one complete job and a cancellation or missing-evidence path. Existing fixture approval is a synthetic demo value, not a real engineering sign-off.

Show the actual updated `.xlsx` file and a final report. Label every integration `live`, `sandbox`, or `simulated`. Record `not_configured` when credentials or access are absent. A real AI response is not proof that a phone call, purchase, booking, or spreadsheet update happened.

## Collaborate and integrate

1. Work only on your branch and owned paths.
2. Commit and push your work regularly, including a current `docs/handoffs/<name>.md`.
3. Open a pull request into `main` when your acceptance checks pass.
4. Zubair coordinates integration. Update your branch with `origin/main` before resolving integration issues. Do not force-push `main` or discard another person's work.
5. Run both full pipelines together before declaring the application complete. Separate component demos do not count as an integrated product.

See [integration and branch rules](docs/integration.md) for the shared interfaces, state ownership, and merge checklist.

## Deliberate scope

- TypeScript is the shared application language. Zubair establishes the Next.js web application and root workspace. Feature packages export callable functions and do not create separate frontends.
- Crusoe is the chosen inference provider. Plaud is Isaac's input integration. Outbound calling is a separate integration owned by Ali.
- BAND is optional for the basic application; if included for its sponsor award, it must actually carry coordination. Neo4j is deferred from the first build.
- Qualified people approve technical recommendations and final verification. AI-generated drafts do not authorize repairs or certify electrical safety.
- Start with one agreed input/export format, one case, one schedule workbook, and one report. Do not silently remove either pipeline to reduce scope.
