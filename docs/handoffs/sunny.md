# Sunny handoff

Updated: 2026-09-29T21:01:20Z. Owner: Sunny. Branch: `codex/sunny-crusoe-analysis`.

## Current status

Runnable analysis implementation is at commit `6870c67`. The v1 `Recommendation.approval` input now accepts the shared `Approval | null` contract, so `compareCompletion` accepts an approved recommendation without an incompatible cast. Provider requests are opt-in, capped, recoverable, and covered with offline HTTP mocks. No provider call was made for this increment, and no further live demo is requested.

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

The returned `data` is the v1 snake_case business object. `Recommendation.approval` is `Approval | null`; analysis output still sets it to `null`, while completion comparison can consume a separately approved v1 recommendation. `telemetry` is operational metadata outside v1 records and contains provider/model/request/latency/usage/error metadata only—never credentials, image bytes, or transcripts.

## Setup and supported input

- Environment: `CRUSOE_API_KEY`; optional `CRUSOE_BASE_URL`, `CRUSOE_MODEL`, `CRUSOE_TIMEOUT_MS`, `CRUSOE_MAX_TOKENS`, and `CRUSOE_ENABLE_THINKING`. `CRUSOE_LIVE_REQUESTS_ENABLED` defaults to false.
- Documented 2026-09-29 default: `nvidia/Nemotron-3-Nano-Omni-Reasoning-30B-A3B` through Crusoe's OpenAI-compatible `/v1/chat/completions` endpoint. Confirm project access with `/v1/models` before a live demo.
- First input: v1 `InspectionPackage` with asset-linked evidence. Multimodal calls accept image references resolved by an injected `resolveImage` function; the local runner converts a JPEG/PNG to a data URL without copying it into Git.
- Missing calibrated measurements, units, load/comparison conditions, or equipment identity stay explicit. Heatmap colors never become invented temperatures. New analysis output remains `draft` or `needs_information` and never self-approves.

The standalone image runner has a double no-spend guard. A configured key alone cannot send a request; both an explicit environment opt-in and `--allow-billable-request` are required. Do not run it without separate authorization.

```bash
cd packages/analysis
CRUSOE_LIVE_REQUESTS_ENABLED=true npm run analyze:image -- /authorized/image.jpg "authorized transcript" --allow-billable-request
```

## Verification

- `npm test`: 10/10 passing on Node 22.20.0, offline only.
- Mocked request/response coverage includes image resolution to multimodal content, token cap and no-thinking settings, wrapped JSON, non-JSON/malformed output, invalid member types, rate limiting, provider errors, and disabled live requests with zero fetch calls.
- Contract coverage confirms an approved v1 Recommendation is accepted by `compareCompletion`; the wrong-asset DEMO-B evidence remains a mismatch for DEMO-A.
- Standalone guard check exited before file access or provider fetch when explicit authorization flags were absent.
- Fixture integration: `simulated`.
- Crusoe adapter: implemented but not exercised live in this increment. Provider success is not claimed by these offline checks.
- Telemetry persistence belongs to the web integration's ignored `analysis-telemetry.jsonl`; this package returns sanitized metadata and does not persist secrets or request bodies.

## Remaining work and named requests

- Ali: publish the exact `createInspectionPackage` signature and evidence URI/access contract when intake is runnable.
- Zubair: integrate commit `6870c67`; the approval compatibility, offline HTTP cases, and standalone no-spend guard address issue #4.
- A qualified evaluator must still confirm radiometric/calibration data, operating conditions, equipment specifications/history, comparison measurements, repair scope, and completion safety.
