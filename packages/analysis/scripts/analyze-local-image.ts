import { readFile, stat } from "node:fs/promises";
import { basename, extname, resolve } from "node:path";
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
const extension = extname(absolutePath).toLowerCase();
if (![".png", ".jpg", ".jpeg"].includes(extension)) throw new Error("Only PNG and JPEG images are accepted.");
const metadata = await stat(absolutePath);
if (!metadata.isFile() || metadata.size < 8 || metadata.size > 5 * 1024 * 1024) throw new Error("Image must be a file between 8 bytes and 5 MB.");
const bytes = await readFile(absolutePath);
const isPng = bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
const isJpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes.at(-2) === 0xff && bytes.at(-1) === 0xd9;
if ((extension === ".png" && !isPng) || ([".jpg", ".jpeg"].includes(extension) && !isJpeg)) throw new Error("Image contents do not match the file extension.");
const mimeSubtype = isPng ? "png" : "jpeg";
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
  allowLiveRequests: true,
  resolveImage: async (evidence) => {
    if (evidence.id !== imageEvidence.id) throw new Error(`Unexpected image evidence ${evidence.id}`);
    return `data:image/${mimeSubtype};base64,${bytes.toString("base64")}`;
  },
});
const result = await analyzeInspection(inspection, { adapter });
console.log(JSON.stringify({ status: result.data.status, analysis_mode: result.data.analysis_mode, finding_count: result.data.findings.length, missing_information_count: result.data.missing_information.length, telemetry: result.telemetry }, null, 2));
