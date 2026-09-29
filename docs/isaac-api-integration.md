# Isaac coordinator and Band API

The web server uses Isaac's canonical file repository in its configured artifact directory. Excel writes now happen through `createScheduleAdapter`; their actual receipts are stored in Isaac's job actions before the simulated manager message is composed. The app reads that canonical job when refreshing. Cancelled and proposed appointments are not published as confirmed schedule cells. Supplier, technician and manager adapters remain simulated.

Five provided Band credentials are stored locally in the ignored `packages/coordination/agent_config.yaml`. They are never returned by an endpoint. `BAND_AGENT_CONFIG` can override this path. `npm ci` then `npm run dev` starts the application; no Band sockets are started just by opening it. All five agent IDs and registered names were checked using read-only Band identity requests on 2026-09-29. No live room dispatch was run in this integration task.

## HTTP API

`GET /api/coordination` returns the current case revision, canonical job detail (including open escalations, offers, verdicts and parts handoff), timeline, and Band configuration/connection/room status. It never contacts Band. `GET /api/case` refreshes job state from Isaac's repository, including changes received through Band.

All POST requests require the same local Origin header as `/api/case`, JSON content type, and `expectedRevision` from the latest case read. A stale mutation returns 409; a disallowed Origin returns 403. This is the local demo's origin policy, not production authentication.

`POST /api/coordination` accepts:

| command | Additional fields | Result |
|---|---|---|
| `check_band` | none | Read-only identity checks of all five configured agents; no connections or messages |
| `start_band` | `allowLiveBand: true` | Connect the five agents for the current approved job |
| `stop_band` | none | Disconnect this application's crew |
| `dispatch_band` | `allowLiveBand: true` | Create/reuse the approved job, persist its Band runtime and room, post kickoff or current-state update |
| `event` | `event`, optional `allowLiveBand: true` | Apply an execution event; optionally post the resulting update into Band |

`dispatch_band` requires an approved current recommendation. It does not approve a scope or accept a technician offer. Use the existing `/api/case` review commands to record a qualified demo review first. Purchasing, communication and acceptance remain explicitly simulated in this build.

For an accepted simulated offer, use the `technician_id` from the returned `detail.offers`:

```json
{
  "command": "event",
  "expectedRevision": 4,
  "allowLiveBand": true,
  "event": {
    "event_id": "unique-persisted-reply-id",
    "type": "technician_responded",
    "technician_id": "TECH-DEMO-1",
    "response": "accepted",
    "response_reference": "SIM-REPLY-001",
    "response_text": "Accepted for the fictional demo only.",
    "mode": "simulated"
  }
}
```

Other accepted execution events are `technician_cancelled`, `parts_order_updated`, `work_started`, and `job_cancelled`; payloads follow Isaac's exported `WorkflowEvent` type. Approval, critic verdict and completion events cannot be injected through this generic endpoint. Existing evidence/comparison/closure commands keep their separate gates. After those case commands, `dispatch_band` publishes the changed state to the room when desired. `sync_schedule` and the ordinary case commands update the real local workbook.

## Persistence and limits

- `coordination/` contains canonical job records and idempotent action history.
- `schedule-state.json` contains the last accepted workbook fingerprint; manual Excel changes require explicit reconciliation. Existing case fingerprints migrate without trusting arbitrary disk edits.
- `band-rooms.json` contains job/room IDs and pending or confirmed dispatch intents. Confirmed messages are deduplicated. A timeout leaves a pending outcome and does not resend blindly; inspect the provider room before manually reconciling an uncertain setup/send. No automatic recovery claims are made for uncertain remote creation.
- The crew subscribes only to this app's persisted room for the active job and rejects envelopes naming other jobs. Stop the current crew before switching jobs. The local Next.js process must remain running for live Band event handling; a distributed/serverless worker is not implemented.
- `allowLiveBand: true` is explicit authorization by the local API caller to connect or post. It is not permission for paid model requests, real purchases, or technician/manager messages. Keep `CRUSOE_LIVE_REQUESTS_ENABLED=false` and fixture analysis for development.
- The injected Excel adapter declares `local_workbook: true`. This permits only local schedule writes under demo authority while preserving real `mode: live` receipts. Other live adapters remain rejected by simulated authority and approval. This is an adapter capability, not a change to the shared JSON schema.

Offline tests cover real workbook success/conflict/reconciliation, canonical receipts, cancellation/rebooking/closure, the five-agent protocol with real Excel, agent-start cleanup, redacted errors, duplicate dispatch and uncertain send preservation. Live identity verification does not prove live room delivery; the new app transport was tested with mocked Band responses.
