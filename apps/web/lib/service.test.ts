import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CaseService } from './service';
import { CaseStore } from './store';
import { exportReport } from './report';
import type { Command } from './model';
import { readSchedule } from '@thermaldesk/excel';

let directory: string, service: CaseService;
beforeEach(async () => { directory = await mkdtemp(join(tmpdir(), 'thermaldesk-test-')); service = new CaseService(new CaseStore(directory)); });
afterEach(async () => { await rm(directory, { recursive: true, force: true }); });
const act = async (command: Command, reviewer?: string) => service.command({ command, reviewer, expectedRevision: (await service.read()).revision });
async function schedule() { await act('load_demo_scope'); await act('approve_scope', 'Demo reviewer'); return act('coordinate'); }

describe('both workflow pipelines', () => {
  it('blocks incomplete diagnosis and dispatch without a versioned approval', async () => {
    const state = await act('analyze');
    expect(state.recommendation?.status).toBe('needs_information');
    await expect(act('approve_scope', 'Reviewer')).rejects.toThrow('missing information');
    await expect(act('coordinate')).rejects.toThrow('Approve');
    expect((await service.read()).job).toBeNull();
  });
  it('runs review, booking, actual Excel, completion, verification and report with persisted state', async () => {
    let state = await schedule();
    expect(state.job?.actions.find(a => a.action_type === 'schedule_sync')?.status).toBe('confirmed');
    expect((await readSchedule(service.workbookPath)).rows[0].job_status).toBe('scheduled');
    await act('notify_manager');
    await act('complete');
    await act('verify');
    state = await act('approve_closure', 'Demo reviewer');
    expect(state.job?.status).toBe('closed');
    expect((await readSchedule(service.workbookPath)).rows[0].job_status).toBe('closed');
    expect((await new CaseService(new CaseStore(directory)).read()).job?.closure_review?.reviewer_id).toBe('Demo reviewer');
    const report = exportReport(state);
    expect(report).toContain('approve_closure');
    expect(report).toContain('No purchase or charge'.toLowerCase());
    expect(report).toContain('Synthetic demonstration');
  });
  it('keeps wrong-asset and incomplete repairs open, invalidating prior verification after new evidence', async () => {
    await schedule(); await act('wrong_asset');
    expect((await act('verify')).verification?.result).toBe('mismatch');
    await expect(act('approve_closure', 'Reviewer')).rejects.toThrow('unresolved');
    await act('complete'); await act('verify');
    const state = await act('incomplete');
    expect(state.verification).toBeNull();
    await expect(act('approve_closure', 'Reviewer')).rejects.toThrow('required');
    expect((await act('verify')).verification?.result).toBe('needs_information');
    await expect(act('approve_closure', 'Reviewer')).rejects.toThrow();
    expect((await service.read()).job?.status).toBe('awaiting_verification');
  });
  it('rebooks a cancelled technician without purchasing the part twice', async () => {
    await schedule();
    expect((await act('cancel_technician')).job?.status).toBe('blocked');
    const state = await act('coordinate');
    expect(state.job?.booking?.technician_id).toBe('DEMO-TECH-2');
    expect(state.job?.actions.filter(a => a.action_type === 'parts_order')).toHaveLength(1);
    expect((await readSchedule(service.workbookPath)).rows[0].technician_id).toBe('DEMO-TECH-2');
  });
  it('rejects stale concurrent approval and never overwrites the other update', async () => {
    const state = await act('load_demo_scope');
    const results = await Promise.allSettled([service.command({ command: 'approve_scope', expectedRevision: state.revision, reviewer: 'First' }), service.command({ command: 'approve_scope', expectedRevision: state.revision, reviewer: 'Second' })]);
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(r => r.status === 'rejected')).toHaveLength(1);
  });
  it('escapes report content rather than executing uploaded markup', async () => {
    const state = await service.read();
    state.inspection.evidence[0].text = '<script>alert(1)</script>';
    const report = exportReport(state);
    expect(report).not.toContain('<script>');
    expect(report).toContain('&lt;script&gt;');
  });
  it('requires a person to identify themselves at both review gates', async () => {
    await act('load_demo_scope');
    await expect(act('approve_scope')).rejects.toThrow('reviewer name');
    await act('approve_scope', 'Demo reviewer'); await act('coordinate'); await act('complete'); await act('verify');
    await expect(act('approve_closure')).rejects.toThrow('reviewer name');
  });
});
