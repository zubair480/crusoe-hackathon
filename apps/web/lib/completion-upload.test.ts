import { beforeEach, afterEach, expect, it } from 'vitest';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CaseService } from './service';
import { CaseStore } from './store';
import { createAnalysisPorts } from './analysis-ports';
import { createCoordinationPorts } from './coordination-ports';
import { uploadCompletion } from './completion-upload';
import { exportReport } from './report';
import type { CaseState, Command } from './model';
import { readSchedule } from '@thermaldesk/excel';

let directory: string, service: CaseService;
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'completion-upload-'));
  service = new CaseService(new CaseStore(directory), createCoordinationPorts(directory, createAnalysisPorts(directory)));
});
afterEach(async () => { await rm(directory, { recursive: true, force: true }); });
const act = async (command: Command) => service.command({ command, reviewer: 'Demo reviewer', expectedRevision: (await service.read()).revision });
async function schedule() { await act('load_demo_scope'); await act('approve_scope'); return act('coordinate'); }
async function request(fields: Record<string, string> = {}, options: { type?: string; bytes?: string; origin?: string; noRevision?: boolean } = {}) {
  const state = await service.read();
  const form = new FormData();
  const defaults = { expectedRevision: String(state.revision), technician_id: state.job?.booking?.technician_id ?? 'TECH-1', asset_id: 'DEMO-A', comments: 'Technician reports the fictional training task complete.', reported_status: 'complete' };
  for (const [key, value] of Object.entries({ ...defaults, ...fields })) if (!(key === 'expectedRevision' && options.noRevision)) form.set(key, value);
  form.append('file', new File([options.bytes ?? 'Original technician evidence'], 'completion.txt', { type: options.type ?? 'text/plain' }));
  const outgoing = new Request('http://localhost:3000/api/completion', { method: 'POST', headers: { Origin: options.origin ?? 'http://localhost:3000' }, body: form });
  // Model received HTTP bytes, rather than cancelling Undici's FormData encoder.
  return new Request(outgoing.url, { method: 'POST', headers: outgoing.headers, body: await outgoing.arrayBuffer() });
}

it('persists originals through intake and Isaac, then requires verification and separate review before closure', async () => {
  await schedule();
  const response = await uploadCompletion(await request({ document_kind: 'receipt' }), service);
  expect(response.status).toBe(201);
  const state = await response.json() as CaseState;
  expect(state.job?.status).toBe('awaiting_verification');
  expect(state.verification).toBeNull();
  expect(state.job?.closure_review).toBeNull();
  const attachment = state.completion!.evidence.find(e => e.source === 'upload')!;
  expect(attachment.kind).toBe('receipt');
  expect(attachment.mode).toBe('live');
  expect(await readFile(join(directory, 'evidence', attachment.uri.replace('local-evidence://', '')), 'utf8')).toBe('Original technician evidence');
  expect((await readSchedule(service.workbookPath)).rows[0].job_status).toBe('awaiting_verification');
  await expect(act('approve_closure')).rejects.toThrow('Current completion');
  await act('verify');
  const closed = await act('approve_closure');
  expect(closed.job?.status).toBe('closed');
  expect(exportReport(closed)).toContain('upload (live)');
  expect(exportReport(closed)).toContain('import (live)');
  expect(exportReport(closed)).not.toContain('Plaud, parts orders');
  expect((await readSchedule(service.workbookPath)).rows[0].job_status).toBe('closed');
  expect((await uploadCompletion(await request(), service)).status).toBe(400);
});

it('retains wrong-asset evidence, invalidates older verification and keeps the job open', async () => {
  await schedule();
  await uploadCompletion(await request(), service);
  await act('verify');
  const oldCompletion = (await service.read()).completion!;
  const response = await uploadCompletion(await request({ asset_id: 'DEMO-B' }), service);
  expect(response.status).toBe(201);
  const state = await response.json() as CaseState;
  expect(state.completion?.version).toBe(oldCompletion.version + 1);
  expect(state.completion?.evidence.every(e => e.asset_id === 'DEMO-B')).toBe(true);
  expect(state.completion?.unresolved_items.join(' ')).toContain('DEMO-B');
  expect(state.verification).toBeNull();
  expect((await act('verify')).verification?.result).toBe('mismatch');
  await expect(act('approve_closure')).rejects.toThrow('unresolved');
  for (const evidence of oldCompletion.evidence) expect(await readFile(join(directory, 'evidence', evidence.uri.replace('local-evidence://', '')), 'utf8')).not.toBe('');
});

it('keeps incomplete work open even when a real file was uploaded', async () => {
  await schedule();
  expect((await uploadCompletion(await request({ reported_status: 'incomplete', comments: 'Part has not arrived.' }), service)).status).toBe(201);
  expect((await act('verify')).verification?.result).toBe('needs_information');
  await expect(act('approve_closure')).rejects.toThrow(/Current completion|unresolved/);
  expect((await service.read()).job?.status).not.toBe('closed');
});

it('rejects stale retries, missing revision, invalid files and untrusted origins without adding evidence', async () => {
  await schedule();
  const oldRequest = await request();
  await uploadCompletion(await request(), service);
  const before = await service.read();
  const files = await readdir(join(directory, 'evidence'));
  expect((await uploadCompletion(oldRequest, service)).status).toBe(409);
  expect((await uploadCompletion(await request({}, { noRevision: true }), service)).status).toBe(400);
  expect((await uploadCompletion(await request({}, { type: 'image/png', bytes: 'not PNG' }), service)).status).toBe(400);
  expect((await uploadCompletion(await request({}, { origin: 'https://untrusted.example' }), service)).status).toBe(403);
  expect((await service.read()).revision).toBe(before.revision);
  expect(await readdir(join(directory, 'evidence'))).toEqual(files);
});

it('rejects uploads before a repair exists and oversized bodies without trusting Content-Length', async () => {
  expect((await uploadCompletion(await request(), service)).status).toBe(400);
  await schedule();
  const oversized = await request({}, { bytes: 'x'.repeat(8 * 1024 * 1024 + 128 * 1024) });
  const response = await uploadCompletion(oversized, service);
  expect(response.status).toBe(400);
  expect((await response.json()).error).toContain('8 MB');
  expect((await service.read()).completion).toBeNull();
});
