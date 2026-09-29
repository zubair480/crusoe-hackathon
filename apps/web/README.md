# Local backend

From repository root: `npm ci`, `npm run dev`. Node 22+, npm workspaces. No API keys needed for the labeled demo. Claude owns the 3D frontend; this package currently supplies API routes and placeholder page files.

See `docs/frontend-handoff.md` for requests and the exact happy/exception paths. Runtime files go into `artifacts/thermaldesk-demo/` under the server's working directory and are ignored by Git. Case updates persist through restart, serialize cooperating processes with a lock file, and reject stale revisions. If a process crashes while holding a lock, first verify it is no longer running before manually removing that specific lock; no automatic stale-lock override occurs.

The app has no user authentication or tenant isolation. Development/start scripts bind to loopback; mutation routes require the same local origin. Do not expose this demonstration as a live operations service. Demo reviewer names are traceable labels, not verified professional identities.

Use dependency injection through TeamPorts to integrate Ali/Sunny/Isaac's modules. Do not label fixture operations live. Real uploads are stored, but thermal pixels are not diagnostically interpreted and Plaud is not connected. The schema, approval version and equipment checks still apply to adapter output.

Sunny's analysis module is integrated. To explicitly enable Crusoe, copy `.env.example` to `.env.local`, set `THERMALDESK_ANALYSIS_MODE=crusoe` and your real `CRUSOE_API_KEY`, and restart. Check the selected model's availability on your account. The default fixture has no image, so input validation stops before a provider call. A locally uploaded authorized PNG/JPEG can be resolved for the model; missing calibrated measurements remain missing. No Crusoe key is configured in the implementation environment and no genuine inference result has been claimed.

`npm test`, `npm run typecheck`, `npm run build` are the required checks. The report is an HTML attachment; open it and use browser print-to-PDF if desired. A dedicated PDF exporter is not implemented.
