import { it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import ExcelJS from 'exceljs';
import { readSchedule, syncSchedule, columns, createScheduleAdapter, type CoordinatorScheduleRequest } from './index';
import type { RepairJob } from '@thermaldesk/contracts';
let directory: string, path: string;
beforeEach(async () => { directory = await mkdtemp(join(tmpdir(), 'thermaldesk-xlsx-')); path = join(directory, 'schedule.xlsx'); });
afterEach(async () => { await rm(directory, { recursive: true, force: true }); });
function job(version = 1): RepairJob {
  return { schema_version: '1.0', case_id: 'CASE', asset_id: 'ASSET', site_id: 'SITE', job_id: 'JOB', recommendation_id: 'REC', recommendation_version: 1, state_version: version, status: 'scheduled', authority: null, parts_status: 'available', booking: { technician_id: 'TECH', technician_name: 'Demo Tech', start_at: '2026-09-30T16:00:00Z', end_at: '2026-09-30T17:00:00Z', status: 'confirmed', confirmation_action_id: 'ACTION' }, actions: [], unresolved_findings: ['FIND'], closure_review: null, updated_at: '2026-09-29T18:00:00Z' };
}
it('writes an actual row, preserves unrelated rows, formulas, extra columns and formatting', async () => {
  const book = new ExcelJS.Workbook(); const sheet = book.addWorksheet('Schedule');
  sheet.addRow([...columns, 'Unrelated formula']);
  sheet.addRow(['OTHER', 'OTHER-ASSET', 'SITE']); sheet.getCell('K2').value = { formula: '1+2', result: 3 }; sheet.getCell('K2').font = { bold: true };
  book.addWorksheet('Notes').getCell('A1').value = 'Keep this';
  await book.xlsx.writeFile(path);
  const snapshot = await readSchedule(path);
  const result = await syncSchedule({ workbookPath: path, job: job(), idempotencyKey: 'first', expectedFingerprint: snapshot.fingerprint });
  expect(result.status, result.detail).toBe('confirmed');
  const reopened = new ExcelJS.Workbook(); await reopened.xlsx.readFile(path);
  expect(reopened.getWorksheet('Schedule')?.getCell('K2').formula).toBe('1+2');
  expect(reopened.getWorksheet('Schedule')?.getCell('K2').font.bold).toBe(true);
  expect(reopened.getWorksheet('Notes')?.getCell('A1').value).toBe('Keep this');
  expect(reopened.getWorksheet('Schedule')?.getCell('F3').value).toBeInstanceOf(Date);
  expect((await readSchedule(path)).rows.map(r => r.job_id)).toEqual(['OTHER', 'JOB']);
});
it('retries idempotently but rejects changed parameters and manually changed rows', async () => {
  const input = { workbookPath: path, job: job(), idempotencyKey: 'same', expectedFingerprint: null };
  const first = await syncSchedule(input); expect(first.status, first.detail).toBe('confirmed');
  const original = await readFile(path);
  expect((await syncSchedule(input)).action_id).toBe(first.action_id);
  expect(await readFile(path)).toEqual(original);
  expect((await syncSchedule({ ...input, job: job(2) })).status).toBe('failed');
  const book = new ExcelJS.Workbook(); await book.xlsx.readFile(path); book.getWorksheet('Schedule')!.getCell('E2').value = 'Manual change'; await book.xlsx.writeFile(path);
  const manual = await readFile(path);
  const retry = await syncSchedule(input);
  expect(retry.status).toBe('failed'); expect(retry.detail).toContain('manual edit');
  expect(await readFile(path)).toEqual(manual);
});
it('detects stale fingerprints and serializes two writers instead of losing an update', async () => {
  const [a, b] = await Promise.all([syncSchedule({ workbookPath: path, job: job(), idempotencyKey: 'a', expectedFingerprint: null }), syncSchedule({ workbookPath: path, job: { ...job(), job_id: 'SECOND' }, idempotencyKey: 'b', expectedFingerprint: null })]);
  expect([a, b].filter(x => x.status === 'confirmed')).toHaveLength(1);
  expect([a, b].filter(x => x.status === 'failed')).toHaveLength(1);
  expect((await readSchedule(path)).rows).toHaveLength(1);
});

it('bridges coordinator requests without hiding manual changes or accepting a different job row', async () => {
  let accepted: string | null = null;
  const adapter = createScheduleAdapter({ workbookPath: path, getExpectedFingerprint: () => accepted, onConfirmed: snapshot => { accepted = snapshot.fingerprint; } });
  const canonical = job();
  const request: CoordinatorScheduleRequest = {
    job_id: canonical.job_id, idempotency_key: 'bridge-1', reason: 'booking_confirmed', job: canonical,
    row: { job_id: canonical.job_id, asset_id: canonical.asset_id, site_id: canonical.site_id,
      technician_id: canonical.booking!.technician_id, technician_name: canonical.booking!.technician_name,
      start_at: canonical.booking!.start_at, end_at: canonical.booking!.end_at,
      parts_status: canonical.parts_status, job_status: canonical.status, last_updated_at: canonical.updated_at },
  };
  expect((await adapter.syncSchedule(request)).status).toBe('confirmed');
  expect(accepted).toBe((await readSchedule(path)).fingerprint);
  await expect(adapter.syncSchedule({ ...request, row: { ...request.row, asset_id: 'WRONG' } })).rejects.toThrow('canonical');
  const previous = accepted;
  const book = new ExcelJS.Workbook(); await book.xlsx.readFile(path);
  book.getWorksheet('Schedule')!.getCell('E2').value = 'Manual edit'; await book.xlsx.writeFile(path);
  const modified = await readFile(path);
  expect((await adapter.syncSchedule({ ...request, idempotency_key: 'bridge-2', job: job(2) })).status).toBe('failed');
  expect(accepted).toBe(previous);
  expect(await readFile(path)).toEqual(modified);
});
