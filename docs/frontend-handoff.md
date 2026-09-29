# Backend contract for Claude's 3D frontend

Claude owns the 3D/Three.js frontend. Zubair's coding agent owns backend routes, review gates, workbook writes, report export and integration. Do not replace the other person's implementation. The existing page/layout/CSS are disposable scaffold files for Claude to replace; no finished frontend is claimed.

Backend branch: `codex/zubair-app-integration`. Package manager: npm. Node 22+. Run `npm ci` then `npm run dev` from the repository root. The server binds to `http://127.0.0.1:3000`. Use a second port if another server already owns 3000, and use the URL printed by Next.

For a separate backend on port 3001, use `npm run dev --workspace @thermaldesk/web -- --port 3001`. The agent's local backend is running on that port while the frontend can keep its own server.

## Endpoints

**2026-09-29 preparation increment:** the existing integration bridge links **Parts & dispatch** to `/api/preparation/workbench` and labels the old coordinator action **Run simulated demo**. This supplemental backend-served page provides supplier research links, sourced operator-entered quotes, budget/critic checks, and unsent RFQ/technician `.eml` downloads. It requires current scope approval and preserves synthetic labels. No scene, layout or Three.js components changed. Claude can replace the supplemental UI using `GET/POST /api/preparation`; the full fields and Band behavior are in `docs/isaac-api-integration.md`. It never purchases, emails, books or updates the execution workbook. Do not label its quote eligibility as purchasing authority or its drafts as contacted technicians.

| Method and route | Contract |
|---|---|
| GET `/api/health` | Health and honest integration status. |
| GET `/api/case` | Current `CaseState` from `apps/web/lib/model.ts`. |
| POST `/api/case` | JSON `{command, expectedRevision, reviewer?}`. Returns updated CaseState. Errors are `{error}` with 409; unauthorized origins get 403. |
| POST `/api/evidence` | Multipart `file` and `expectedRevision`. Accepts PNG, JPEG, PDF, text up to 8 MB; returns updated CaseState. Initial inspection uploads only. |
| POST `/api/completion` | Actual local completion files and technician statement; multipart contract below. Returns updated CaseState, with verification cleared. |
| GET `/api/evidence/:id` | Download a stored file referenced by `local-evidence://:id`. |
| GET `/api/schedule` | Actual `.xlsx` download; 404 before the first schedule update. |
| GET `/api/schedule?format=json` | Current on-disk rows and fingerprint for reviewing manual changes. |
| GET `/api/report` | HTML report attachment. Printable in a browser, including print-to-PDF. |

All business object properties are snake_case from `@thermaldesk/contracts`. App wrapper state uses the names in `CaseState`. Don't rename data fields for the 3D scene; map display labels in the frontend. Core case fields: `inspection`, `recommendation`, `job`, `completion`, `verification`, `schedule`, `events`, `revision`, `scenarioLoaded`.

## Completion uploads — 2026-09-29

Claude: wire the completion upload control to `POST /api/completion`. Send `FormData` with `expectedRevision`, `technician_id`, `asset_id` (the operator's stated equipment identity), `reported_status` (`complete`, `incomplete`, or `unknown`), `comments`, and 1–6 `file` entries (PNG/JPEG/PDF/text; 8 MB combined). Optional `document_kind: receipt` marks the uploaded attachments as receipts; otherwise images are photos and documents are notes. The server bounds the actual request body, checks file signatures, stores original files and the typed statement, then uses Ali's intake and Isaac's canonical completion event. No provider request is made. Typed statements use source `import`; they are never labeled Plaud. `live` evidence mode means a real local upload, not a verified repair.

On 201, replace the client state with the response. Preserve mismatched equipment IDs: the backend records them as unresolved and verification blocks closure. Replacing the completion package increments its version and invalidates the old comparison/review; earlier original files remain stored. Each submission is the complete new evidence package, so include all files needed for that version. A stale revision returns 409; refresh and let the operator review before retrying. Other invalid inputs return 400; unauthorized origins return 403. No upload is accepted before a booked/active job or after closure/cancellation. The server refreshes Isaac's job before accepting evidence.

After upload, explicitly run `verify`, display its checks, then offer the separate reviewer action only if passing. Workbook sync is attempted and actual receipts remain authoritative; a workbook failure does not discard submitted evidence. The report includes completion version, claimed status, technician, and each evidence source/mode. Existing demo completion commands remain available. This is a backend increment: the 3D completion control still needs frontend wiring. Existing local-demo authentication and deployment limitations remain.

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

## Upload diagnosis and report handoff — 2026-09-29 21:49 UTC

The integration branch's `apps/web/public/mcc/js/integration.js` now implements **Upload & analyze**: POST the evidence, retain the returned revision, POST `analyze`, render the returned findings/missing information, and expose GET `/api/report` before a job exists. The evidence endpoint itself remains storage-only; clients must not invoke analysis twice. A failed analysis keeps the saved evidence and offers an explicit retry. Draft reports now include every finding, source evidence ID, uncertainty, analysis status and missing-information item. Unapproved scope is labeled accordingly.

The browser at port 8765 uses Claude's separate frontend, inspected at pushed commit `893a1c3`. It already invokes evidence upload and analysis itself. At diagnosis it rejected the upload locally because the backend had a scheduled repair. The backend was also in fixture mode. Changing either UI animation cannot enable a provider request or unlock the current inspection.

**Claude follow-up:** reuse `thermaldeskWorkflow.upload(file)` or align `backendAnalyze` with this contract, and refresh shared state after an analysis. Read the actual upload response with normal CORS instead of `mode: "no-cors"`; the current route returns local CORS headers. Surface the report link and missing information inside the phone view. An active repair remains locked; do not silently reset an existing case or its workbook, including a closed case. New independent cases are not implemented by this single-case demo.

The phone's palette-derived temperature estimates, severity and repair text are generated locally from an assumed scale, not returned by Crusoe. They must not be presented as measured temperatures, diagnostic findings or approved recommendations. The backend's evidence-linked draft and qualified review gates remain authoritative. Do not mark the analyzed step complete on a failed backend request.

Checks for this increment: six focused bridge/report regressions, 62 total offline tests, typecheck, production build, and the isolated production HTTP workflow through verified demo closure. No paid request or repair-state reset was performed by this diagnostic task. Another local session changed the running case/configuration during inspection; the later read-only snapshot reported a live needs-information draft. That is not an offline-test result or authorization for further calls.
