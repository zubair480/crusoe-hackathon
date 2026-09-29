import { afterEach, beforeEach, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ExcelJS from 'exceljs';
import { BAND_ROLES, advanceRepairJob, createCrewHandler, createMemoryRoom } from '@thermaldesk/coordination';
import { readSchedule } from '@thermaldesk/excel';
import { createCoordinationPorts } from './coordination-ports';
import { demoPorts, reviewableDemoScope } from './demo-ports';
import { CaseService } from './service';
import { CaseStore } from './store';
import type { Command } from './model';
let dir: string;
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'isaac-api-test-')); });
afterEach(async () => { await rm(dir, { recursive: true, force: true }); });
function setup() {
  const ports = createCoordinationPorts(dir, demoPorts);
  const service = new CaseService(new CaseStore(dir), ports);
  const act = async (command: Command, reviewer = 'Demo reviewer') => service.command({ command, reviewer, expectedRevision: (await service.read()).revision });
  const schedule = async () => { await act('load_demo_scope'); await act('approve_scope'); return act('coordinate'); };
  return { ports, service, act, schedule };
}
it('persists real Excel receipts in Isaac state and repeats no action on unchanged coordination', async () => {
  const { ports, schedule, act } = setup();
  const first = await schedule();
  const repeated = await act('coordinate');
  const canonical = (await ports.getDetail(first.job!.job_id)).job;
  expect(canonical).toEqual(repeated.job);
  expect(canonical.actions.filter(a => a.action_type === 'parts_order')).toHaveLength(1);
  expect(canonical.actions.filter(a => a.action_type === 'schedule_sync')).toHaveLength(1);
  expect(canonical.actions.find(a => a.action_type === 'schedule_sync')).toMatchObject({ mode: 'live', status: 'confirmed' });
  expect(canonical.actions.some(a => a.action_type === 'schedule_sync' && a.mode === 'simulated')).toBe(false);
});
it('records workbook conflict in canonical state and recovers only after explicit reconciliation', async () => {
  const { service, ports, schedule, act } = setup();
  await schedule();
  const book = new ExcelJS.Workbook(); await book.xlsx.readFile(service.workbookPath);
  book.getWorksheet('Schedule')!.getCell('E2').value = 'MANUAL'; await book.xlsx.writeFile(service.workbookPath);
  const failed = await act('sync_schedule');
  expect((await ports.getDetail(failed.job!.job_id)).job.actions.filter(a => a.action_type === 'schedule_sync').at(-1)?.status).toBe('failed');
  await expect(act('notify_manager')).rejects.toThrow('Excel schedule');
  const snapshot = await readSchedule(service.workbookPath);
  const fixed = await service.command({ command: 'reconcile_schedule', expectedRevision: (await service.read()).revision, reviewer: 'Reviewer', expectedWorkbookFingerprint: snapshot.fingerprint! });
  expect(fixed.schedule.rows[0].technician_name).not.toBe('MANUAL');
});
it('clears cancelled appointment cells and closes with the same canonical receipts', async () => {
  const { service, ports, schedule, act } = setup();
  await schedule(); await act('cancel_technician');
  expect((await readSchedule(service.workbookPath)).rows[0].technician_id).toBe('');
  await act('coordinate'); await act('complete'); await act('verify');
  const state = await act('approve_closure');
  expect((await ports.getDetail(state.job!.job_id)).job).toEqual(state.job);
  expect(state.schedule.rows[0].job_status).toBe('closed');
});
it('runs Isaac five-agent protocol against the actual app job store and Excel adapter offline', async () => {
  const ports = createCoordinationPorts(dir, demoPorts);
  const recommendation = reviewableDemoScope();
  recommendation.status = 'approved';
  recommendation.approval = { reviewer_id: 'demo', recommendation_version: recommendation.version, approved_at: new Date().toISOString(), mode: 'simulated' };
  const job = await ports.createBandJob(recommendation, null);
  const adapters = await ports.adaptersForJob(job.job_id);
  const room = createMemoryRoom();
  for (const role of BAND_ROLES) room.registerPeer(role, createCrewHandler(role, { context: ports.context, adapters }));
  room.join('Demo'); room.join('RepairCoordinator');
  await room.post('Demo', `coordinate ${job.job_id}`, ['RepairCoordinator']);
  const offer = (await ports.getDetail(job.job_id)).offers.find(item => item.status === 'awaiting_response')!;
  expect(offer).toBeDefined();
  await advanceRepairJob(job.job_id, { event_id: 'reply-1', type: 'technician_responded', technician_id: offer.technician_id,
    response: 'accepted', response_reference: 'SIM-REPLY', response_text: 'Demo only', mode: 'simulated' }, ports.context);
  await room.post('Demo', `update ${job.job_id}`, ['RepairCoordinator']);
  const final = await ports.getDetail(job.job_id);
  expect(final.job.status).toBe('scheduled');
  expect(final.verdict_requests.filter(v => v.status === 'approved')).toHaveLength(2);
  expect((await readSchedule(join(dir, 'demo-schedule.xlsx'))).rows[0].job_id).toBe(job.job_id);
  expect(final.job.actions.find(a => a.action_type === 'schedule_sync')).toMatchObject({ mode: 'live', status: 'confirmed' });
});
