import ExcelJS from 'exceljs';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, open, unlink } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { ActionReceipt, RepairJob } from '@thermaldesk/contracts';
export { createScheduleAdapter, type CoordinatorScheduleRequest, type CoordinatorScheduleOptions } from './coordinator';

export const columns = ['job_id', 'asset_id', 'site_id', 'technician_id', 'technician_name', 'start_at', 'end_at', 'parts_status', 'job_status', 'last_updated_at'] as const;
export type ScheduleRow = Record<typeof columns[number], string>;
export interface ScheduleInput {
  workbookPath: string;
  job: RepairJob;
  idempotencyKey: string;
  expectedFingerprint: string | null;
}
export interface ScheduleSnapshot { fingerprint: string | null; rows: ScheduleRow[] }
const fingerprint = (buffer: Buffer) => createHash('sha256').update(buffer).digest('hex');
const iso = (value?: string) => value ? new Date(value).toISOString() : '';

async function bytes(path: string): Promise<Buffer | null> {
  try { return await readFile(path); } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

function headerMap(sheet: ExcelJS.Worksheet): Map<string, number> {
  const map = new Map<string, number>();
  sheet.getRow(1).eachCell((cell, col) => {
    const key = cell.text;
    if (map.has(key)) throw new Error(`Duplicate column: ${key}`);
    map.set(key, col);
  });
  for (const key of columns) if (!map.has(key)) throw new Error(`Missing schedule column: ${key}`);
  return map;
}

function rowsFrom(sheet: ExcelJS.Worksheet): ScheduleRow[] {
  const map = headerMap(sheet);
  const rows: ScheduleRow[] = [];
  const ids = new Set<string>();
  sheet.eachRow((row, index) => {
    if (index === 1) return;
    const jobId = row.getCell(map.get('job_id')!).text;
    if (!jobId) return;
    if (ids.has(jobId)) throw new Error(`Duplicate job_id: ${jobId}`);
    ids.add(jobId);
    rows.push(Object.fromEntries(columns.map(key => {
      const cell = row.getCell(map.get(key)!);
      return [key, cell.value instanceof Date ? cell.value.toISOString() : cell.text];
    })) as ScheduleRow);
  });
  return rows;
}

export async function readSchedule(workbookPath: string): Promise<ScheduleSnapshot> {
  const content = await bytes(workbookPath);
  if (!content) return { fingerprint: null, rows: [] };
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(content as unknown as ExcelJS.Buffer);
  const sheet = book.getWorksheet('Schedule');
  if (!sheet) throw new Error('Workbook has no Schedule sheet; choose the correct workbook.');
  return { fingerprint: fingerprint(content), rows: rowsFrom(sheet) };
}

// Exclusive file lock serializes cooperating app processes. Never remove another writer's lock.
async function lock(path: string): Promise<() => Promise<void>> {
  for (let attempt = 0; attempt < 50; attempt++) {
    try {
      const handle = await open(path, 'wx');
      return async () => { await handle.close(); await unlink(path); };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      await new Promise(resolve => setTimeout(resolve, 40));
    }
  }
  throw new Error('Workbook is busy. Retry after the current writer finishes.');
}

export async function syncSchedule(input: ScheduleInput): Promise<ActionReceipt> {
  const { workbookPath, job, idempotencyKey, expectedFingerprint } = input;
  const at = new Date().toISOString();
  const receipt: ActionReceipt = {
    action_id: `xlsx-${randomUUID()}`, job_id: job.job_id, action_type: 'schedule_sync',
    idempotency_key: idempotencyKey, mode: 'live', status: 'failed',
    provider_reference: null, evidence_ids: [], detail: '', recorded_at: at,
  };
  let release: (() => Promise<void>) | undefined;
  let temporary: string | undefined;
  try {
    await mkdir(dirname(workbookPath), { recursive: true });
    release = await lock(`${workbookPath}.lock`);
    const before = await bytes(workbookPath);
    const book = new ExcelJS.Workbook();
    if (before) await book.xlsx.load(before as unknown as ExcelJS.Buffer);
    const ledger = book.getWorksheet('_ThermalDeskActions');
    const payload = JSON.stringify([job.job_id, job.state_version, job.status, job.parts_status, job.booking]);
    if (ledger) {
      let previous: ActionReceipt | undefined;
      ledger.eachRow((row, index) => {
        if (index > 1 && row.getCell(1).text === idempotencyKey) {
          if (row.getCell(2).text !== payload) throw new Error('Idempotency key reused for a different schedule update.');
          previous = JSON.parse(row.getCell(3).text) as ActionReceipt;
        }
      });
      if (previous) {
        const existing = book.getWorksheet('Schedule');
        const row = existing && rowsFrom(existing).find(r => r.job_id === job.job_id);
        if (!row || row.asset_id !== job.asset_id || row.site_id !== job.site_id || row.job_status !== job.status || row.parts_status !== job.parts_status || row.technician_id !== (job.booking?.technician_id ?? '') || row.technician_name !== (job.booking?.technician_name ?? '') || row.start_at !== iso(job.booking?.start_at) || row.end_at !== iso(job.booking?.end_at)) throw new Error('Previously updated workbook row was changed. Reconcile the manual edit before retrying.');
        return previous;
      }
    }
    if ((before ? fingerprint(before) : null) !== expectedFingerprint) {
      throw new Error('Workbook changed outside this update. Review and reconcile the current schedule first.');
    }
    if (job.status === 'closed' && job.closure_review?.decision !== 'approve_closure') throw new Error('Closure review is required.');
    if (job.status === 'scheduled' && job.booking?.status !== 'confirmed') throw new Error('A confirmed booking is required.');
    let sheet = book.getWorksheet('Schedule');
    if (!sheet && before) throw new Error('Workbook has no Schedule sheet; refusing to alter an unrelated workbook.');
    if (!sheet) {
      sheet = book.addWorksheet('Schedule', { views: [{ state: 'frozen', ySplit: 1 }] });
      sheet.addRow([...columns]);
      sheet.columns.forEach((col, i) => { col.width = i === 4 ? 25 : i === 5 || i === 6 || i === 9 ? 28 : 22; });
      sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
      sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF142B3B' } };
      sheet.getRow(1).height = 28;
      sheet.autoFilter = { from: 'A1', to: 'J1' };
    }
    rowsFrom(sheet); // Validate uniqueness before matching the stable key.
    const map = headerMap(sheet);
    let rowNumber = 0;
    sheet.eachRow((row, index) => { if (index > 1 && row.getCell(map.get('job_id')!).text === job.job_id) rowNumber = index; });
    if (!rowNumber) rowNumber = sheet.rowCount + 1;
    const booking = job.booking;
    const values: ScheduleRow = {
      job_id: job.job_id, asset_id: job.asset_id, site_id: job.site_id,
      technician_id: booking?.technician_id ?? '', technician_name: booking?.technician_name ?? '',
      start_at: iso(booking?.start_at), end_at: iso(booking?.end_at), parts_status: job.parts_status,
      job_status: job.status, last_updated_at: at,
    };
    for (const key of columns) {
      const cell = sheet.getRow(rowNumber).getCell(map.get(key)!);
      if (cell.type === ExcelJS.ValueType.Formula) throw new Error(`Formula in managed cell ${cell.address}; reconcile rather than overwrite.`);
      if (['start_at', 'end_at', 'last_updated_at'].includes(key) && values[key]) {
        cell.value = new Date(values[key]);
        if (!Number.isFinite(cell.value.getTime())) throw new Error(`Invalid date for ${key}`);
        cell.numFmt = 'yyyy-mm-dd hh:mm';
      } else cell.value = values[key];
    }
    receipt.status = 'confirmed';
    receipt.provider_reference = `local-xlsx:Schedule:${job.job_id}`;
    receipt.detail = 'Actual local workbook updated and read back. This is not Microsoft 365 synchronization.';
    const actions = ledger ?? book.addWorksheet('_ThermalDeskActions');
    actions.state = 'veryHidden';
    if (!ledger) actions.addRow(['idempotency_key', 'payload', 'receipt']);
    actions.addRow([idempotencyKey, payload, JSON.stringify(receipt)]);
    temporary = `${workbookPath}.${randomUUID()}.tmp.xlsx`;
    await book.xlsx.writeFile(temporary);
    const staged = await readSchedule(temporary);
    const actual = staged.rows.find(row => row.job_id === job.job_id);
    if (!actual || columns.some(key => actual[key] !== values[key])) throw new Error(`Workbook read-back did not match: ${columns.filter(key => actual?.[key] !== values[key]).map(key => `${key}: ${actual?.[key]} vs ${values[key]}`).join('; ')}`);
    const current = await bytes(workbookPath);
    if ((current ? fingerprint(current) : null) !== (before ? fingerprint(before) : null)) throw new Error('Workbook changed during update; no overwrite performed.');
    await rename(temporary, workbookPath);
    temporary = undefined;
    const persisted = await readSchedule(workbookPath);
    if (persisted.rows.find(row => row.job_id === job.job_id)?.job_status !== job.status) throw new Error('Final workbook read-back failed.');
    return receipt;
  } catch (error) {
    return { ...receipt, status: 'failed', provider_reference: null, detail: (error as Error).message };
  } finally {
    if (temporary) await unlink(temporary).catch(() => undefined);
    if (release) await release();
  }
}
