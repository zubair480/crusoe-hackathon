# Sunny handoff

Updated: 2026-09-29T20:17:24Z. Owner: Sunny. Branch: `codex/sunny-crusoe-analysis`.

## Current status

First runnable analysis increment implemented in commit `b13c614`. It validates inspection inputs, supports injected live/simulated inference, creates contract-shaped draft recommendations, compares completion identities/evidence, and includes a local JPEG/PNG Crusoe runner. No live request has been claimed: this agent environment has no `CRUSOE_API_KEY`, and Sunny must run the documented local command from her configured Terminal.

## Public interfaces

```ts
analyzeInspection(inspection: InspectionPackage, options: AnalysisOptions): Promise<AnalysisResult<Recommendation>>

compareCompletion(
  job: RepairJob,
  approvedRecommendation: Recommendation,
  completion: CompletionEvidence,
  options?: ComparisonOptions,
): Promise<AnalysisResult<VerificationDraft>>
```

The returned `data` is the v1 snake_case business object. `telemetry` is operational metadata for the caller and records provider, model, request ID when supplied, latency, usage, and recoverable error category.

## Setup and supported input

- Environment: `CRUSOE_API_KEY`; optional `CRUSOE_BASE_URL`, `CRUSOE_MODEL`, and `CRUSOE_TIMEOUT_MS`.
- Documented 2026-09-29 default: `nvidia/Nemotron-3-Nano-Omni-Reasoning-30B-A3B` through Crusoe's OpenAI-compatible `/v1/chat/completions` endpoint. Confirm project access with `/v1/models` before a live demo.
- First input: v1 `InspectionPackage` with asset-linked evidence. Multimodal calls accept image references resolved by an injected `resolveImage` function; the local runner converts a JPEG/PNG to a data URL without copying it into Git.
- Missing calibrated measurements, units, load/comparison conditions, or equipment identity stay explicit. Heatmap colors never become invented temperatures. Output remains `draft` or `needs_information`; approval is always `null`.

Local image command:

```bash
cd packages/analysis
npm run analyze:image -- ~/Downloads/thermal-contactor.jpg "This is contactor C12. The technician reported a burning smell and intermittent motor trips."
```

## Verification

- `npm test`: 4/4 passing on Node 22.20.0.
- Covered incomplete inspection, evidence-linked simulated draft, absent-credential recovery, and DEMO-B completion evidence mismatch against DEMO-A.
- Fixture integration: `simulated`.
- Crusoe integration: implemented, `not_configured` in the agent environment; a genuine request/response and measured latency remain required.

## Remaining work and named requests

- Sunny: run the local image command with her configured Crusoe key; capture only sanitized output/telemetry (never the key), validate the Recommendation envelope, and record model/request/latency.
- Ali: publish the exact `createInspectionPackage` signature and evidence URI/access contract when intake is runnable.
- Zubair: confirm how operational telemetry should be persisted; it is intentionally outside the v1 business object because Sunny does not own `contracts/`.
- A qualified evaluator must still confirm radiometric/calibration data, operating conditions, equipment specifications/history, comparison measurements, repair scope, and completion safety.
