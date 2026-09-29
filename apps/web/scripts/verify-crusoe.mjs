// One bounded request with synthetic data. No retries and no customer information.
import { deflateSync } from 'node:zlib';
import { mkdir, writeFile } from 'node:fs/promises';
import { CrusoeAdapter } from '../../../packages/analysis/src/index.ts';

const allow = process.argv.includes('--allow-billable-request');
const mode = process.argv.includes('--image') ? 'image' : 'text';
const maxArg = process.argv.find(arg => arg.startsWith('--max-tokens='));
const maxTokens = Number(maxArg?.split('=')[1] ?? (mode === 'image' ? 1024 : 256));
if (process.env.CRUSOE_LIVE_REQUESTS_ENABLED !== 'true' || !allow) {
  console.log(JSON.stringify({ result: 'DISABLED', networkRequests: 0, reason: 'Live flag and explicit billable flag are both required.' }));
  process.exit(0);
}
if (!process.env.CRUSOE_API_KEY) throw new Error('CRUSOE_API_KEY is not configured.');
if (!Number.isInteger(maxTokens) || maxTokens < 1 || maxTokens > 2048) throw new Error('Verification max tokens must be 1..2048.');

function crc32(bytes) {
  let value = 0xffffffff;
  for (const byte of bytes) {
    value ^= byte;
    for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ (0xedb88320 & -(value & 1));
  }
  return (value ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const name = Buffer.from(type); const length = Buffer.alloc(4); length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4); checksum.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([length, name, data, checksum]);
}
function syntheticThermalPng(size = 512) {
  const raw = Buffer.alloc((size * 3 + 1) * size);
  for (let y = 0; y < size; y++) {
    const row = y * (size * 3 + 1); raw[row] = 0;
    for (let x = 0; x < size; x++) {
      const d1 = Math.hypot(x - size * .68, y - size * .42) / size;
      const d2 = Math.hypot(x - size * .30, y - size * .72) / size;
      const heat = Math.min(1, .12 + .95 * Math.exp(-d1 * d1 * 90) + .50 * Math.exp(-d2 * d2 * 120));
      const offset = row + 1 + x * 3;
      raw[offset] = Math.round(255 * heat);
      raw[offset + 1] = Math.round(210 * Math.max(0, heat - .32));
      raw[offset + 2] = Math.round(255 * Math.max(0, .35 - heat));
    }
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

const timestamp = new Date().toISOString();
const image = syntheticThermalPng();
const evidence = [
  { id: 'EV-MEASURE', kind: 'measurement', asset_id: 'SYNTHETIC-PANEL-A', source: 'synthetic', mode: 'simulated', uri: 'synthetic://measurement', captured_at: timestamp, text: 'Synthetic demo measurement: target terminal 61.2 C, comparable terminal 34.8 C; operating load 68 percent.' },
  { id: 'EV-NOTE', kind: 'note', asset_id: 'SYNTHETIC-PANEL-A', source: 'synthetic', mode: 'simulated', uri: 'synthetic://note', captured_at: timestamp, text: 'Synthetic demo only. Qualified review required; do not treat image colors as calibrated temperatures.' },
];
if (mode === 'image') evidence.unshift({ id: 'EV-THERMAL', kind: 'thermal_image', asset_id: 'SYNTHETIC-PANEL-A', source: 'synthetic', mode: 'simulated', uri: 'synthetic://thermal.png', captured_at: timestamp });
const inspection = {
  schema_version: '1.0', case_id: 'SYNTHETIC-CRUSOE-CHECK', site_id: 'SYNTHETIC-SITE', asset_id: 'SYNTHETIC-PANEL-A', inspection_id: `SYNTHETIC-${mode.toUpperCase()}`,
  evidence, observations: [{ id: 'OBS-1', text: 'Synthetic elevated terminal measurement requires qualified assessment.', evidence_ids: mode === 'image' ? ['EV-THERMAL','EV-MEASURE'] : ['EV-MEASURE'], segment_ids: [], needs_review: true }],
  missing_information: ['Actual calibrated radiometric file and equipment specification are not supplied in this synthetic check.'], created_at: timestamp,
};
let networkRequests = 0;
let providerUsage;
let providerRequestId;
let providerModel;
let providerFinishReason;
let providerContent;
const adapter = new CrusoeAdapter({
  maxTokens, timeoutMs: 60000,
  fetchImpl: async (input, init) => {
    if (++networkRequests > 1) throw new Error('Verification request limit exceeded.');
    const response = await fetch(input, init);
    try {
      const body = await response.clone().json();
      providerUsage = body.usage;
      providerRequestId = body.id;
      providerModel = body.model;
      providerFinishReason = body.choices?.[0]?.finish_reason;
      providerContent = body.choices?.[0]?.message?.content;
    } catch { /* The adapter will classify non-JSON safely. */ }
    return response;
  },
  resolveImage: async item => {
    if (item.id !== 'EV-THERMAL') throw new Error('Unexpected image evidence.');
    return `data:image/png;base64,${image.toString('base64')}`;
  },
});
try {
  const result = await adapter.analyze(inspection);
  const usage = result.telemetry.usage ?? {};
  const estimatedCostUsd = ((usage.prompt_tokens ?? 0) * 0.30 + (usage.completion_tokens ?? 0) * 1.83) / 1_000_000;
  const saved = { scope: `${mode} synthetic provider integration; not a diagnostic evaluation`, result: 'PASS', networkRequests, maxTokens, estimatedCostUsd, telemetry: result.telemetry, draft: result.draft };
  await mkdir('artifacts/crusoe-verification', { recursive: true });
  const output = `artifacts/crusoe-verification/${mode}-${Date.now()}.json`;
  await writeFile(output, JSON.stringify(saved, null, 2));
  console.log(JSON.stringify({ result: 'PASS', mode, networkRequests, maxTokens, estimatedCostUsd, telemetry: result.telemetry, findings: result.draft.findings.length, output }));
} catch (error) {
  const usage = providerUsage ?? {};
  const estimatedCostUsd = ((usage.prompt_tokens ?? 0) * 0.30 + (usage.completion_tokens ?? 0) * 1.83) / 1_000_000;
  const saved = { scope: `${mode} synthetic provider integration failure`, result: 'FAIL', category: error?.code ?? 'verification_error', networkRequests, maxTokens, estimatedCostUsd,
    provider: { request_id: providerRequestId, model: providerModel, finish_reason: providerFinishReason, usage, content: providerContent } };
  await mkdir('artifacts/crusoe-verification', { recursive: true });
  const output = `artifacts/crusoe-verification/${mode}-failure-${Date.now()}.json`;
  await writeFile(output, JSON.stringify(saved, null, 2));
  console.error(JSON.stringify({ result: 'FAIL', mode, networkRequests, maxTokens, category: saved.category, estimatedCostUsd, request_id: providerRequestId, model: providerModel, finish_reason: providerFinishReason, usage, output }));
  process.exit(1);
}
