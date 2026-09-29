# Zubair handoff

Status: backend increment implemented; 3D frontend belongs to Claude. Owner: Zubair. Branch: `codex/zubair-app-integration`.

Updated: 2026-09-29 20:14 UTC. This handoff is published with the implementation commit; use this branch's current commit for the code. No production deployment is claimed.

## Available now

- npm TypeScript/Next.js workspace and generated schema types in `@thermaldesk/contracts`.
- Persistent local case API with versioned approvals, stale-write checks, initial evidence uploads, fixture-driven execution, cancellation/rebooking, completion checks and human demo closure.
- Actual Excel write/read-back through `syncSchedule(input: ScheduleInput): Promise<ActionReceipt>` and `readSchedule(path: string): Promise<ScheduleSnapshot>` in `@thermaldesk/excel`.
- `exportReport(state: CaseState): string` produces an escaped, printable HTML report. GET `/api/report` downloads it; GET `/api/schedule` downloads the actual workbook.
- GET/POST `/api/case`, POST `/api/evidence`, GET `/api/evidence/:id`, GET `/api/health`.

Exact payloads and the 3D frontend sequence: `docs/frontend-handoff.md`. Ports: `apps/web/lib/model.ts`. Composition root: `apps/web/lib/service.ts`.

## Checks and modes

`npm test`: 10 tests passed. `npm run typecheck`: passed. Production build is still being checked at this checkpoint.

Excel and local file storage are real. Crusoe, Plaud, supplier transactions, outreach, bookings and manager messages are simulated adapters. No external messages, purchases or actual professional approvals occurred.

## Requests and next work

- Claude: own frontend/3D scene; consume the published API. The page/layout/CSS are placeholder scaffold and can be replaced. Preserve backend API and lib paths. No frontend branch was visible on GitHub at the latest check.
- Ali/Sunny/Isaac: publish usable signatures and real integration status in your own handoff. Replace the corresponding TeamPorts through the composition root; don't rewrite the UI or Excel adapter.
- Next: verify production build and HTTP downloads, add explicit manual-workbook reconciliation, then publish final backend evidence and PR.
