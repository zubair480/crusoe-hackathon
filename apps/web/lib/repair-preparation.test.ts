import { beforeEach, afterEach, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BAND_ROLES, createMemoryRoom, encodeEnvelope } from '@thermaldesk/coordination';
import { RepairPreparation, preparationDispatchKey, supplierLinks, type PreparationCommand } from './repair-preparation';
import { createPreparationCrewHandler } from './preparation-crew';
import { createCoordinationPorts } from './coordination-ports';
import { CaseStore } from './store';
import { demoPorts, reviewableDemoScope } from './demo-ports';
let directory: string, store: CaseStore, prep: RepairPreparation;
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'repair-preparation-')); store = new CaseStore(directory); prep = new RepairPreparation(store);
  await store.update(async state => {
    state.recommendation = reviewableDemoScope(); state.recommendation.status = 'approved';
    state.recommendation.approval = { reviewer_id: 'test reviewer', approved_at: new Date().toISOString(), recommendation_version: 1, mode: 'simulated' };
    return { state, result: null };
  });
});
afterEach(async () => { await rm(directory, { recursive: true, force: true }); });
const command = async (name: PreparationCommand['command'], values?: Record<string, unknown>) => prep.command({ command: name, expectedRevision: (await store.read()).revision, values });
async function quote(overrides: Record<string, unknown> = {}) {
  const part = (await store.read()).recommendation!.parts[0];
  return command('quote', { part_id: part.part_id, offered_part_id: part.part_id, specification: part.approved_specification,
    supplier: 'Test supplier', quantity: part.quantity, total_minor: 12345, currency: 'USD', source_url: 'https://supplier.example/quote/123',
    valid_until: new Date(Date.now() + 86400000).toISOString(), delivery_at: new Date(Date.now() + 172800000).toISOString(), recorded_by: 'test operator', ...overrides });
}
it('prepares supplier links without inventing a quote or an order', async () => {
  const result = await command('prepare');
  expect(result.parts[0].links).toHaveLength(3); expect(result.quotes).toHaveLength(0);
  expect(result.selected_total_minor).toBeNull(); expect((await store.read()).job).toBeNull();
  expect(result.history.map(item => item.role)).toEqual([...BAND_ROLES]);
  expect(supplierLinks('A&B?x=<tag>')[0].url).toContain('A%26B%3Fx%3D%3Ctag%3E');
});
it('retains source, recorder and timestamp and checks exact scope and budget', async () => {
  await command('budget', { total_minor: 20000, currency: 'USD', recorded_by: 'Budget reviewer' });
  const valid = await quote();
  expect(valid.quotes[0]).toMatchObject({ status: 'eligible_for_review', provenance: 'operator_entered', source_url: 'https://supplier.example/quote/123', recorded_by: 'test operator' });
  expect(valid.selection_complete).toBe(true);
  const invalid = await quote({ offered_part_id: 'SUBSTITUTE', currency: 'EUR', total_minor: 30000, valid_until: '2020-01-01T00:00:00Z' });
  expect(invalid.quotes[1].status).toBe('blocked'); expect(invalid.quotes[1].failures.length).toBeGreaterThanOrEqual(4);
});
it('checks the combined selection against the budget, not just individual quotes', async () => {
  await store.update(async state => { state.recommendation!.parts.push({ ...state.recommendation!.parts[0], part_id: 'SECOND' }); return { state, result: null }; });
  await command('budget', { total_minor: 20000, currency: 'USD', recorded_by: 'Budget reviewer' });
  await quote(); const result = await quote({ part_id: 'SECOND', offered_part_id: 'SECOND' });
  expect(result.selected_total_minor).toBe(24690); expect(result.selection_complete).toBe(false);
  expect(result.selection_issue).toContain('Combined');
});
it('creates an unsent RFQ and technician enquiry with demo disclosure and no booking', async () => {
  const part = (await store.read()).recommendation!.parts[0];
  const rfq = await prep.draft('rfq', part.part_id);
  expect(rfq).toContain('X-Unsent: 1');
  const body = Buffer.from(rfq.split('\r\n\r\n')[1], 'base64').toString();
  expect(body).toContain('DEMONSTRATION SCOPE'); expect(body).toContain('not a purchase order');
  const result = await command('contact', { name: 'Alex', email: 'alex@example.com', qualifications: 'electrical', recorded_by: 'Roster reviewer' });
  const draft = await prep.draft('technician', result.contacts[0].id);
  expect(draft).toContain('To: alex@example.com');
  expect(Buffer.from(draft.split('\r\n\r\n')[1], 'base64').toString()).toContain('do not attend');
  expect((await store.read()).job).toBeNull();
});
it('rejects unsafe URLs, email headers, invalid money and stale mutations', async () => {
  await expect(quote({ source_url: 'javascript:alert(1)' })).rejects.toThrow('HTTPS');
  await expect(quote({ total_minor: 1.5 })).rejects.toThrow('integer cents');
  await expect(command('contact', { name: 'Alex', email: 'alex@example.com\r\nBcc: other@example.com', qualifications: 'electrical', recorded_by: 'Reviewer' })).rejects.toThrow('one line');
  await command('prepare'); await expect(prep.command({ command: 'prepare', expectedRevision: 0 })).rejects.toThrow('Case changed');
});
it('invalidates preparation when scope changes and refuses drafts without current approval', async () => {
  await quote();
  await store.update(async state => { state.recommendation!.version++; state.recommendation!.status = 'draft'; state.recommendation!.approval = null; return { state, result: null }; });
  expect((await prep.read()).quotes).toHaveLength(0);
  expect((await prep.read()).synthetic_approval).toBe(false);
  await expect(prep.draft('rfq', 'DEMO-PART-01')).rejects.toThrow('approve');
});
it('deduplicates unchanged Band inputs but allows changed quotes to be dispatched', async () => {
  const initial = preparationDispatchKey(await store.read());
  await command('prepare');
  expect(preparationDispatchKey(await store.read())).toBe(initial);
  await quote();
  expect(preparationDispatchKey(await store.read())).not.toBe(initial);
});
it('runs all five Band roles on real persisted preparation without simulated purchasing', async () => {
  const ports = createCoordinationPorts(directory, demoPorts);
  const job = await ports.createBandJob((await store.read()).recommendation!, null);
  await store.update(async state => { state.job = job; return { state, result: null }; });
  const room = createMemoryRoom('ASSISTED', { max_participants: 5 });
  for (const role of BAND_ROLES) room.registerPeer(role, createPreparationCrewHandler(role, prep));
  room.join('ScheduleReporter'); room.join('RepairCoordinator');
  await room.post('ScheduleReporter', encodeEnvelope('Prepare this repair', { kind: 'kickoff', job_id: job.job_id, requested_by: 'ScheduleReporter' }), ['RepairCoordinator']);
  expect((await prep.read()).history.map(item => item.role)).toEqual([...BAND_ROLES]);
  const canonical = await ports.getDetail(job.job_id);
  expect(canonical.job.actions).toHaveLength(0); expect(canonical.job.booking).toBeNull();
  expect(room.log.some(item => item.content.includes('nothing purchased, sent or booked'))).toBe(true);
});
