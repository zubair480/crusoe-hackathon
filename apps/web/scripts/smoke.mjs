// Runs against the local demo only. Use --reset-demo explicitly to rerun an existing case.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const base = process.env.THERMALDESK_URL ?? 'http://127.0.0.1:3001';
if (!['localhost', '127.0.0.1'].includes(new URL(base).hostname)) throw new Error('Smoke test requires a local demo server.');
const get = async path => { const response = await fetch(base + path); assert.equal(response.status, 200); return response; };
// Check before any mutation, including reset. A configured key is not permission to spend.
const health = await (await get('/api/health')).json();
for (const provider of ['crusoe', 'coordination']) {
  assert.equal(health.integrations[provider], 'simulated', `Offline smoke test refuses ${provider} mode ${health.integrations[provider]}. Select fixtures first.`);
}
// The Plaud health flag may describe already downloaded files. This test never calls
// the Plaud import/pull route, so cached recordings do not imply a live provider call.
assert.ok(['simulated', 'live-pulled'].includes(health.integrations.plaud), 'Offline smoke test refuses an active Plaud provider.');
assert.equal(health.integrations.excel, 'live-local-file');
let state = await (await get('/api/case')).json();
async function action(command, expected = 200, extra = {}) {
  const response = await fetch(base + '/api/case', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: base }, body: JSON.stringify({ command, expectedRevision: state.revision, reviewer: 'HTTP demo reviewer', ...extra }) });
  const result = await response.json();
  assert.equal(response.status, expected, JSON.stringify(result));
  if (expected === 200) state = result;
  return result;
}
if (process.argv.includes('--reset-demo')) await action('reset_demo');
else assert.equal(state.revision, 0, 'Demo already has work. Pass --reset-demo only if resetting it is intended.');
const form = new FormData();
form.set('file', new File(['Fictional technician note. No measured temperatures supplied.'], 'demo-note.txt', { type: 'text/plain' }));
form.set('expectedRevision', String(state.revision));
const upload = await fetch(base + '/api/evidence', { method: 'POST', headers: { Origin: base }, body: form });
assert.equal(upload.status, 201); state = await upload.json();
const noteFile = state.inspection.evidence.at(-1).uri.replace('local-evidence://', '');
assert.equal((await get('/api/evidence/' + noteFile)).status, 200);
const pdfForm = new FormData();
pdfForm.set('file', new File([await readFile(new URL('../../../fixtures/evidence/thermal-report.pdf', import.meta.url))], 'thermal-report.pdf', { type: 'application/pdf' }));
pdfForm.set('expectedRevision', String(state.revision));
const pdfUpload = await fetch(base + '/api/evidence', { method: 'POST', headers: { Origin: base }, body: pdfForm });
const pdfResult = await pdfUpload.json();
assert.equal(pdfUpload.status, 201, JSON.stringify(pdfResult)); state = pdfResult;
assert.ok(state.inspection.evidence.some(item => item.uri.endsWith('.pdf')));
assert.ok(state.inspection.evidence.some(item => item.kind === 'photo' && item.uri.endsWith('.png') && item.text.includes('Rendered page')));
await action('analyze'); await action('approve_scope', 409); await action('coordinate', 409);
await action('load_demo_scope'); await action('approve_scope'); await action('coordinate');
assert.equal(state.job.status, 'scheduled');
assert.equal(state.job.actions.find(a => a.action_type === 'schedule_sync').status, 'confirmed');
await action('notify_manager'); await action('cancel_technician'); await action('coordinate');
assert.equal(state.job.actions.filter(a => a.action_type === 'parts_order').length, 1);
await action('wrong_asset'); await action('verify'); await action('approve_closure', 409);
assert.equal(state.verification.result, 'mismatch');
await action('incomplete'); await action('verify'); await action('approve_closure', 409);
const completionForm = new FormData();
completionForm.set('expectedRevision', String(state.revision));
completionForm.set('technician_id', state.job.booking.technician_id);
completionForm.set('asset_id', state.job.asset_id);
completionForm.set('reported_status', 'complete');
completionForm.set('comments', 'Fictional technician reports the training prop replaced. Uploaded test evidence; no real repair claimed.');
completionForm.set('file', new File(['Original fixture completion attachment'], 'completion.txt', { type: 'text/plain' }));
const completionUpload = await fetch(base + '/api/completion', { method: 'POST', headers: { Origin: base }, body: completionForm });
const completionResult = await completionUpload.json();
assert.equal(completionUpload.status, 201, JSON.stringify(completionResult)); state = completionResult;
assert.equal(state.verification, null);
assert.equal(state.job.status, 'awaiting_verification');
const completionFile = state.completion.evidence.find(item => item.source === 'upload').uri.replace('local-evidence://', '');
assert.equal(await (await get('/api/evidence/' + completionFile)).text(), 'Original fixture completion attachment');
const duplicateCompletion = await fetch(base + '/api/completion', { method: 'POST', headers: { Origin: base }, body: completionForm });
assert.equal(duplicateCompletion.status, 409);
await action('approve_closure', 409);
await action('verify'); await action('approve_closure');
assert.equal(state.job.status, 'closed');
const schedule = await (await get('/api/schedule?format=json')).json();
assert.equal(schedule.rows[0].job_status, 'closed');
const workbook = Buffer.from(await (await get('/api/schedule')).arrayBuffer());
assert.equal(workbook.subarray(0, 2).toString(), 'PK');
const report = await (await get('/api/report')).text();
assert.ok(report.includes('approve_closure'));
assert.ok(report.includes('Synthetic demonstration'));
const denied = await fetch(base + '/api/case', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://untrusted.example' }, body: JSON.stringify({ command: 'reset_demo', expectedRevision: state.revision }) });
assert.equal(denied.status, 403);
console.log(JSON.stringify({ result: 'PASS', revision: state.revision, status: state.job.status, workbookBytes: workbook.length, reportBytes: report.length, checks: ['upload/download', 'approval gates', 'schedule/write/read-back', 'cancellation/rebooking', 'single purchase', 'wrong-asset block', 'incomplete block', 'completion upload/download', 'stale upload rejection', 'verified closure', 'report download', 'origin rejection'] }, null, 2));
