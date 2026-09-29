import { readFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { analyzeInspection, CrusoeAdapter } from "../src/index.ts";
import type { Evidence, InspectionPackage } from "../src/types.ts";

const positional = process.argv.slice(2).filter((argument) => argument !== "--allow-billable-request");
const imagePath = positional[0];
const transcript = positional.slice(1).join(" ").trim();
if (process.env.CRUSOE_LIVE_REQUESTS_ENABLED !== "true" || !process.argv.includes("--allow-billable-request")) {
  console.error("Billable image analysis is disabled. Use the guarded verification command after explicit authorization.");
  process.exit(2);
}
if (!imagePath || !transcript) {
  console.error('Usage: npm run analyze:image -- /absolute/path/image.jpg "technician transcription"');
  process.exit(2);
}

const absolutePath = resolve(imagePath);
const bytes = await readFile(absolutePath);
const extension = absolutePath.toLowerCase().endsWith(".png") ? "png" : "jpeg";
const timestamp = new Date().toISOString();
const imageEvidence: Evidence = {
  id: "EV-THERMAL-LOCAL",
  kind: "thermal_image",
  asset_id: "LOCAL-DEMO-ASSET",
  source: "upload",
  mode: "live",
  uri: `local://${basename(absolutePath)}`,
  captured_at: null,
};
const inspection: InspectionPackage = {
  schema_version: "1.0",
  case_id: "LOCAL-DEMO-CASE",
  site_id: "LOCAL-DEMO-SITE",
  asset_id: "LOCAL-DEMO-ASSET",
  inspection_id: "LOCAL-DEMO-INSPECTION",
  evidence: [
    imageEvidence,
    {
      id: "EV-TRANSCRIPT-LOCAL",
      kind: "transcript",
      asset_id: "LOCAL-DEMO-ASSET",
      source: "upload",
      mode: "live",
      uri: "local://typed-transcript",
      captured_at: timestamp,
      text: transcript,
    },
  ],
  observations: [],
  missing_information: [
    "Calibrated numeric temperature measurement and units",
    "Operating load and comparison conditions",
    "Equipment identity/specifications confirmed by a qualified person",
  ],
  created_at: timestamp,
};

const adapter = new CrusoeAdapter({
  maxTokens: 1024,
  resolveImage: async (evidence) => {
    if (evidence.id !== imageEvidence.id) throw new Error(`Unexpected image evidence ${evidence.id}`);
    return `data:image/${extension};base64,${bytes.toString("base64")}`;
  },
});
const result = await analyzeInspection(inspection, { adapter });
console.log(JSON.stringify({ status: result.data.status, analysis_mode: result.data.analysis_mode, finding_count: result.data.findings.length, missing_information_count: result.data.missing_information.length, telemetry: result.telemetry }, null, 2));
