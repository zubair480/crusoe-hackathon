import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { analyzeInspection, compareCompletion, CrusoeAdapter, extractJson, FixtureAnalysisAdapter } from "../src/index.ts";
import type { CompletionEvidence, InspectionPackage, Recommendation, RepairJob } from "../src/types.ts";

async function fixture<T>(name: string): Promise<T> {
  const text = await readFile(new URL(`../../../fixtures/${name}`, import.meta.url), "utf8");
  return JSON.parse(text).data as T;
}

const options = { adapter: new FixtureAnalysisAdapter(), now: () => new Date("2026-09-29T20:00:00Z"), idFactory: () => "TEST" };

test("incomplete inspection returns needs_information without calling a model", async () => {
  const inspection = await fixture<InspectionPackage>("inspection.json");
  const result = await analyzeInspection(inspection, options);
  assert.equal(result.data.status, "needs_information");
  assert.equal(result.data.approval, null);
  assert.equal(result.data.parts.length, 0);
  assert.match(result.data.missing_information.join(" "), /thermal image/i);
  assert.equal(result.telemetry.provider, "validation");
});

test("valid inputs produce a simulated draft with evidence links", async () => {
  const inspection = await fixture<InspectionPackage>("inspection.json");
  inspection.missing_information = [];
  inspection.evidence.push(
    { id: "EV-IMAGE", kind: "thermal_image", asset_id: "DEMO-A", source: "synthetic", mode: "simulated", uri: "repo://image.png", captured_at: inspection.created_at },
    { id: "EV-MEASURE", kind: "measurement", asset_id: "DEMO-A", source: "synthetic", mode: "simulated", uri: "repo://measurement.txt", captured_at: inspection.created_at, text: "Terminal temperature 61.2 C" },
  );
  const result = await analyzeInspection(inspection, options);
  assert.equal(result.data.status, "draft");
  assert.equal(result.data.analysis_mode, "simulated");
  assert.equal(result.data.approval, null);
  assert.ok(result.data.findings[0].evidence_ids.every((id) => inspection.evidence.some((item) => item.id === id)));
});

test("absent Crusoe credentials leave the case recoverable", async () => {
  const inspection = await fixture<InspectionPackage>("inspection.json");
  inspection.missing_information = [];
  inspection.evidence.push(
    { id: "EV-IMAGE", kind: "thermal_image", asset_id: "DEMO-A", source: "synthetic", mode: "simulated", uri: "repo://image.png", captured_at: inspection.created_at },
    { id: "EV-MEASURE", kind: "measurement", asset_id: "DEMO-A", source: "synthetic", mode: "simulated", uri: "repo://measurement.txt", captured_at: inspection.created_at, text: "Terminal temperature 61.2 C" },
  );
  const result = await analyzeInspection(inspection, { ...options, adapter: new CrusoeAdapter({ apiKey: "" }) });
  assert.equal(result.data.status, "needs_information");
  assert.equal(result.data.approval, null);
  assert.equal(result.telemetry.error_code, "not_configured");
});

test("wrong-asset completion cannot resolve DEMO-A", async () => {
  const recommendation = await fixture<Recommendation>("approved-recommendation.json");
  const completion = await fixture<CompletionEvidence>("completion-wrong-asset.json");
  const job: RepairJob = {
    schema_version: "1.0", case_id: "DEMO-CASE-001", site_id: "DEMO-SITE", asset_id: "DEMO-A", job_id: "JOB-001",
    recommendation_id: recommendation.recommendation_id, recommendation_version: recommendation.version, state_version: 1,
    status: "awaiting_verification", authority: null, parts_status: "available", booking: null, actions: [], unresolved_findings: [], closure_review: null,
    updated_at: "2026-09-29T19:00:00Z",
  };
  const result = await compareCompletion(job, recommendation, completion, { now: options.now, idFactory: options.idFactory });
  assert.equal(result.data.result, "mismatch");
  assert.match(result.data.missing_information.join(" "), /DEMO-B/);
  assert.equal(result.data.checks.find((item) => item.name === "identity_match")?.result, "fail");
});

test("reasoning wrappers and fenced model JSON are accepted", () => {
  const parsed = extractJson('<think>private reasoning</think>\nHere is the draft:\n```json\n{"findings":[],"repair_scope":"Review evidence.","missing_information":[]}\n```') as Record<string, unknown>;
  assert.deepEqual(parsed.findings, []);
  assert.equal(parsed.repair_scope, "Review evidence.");
});
