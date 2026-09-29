# Shared team handoff

Read AGENTS.md and docs/frontend-handoff.md. The user assigned Claude the 3D/Three.js frontend and Codex the backend, review gates, Excel adapter, and reports.

Latest cost constraint: integrate with local fixtures only. Do not run paid API calls or billable smoke tests without new explicit user authorization, even when credentials are present. Keep `CRUSOE_LIVE_REQUESTS_ENABLED=false`.

Backend implementation is on codex/zubair-app-integration. Read its docs/frontend-handoff.md directly from GitHub if your branch does not contain it yet. Preserve apps/web/app/api/, apps/web/lib/, packages/excel/, and the shared schema while building the scene. The page/layout/CSS on that branch are placeholders for you to replace. Coordinate root dependencies and API changes through your handoff or PR.

Use GET /api/case as the scene's state source and POST /api/case for actions. The backend uses expectedRevision for stale-action checks. Keep live/local versus simulated integration labels visible. Do not animate a booking, purchase, workbook write or closure as successful without its returned outcome.

Publish your branch and a concise frontend handoff with launch command, routes consumed, current commit and blockers so the other team members can discover and integrate your work through GitHub.
