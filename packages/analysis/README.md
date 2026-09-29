# ThermalDesk analysis package

Sunny's package validates inspection evidence, requests a cautious structured draft from Crusoe, and compares completion evidence with the approved scope. It never approves a recommendation or certifies equipment safety.

## Public API

```ts
analyzeInspection(inspection: InspectionPackage, options: AnalysisOptions): Promise<AnalysisResult<Recommendation>>

compareCompletion(
  job: RepairJob,
  approvedRecommendation: Recommendation,
  completion: CompletionEvidence,
  options?: ComparisonOptions,
): Promise<AnalysisResult<VerificationDraft>>
```

Business objects use the exact snake_case v1 contract. `AnalysisResult.telemetry` is operational metadata for the caller and is not part of the saved Recommendation or VerificationDraft envelope.

## Crusoe setup

1. Use Node.js 22.6 or newer.
2. Copy `.env.example` values into your secret manager or shell. Never commit the key.
3. Confirm the model is available to your Crusoe project using `GET /v1/models`. The documented default as of 2026-09-29 is `nvidia/Nemotron-3-Nano-Omni-Reasoning-30B-A3B`, selected for multimodal input. Override `CRUSOE_MODEL` rather than relying on an old identifier.
4. Construct `CrusoeAdapter`. If evidence URIs are private or local, pass `resolveImage`, which must return an authorized HTTPS URL or a supported data URL. The adapter never assumes a `repo://` URI is remotely accessible. Output is capped at 1,024 tokens by default. Thinking is disabled by default for this schema-extraction task; both settings can be explicitly overridden.

```ts
const adapter = new CrusoeAdapter({
  resolveImage: async (evidence) => storage.createShortLivedReadUrl(evidence.uri),
});
const result = await analyzeInspection(inspection, { adapter });
```

The supported first input is an `InspectionPackage` containing asset-linked evidence references, at least one thermal/photo image, and a numeric measurement with a temperature unit. A heatmap alone cannot supply a temperature. Operating load, emissivity, calibration, comparison conditions, and qualified assessment remain explicit missing information when not supplied.

Crusoe uses its OpenAI-compatible Chat Completions endpoint at `https://api.inference.crusoecloud.com/v1`. Provider/model, request ID when returned, latency, and token usage are returned separately in telemetry. Timeouts, rate limits, malformed output, and absent credentials return a recoverable `needs_information` Recommendation and never authorize downstream action.

## Simulated development

`FixtureAnalysisAdapter` is deterministic and always reports `analysis_mode: simulated`. It is useful for integration only and is not evidence of a live Crusoe call or diagnostic accuracy.

Run checks from this directory:

```bash
npm test
```

The local image command is billable and requires both an environment flag and an explicit command flag. Run it only after separate authorization; do not infer authorization from a configured credential:

```bash
CRUSOE_LIVE_REQUESTS_ENABLED=true npm run analyze:image -- ~/Downloads/thermal-contactor.jpg "This is contactor C12. The technician reported a burning smell and intermittent motor trips." --allow-billable-request
```

A real technical evaluation still requires radiometric/calibrated data, known operating conditions, equipment specifications/history, appropriate comparison measurements, and review by a qualified person.
