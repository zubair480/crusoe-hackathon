# Backend contract for Claude's 3D frontend

Claude owns the 3D/Three.js frontend. Zubair's coding agent owns backend routes, review gates, workbook writes, report export and integration. Do not replace the other person's implementation. The existing page/layout/CSS are disposable scaffold files for Claude to replace; no finished frontend is claimed.

Backend branch: `codex/zubair-app-integration`. Package manager: npm. Node 22+. Run `npm ci` then `npm run dev` from the repository root. The server binds to `http://127.0.0.1:3000`. Use a second port if another server already owns 3000, and use the URL printed by Next.

For a separate backend on port 3001, use `npm run dev --workspace @thermaldesk/web -- --port 3001`. The agent's local backend is running on that port while the frontend can keep its own server.

## Endpoints

| Method and route | Contract |
|---|---|
| GET `/api/health` | Health and honest integration status. |
| GET `/api/case` | Current `CaseState` from `apps/web/lib/model.ts`. |
| POST `/api/case` | JSON `{command, expectedRevision, reviewer?}`. Returns updated CaseState. Errors are `{error}` with 409; unauthorized origins get 403. |
| POST `/api/evidence` | Multipart `file` and `expectedRevision`. Accepts PNG, JPEG, PDF, text up to 8 MB; returns updated CaseState. Initial inspection uploads only. |
| GET `/api/evidence/:id` | Download a stored file referenced by `local-evidence://:id`. |
| GET `/api/schedule` | Actual `.xlsx` download; 404 before the first schedule update. |
| GET `/api/schedule?format=json` | Current on-disk rows and fingerprint for reviewing manual changes. |
| GET `/api/report` | HTML report attachment. Printable in a browser, including print-to-PDF. |

All business object properties are snake_case from `@thermaldesk/contracts`. App wrapper state uses the names in `CaseState`. Don't rename data fields for the 3D scene; map display labels in the frontend. Core case fields: `inspection`, `recommendation`, `job`, `completion`, `verification`, `schedule`, `events`, `revision`, `scenarioLoaded`.

## Executable sequence

1. GET case; retain its revision.
2. `analyze`: simulated analysis returns missing-information. The initial fixture has no calibrated thermal data.
3. `load_demo_scope`: explicitly load a separate fictional repair scenario for the demo. Do not present it as a diagnosis of step 2.
4. `approve_scope` with reviewer name: versioned, simulated approval.
5. `coordinate`: simulated parts/technician/booking outcomes, plus a REAL local workbook write/read-back.
6. `notify_manager`: simulated notification, only after verifying the workbook update.
7. `complete`, `wrong_asset`, or `incomplete`: load a labeled demo completion statement.
8. `verify`: compare completion; wrong-asset and incomplete statements block closure.
9. `approve_closure` with reviewer: requires current passing verification; updates actual workbook status.
10. Download workbook and report.

`cancel_technician` blocks an existing scheduled job and updates the workbook. Calling `coordinate` again books a replacement without ordering the demo part twice. `sync_schedule` retries a workbook update. `reset_demo` resets only this app's demo state and demo workbook; label the button clearly. No real calls, orders, or notifications are implemented in the fixture adapters.

Every mutation sends the latest revision. Refetch after 409 and show its error. Disable duplicate clicks while a request is pending. Never change server state only inside the 3D animation. Drive scene status from the returned state; link the asset node to `inspection.asset_id`, the technician node to `job.booking`, and evidence nodes to their stable evidence IDs.

Workbook conflicts require an explicit choice, not a silent overwrite. Show the actual rows from `GET /api/schedule?format=json` beside the job. If the reviewer chooses **Restore this job's schedule from the job record**, POST `reconcile_schedule` with `reviewer`, `expectedRevision`, and `expectedWorkbookFingerprint` from that read. A further edit causes another rejection. This deliberately restores the job's managed cells; importing changed technicians/timing back into the coordinator is a separate future adapter operation.

## Connection and ownership

Same-origin use is simplest: replace `apps/web/app/page.tsx`, `layout.tsx`, `globals.css`, and add frontend components/assets. Preserve `apps/web/app/api/`, `apps/web/lib/`, and `packages/excel/` unless coordinating a change. Three.js should run in client components. Reviewer input and actionable errors must remain accessible outside the canvas.

If the frontend uses a separate dev server, proxy `/api` to the backend and rewrite the Origin header to the backend origin for local development. Cross-origin direct mutations are intentionally rejected. This demo does not include authentication or multi-tenant deployment; don't expose it publicly as a live operations system.

Teammate integration point: `TeamPorts` in `apps/web/lib/model.ts`, wired by `apps/web/lib/service.ts`. `demo-ports.ts` is a labeled app testing adapter, not a competing production coordinator. Ali, Sunny, and Isaac should publish their exported signatures; the composition root maps those to the ports without changing the frontend.

Sunny's module is integrated via `analysis-ports.ts`. Keep `THERMALDESK_ANALYSIS_MODE=fixture` and `CRUSOE_LIVE_REQUESTS_ENABLED=false` for development without credit usage. A server-side request guard blocks paid inference even when a key exists; do not enable it without user authorization. Health `live_requests_disabled` means Crusoe mode was selected but spending remains blocked; `configured-unverified` means both the live flag and credentials are present, not that a request succeeded. The recommendation's `analysis_mode` and local telemetry describe actual execution. No image in the initial fixture means validation can return without any API call; don't claim that as a sponsor demo. The image resolver supports only authorized locally uploaded PNG/JPEG references. The local HTTP smoke script refuses non-simulated external integrations before modifying the case.
