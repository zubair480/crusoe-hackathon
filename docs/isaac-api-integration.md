# Isaac coordinator and Band API

The web server uses Isaac's canonical file repository in its configured artifact directory. Excel writes happen through `createScheduleAdapter`; their actual receipts are stored in Isaac's job actions before the simulated manager message is composed. The app reads that canonical job when refreshing. Cancelled and proposed appointments are not published as confirmed schedule cells. The execution demo's supplier, technician and manager adapters remain simulated. The application's Band crew now runs a separate preparation workflow with public supplier links, operator-entered quotes and unsent email drafts; it never calls those simulated purchasing/booking adapters.

## Public supplier links and email drafts

Open `/api/preparation/workbench`, also linked as **Parts & dispatch** in the 3D workflow. An approved current scope unlocks preparation; synthetic approval is visibly labeled and disclosed inside each email. The current unapproved scope is never automatically approved to make the page look populated.

| Role | Actual preparation work |
|---|---|
| RepairCoordinator | Validates the current approved scope and coordinates the other four roles. |
| PartsSourcer | Builds Grainger and DigiKey search links and a McMaster-Carr catalog link, plus downloadable RFQ `.eml` files. It does not scrape prices, verify stock or retrieve supplier quotes automatically. |
| AuthorityCritic | Checks entered quotes for exact approved part/specification, quantity, review flags, expiry/delivery, currency and individual/combined planning budget. Displays rejection reasons and source provenance. Eligibility is for human review, not purchase authorization. |
| TechDispatcher | Uses a customer-entered roster to prepare downloadable technician availability enquiries. No email sends or bookings occur. |
| ScheduleReporter | Records preparation progress honestly; preparation does not change the execution workbook. Existing confirmed execution events still use the Excel adapter. |

`GET /api/preparation` returns the current scope, research links, saved quotes with source/recorder/time, critic results, roster and activity. `POST /api/preparation` uses `{command, expectedRevision, values}` with commands `prepare`, `quote`, `budget`, `contact`. The same local-origin and stale-revision checks apply. Monetary values are integer cents in `total_minor`; currency is a three-letter code. Quote values: `part_id`, `offered_part_id`, `specification`, `supplier`, `quantity`, `total_minor`, `currency`, public HTTPS `source_url`, timezone-bearing ISO `valid_until` and `delivery_at`, `recorded_by`. Budget values: `total_minor`, `currency`, `recorded_by`. Contact values: `name`, `email`, comma-separated `qualifications`, `recorded_by`.

`GET /api/preparation?draft=rfq&id=<part_id>` and `?draft=technician&id=<contact_id>` download UTF-8 email drafts with `X-Unsent: 1`. Nothing is sent automatically. All preparation data is local app metadata in `case.json`, bound to a fingerprint of the exact recommendation version, scope, parts and approval; changing that scope invalidates its preparation. Isaac remains the owner of canonical execution state. No shared v1 business contract is changed.

**Prepare work** runs the deterministic preparation steps locally without Band or paid requests. **Run preparation in Band** explicitly connects/posts through the five registered agents using the same preparation functions. It persists role outputs and routes to the next agent, then addresses the final report to RepairCoordinator. Unchanged dispatches are deduplicated; changing saved quotes, budget or contacts produces a new dispatch key. There is no language-model inference in this lane. The 2026-09-29 live run verified all five handoffs, final report delivery and duplicate-dispatch prevention. It exposed and fixed a startup race: the room must be persisted before agents connect, so ScheduleReporter can subscribe as its creator.

`npm run test:system` remains entirely offline. With explicit authorization, `npm run test:system -- --live-band` additionally creates a fictional case in its temporary server, posts to the registered Band agents, checks a matching and rejected quote, downloads both unsent email drafts, reads the final report from Band, and shuts all connections/server down. Evidence is saved in ignored `artifacts/band-preparation-run-<timestamp>/` (`result.json`, `band-transcript.json`, `preparation.json`, `dispatch.json`, and email drafts; failures preserve status). This option does not enable paid inference, reset the ordinary app case, purchase parts or contact human recipients.

Five provided Band credentials are stored locally in the ignored `packages/coordination/agent_config.yaml`. They are never returned by an endpoint. `BAND_AGENT_CONFIG` can override this path. `npm ci` then `npm run dev` starts the application; no Band sockets are started just by opening it. All five agent IDs and registered names were checked using read-only Band identity requests on 2026-09-29. On the user's subsequent run request, all five preparation roles completed a live Band handoff at 22:59 UTC with fictional inputs. The final report was read back from the coordinator's Band context; no supplier or technician email was sent.

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

`dispatch_band` requires an approved current recommendation. It does not approve a scope or accept a technician offer. Use the existing `/api/case` review commands for a labeled demo review. The app injects `createPreparationCrewHandler`; Band dispatch prepares research and drafts only. `band.business_actions` reports `research_and_drafts_only`. Isaac's original simulated execution crew remains in his package for its separate demo.

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

Offline tests cover real workbook success/conflict/reconciliation, canonical receipts, cancellation/rebooking/closure, the five-agent protocol with real Excel, agent-start cleanup, room-creator subscription, redacted errors, duplicate dispatch and uncertain send preservation. The separate live preparation run proves Band delivery for the draft-only workflow; it does not establish a live procurement or booking integration.
