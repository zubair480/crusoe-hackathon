import type { Evidence, InferenceAdapter, InferenceDraft, InferenceResponse, InspectionPackage } from "./types.ts";

export interface CrusoeAdapterOptions {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  resolveImage?: (evidence: Evidence) => Promise<string>;
}

const DEFAULT_BASE_URL = "https://api.inference.crusoecloud.com/v1";
const DEFAULT_MODEL = "nvidia/Nemotron-3-Nano-Omni-Reasoning-30B-A3B";

function extractJson(text: string): unknown {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  return JSON.parse(trimmed);
}

function isDraft(value: unknown): value is InferenceDraft {
  if (!value || typeof value !== "object") return false;
  const draft = value as Record<string, unknown>;
  if (!Array.isArray(draft.findings) || typeof draft.repair_scope !== "string" || !Array.isArray(draft.missing_information)) return false;
  return draft.findings.every((finding) => {
    if (!finding || typeof finding !== "object") return false;
    const item = finding as Record<string, unknown>;
    return typeof item.description === "string" && Array.isArray(item.evidence_ids) &&
      ["unassessed", "low", "medium", "high"].includes(String(item.severity)) && Array.isArray(item.uncertainties);
  });
}

export class CrusoeInferenceError extends Error {
  readonly code: "not_configured" | "timeout" | "rate_limited" | "provider_error" | "malformed_output";

  constructor(code: "not_configured" | "timeout" | "rate_limited" | "provider_error" | "malformed_output", message: string) {
    super(message);
    this.code = code;
  }
}

export class CrusoeAdapter implements InferenceAdapter {
  private readonly apiKey: string | undefined;
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly resolveImage?: (evidence: Evidence) => Promise<string>;

  constructor(options: CrusoeAdapterOptions = {}) {
    this.apiKey = options.apiKey ?? process.env.CRUSOE_API_KEY;
    this.baseUrl = (options.baseUrl ?? process.env.CRUSOE_BASE_URL ?? DEFAULT_BASE_URL).replace(/\/$/, "");
    this.model = options.model ?? process.env.CRUSOE_MODEL ?? DEFAULT_MODEL;
    this.timeoutMs = options.timeoutMs ?? Number(process.env.CRUSOE_TIMEOUT_MS ?? 30_000);
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.resolveImage = options.resolveImage;
  }

  async analyze(inspection: InspectionPackage): Promise<InferenceResponse> {
    if (!this.apiKey) throw new CrusoeInferenceError("not_configured", "CRUSOE_API_KEY is not configured.");
    const started = Date.now();
    const evidenceSummary = inspection.evidence.map(({ id, kind, asset_id, text, captured_at }) => ({ id, kind, asset_id, text, captured_at }));
    const content: Array<Record<string, unknown>> = [{
      type: "text",
      text: `Analyze this inspection as an evidence-linked maintenance draft. Do not approve work, certify safety, infer temperatures from colors, or invent operating conditions or part specifications. Return ONLY JSON with keys findings, repair_scope, and missing_information. Each finding must have description, evidence_ids, severity (unassessed|low|medium|high), and uncertainties. Inspection: ${JSON.stringify({ ...inspection, evidence: evidenceSummary })}`,
    }];

    if (this.resolveImage) {
      for (const evidence of inspection.evidence.filter((item) => item.kind === "thermal_image" || item.kind === "photo")) {
        content.push({ type: "text", text: `Evidence image ${evidence.id}:` });
        content.push({ type: "image_url", image_url: { url: await this.resolveImage(evidence) } });
      }
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: this.model,
          temperature: 0,
          messages: [
            { role: "system", content: "You produce cautious, structured draft maintenance analysis for qualified human review." },
            { role: "user", content },
          ],
        }),
        signal: controller.signal,
      });
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") throw new CrusoeInferenceError("timeout", `Crusoe request exceeded ${this.timeoutMs} ms.`);
      throw new CrusoeInferenceError("provider_error", error instanceof Error ? error.message : "Crusoe request failed.");
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      const detail = (await response.text()).slice(0, 500);
      throw new CrusoeInferenceError(response.status === 429 ? "rate_limited" : "provider_error", `Crusoe returned HTTP ${response.status}: ${detail}`);
    }
    const body = await response.json() as Record<string, any>;
    try {
      const draft = extractJson(String(body.choices?.[0]?.message?.content ?? ""));
      if (!isDraft(draft)) throw new Error("Response does not match the draft shape.");
      return {
        draft,
        mode: "live",
        telemetry: {
          provider: "crusoe",
          model: String(body.model ?? this.model),
          request_id: typeof body.id === "string" ? body.id : response.headers.get("x-request-id"),
          latency_ms: Date.now() - started,
          usage: body.usage ? {
            prompt_tokens: body.usage.prompt_tokens,
            completion_tokens: body.usage.completion_tokens,
            total_tokens: body.usage.total_tokens,
          } : undefined,
        },
      };
    } catch (error) {
      throw new CrusoeInferenceError("malformed_output", error instanceof Error ? error.message : "Crusoe returned malformed output.");
    }
  }
}
