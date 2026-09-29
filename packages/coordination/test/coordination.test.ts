import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  ACTION_STATUSES,
  ACTION_TYPES,
  ApprovalError,
  EventRejectedError,
  JOB_STATUSES,
  PARTS_STATUSES,
  advanceRepairJob,
  coordinateRepair,
  createFileJobRepository,
  createInMemoryJobRepository,
  createRepairJob,
  createSimulatedCommunication,
  createSimulatedRoster,
  createSimulatedSchedule,
  createSimulatedSupplier,
  createTestClock,
  getJobDetail,
  getJobTimeline,
  getRepairJob,
  processDueFollowUps,
  toRepairJobEnvelope,
  type Authority,
  type CompletionEvidence,
  type CoordinationAdapters,
  type CoordinationContext,
  type JobRepository,
  type Recommendation,
  type RepairJob,
  type Technician,
  type VerificationDraft,
} from '../src/index.js';

const require = createRequire(import.meta.url);
const Ajv2020 = require('ajv/dist/2020');
const addFormats = require('ajv-formats');

const repoFile = (path: string) => new URL(`../../../../${path}`, import.meta.url);
const readJson = async (path: string) => JSON.parse(await readFile(repoFile(path), 'utf8'));

const schema = await readJson('contracts/v1.schema.json');
const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
const validateEnvelope = ajv.compile(schema);

function assertContract(job: RepairJob): void {
  const valid = validateEnvelope(toRepairJobEnvelope(job));
  assert.ok(valid, `RepairJob violates contracts/v1.schema.json: ${JSON.stringify(validateEnvelope.errors)}`);
}

const approved = async (): Promise<Recommendation> => (await readJson('fixtures/approved-recommendation.json')).data;
const wrongAsset = async (): Promise<CompletionEvidence> => (await readJson('fixtures/completion-wrong-asset.json')).data;

const START = '2026-09-29T20:00:00.000Z';

const authority = (overrides: Partial<Authority> = {}): Authority => ({
  authority_id: 'AUTH-DEMO',
  mode: 'simulated',
  currency: 'USD',
  max_total_minor: 50_000,
  allowed_actions: [...ACTION_TYPES],
  expires_at: '2026-12-31T00:00:00.000Z',
  ...overrides,
});

const technician = (id: string, name: string, distance_km: number): Technician => ({
  technician_id: id,
  name,
  qualifications: ['electrical'],
  site_ids: ['DEMO-SITE'],
  distance_km,
  availability: [{ start_at: '2026-09-30T00:00:00.000Z', end_at: '2026-10-10T00:00:00.000Z' }],
  contact: { channel: 'simulated', address: `sim:${id}` },
  active: true,
});

function setup(repository: JobRepository = createInMemoryJobRepository(), scheduleFailures = 0) {
  const clock = createTestClock(START);
  const supplier = createSimulatedSupplier({
    supplier_id: 'SUP-A',
    name: 'Demo Supplier A',
    clock,
    catalog: {
      'DEMO-PART-01': { unit_price_minor: 12_500, currency: 'USD', quantity_available: 5, lead_time_hours: 24 },
    },
  });
  const communication = createSimulatedCommunication();
  const schedule = createSimulatedSchedule({ clock, fail_first: scheduleFailures });
  const adapters: CoordinationAdapters = {
    suppliers: [supplier],
    roster: createSimulatedRoster([technician('TECH-1', 'Dana Demo', 5), technician('TECH-2', 'Eli Example', 20)]),
    communication,
    schedule,
    manager: { manager_id: 'MGR-DEMO', name: 'Morgan Manager', address: 'sim:manager' },
  };
  const context: CoordinationContext = { repository, clock };
  return { clock, supplier, communication, schedule, adapters, context };
}

async function scheduled(env: ReturnType<typeof setup>): Promise<RepairJob> {
  await createRepairJob(
    {
      recommendation: await approved(),
      authority: authority(),
      job_id: 'JOB-001',
      requirements: { required_qualifications: ['electrical'] },
    },
    env.context,
  );
  await coordinateRepair('JOB-001', env.adapters, env.context);
  await advanceRepairJob(
    'JOB-001',
    { event_id: 'E-ACCEPT-1', type: 'technician_responded', technician_id: 'TECH-1', response: 'accepted', response_reference: 'SIM-IN-0001', mode: 'simulated' },
    env.context,
  );
  return coordinateRepair('JOB-001', env.adapters, env.context);
}

const managerMessages = (env: ReturnType<typeof setup>) =>
  env.communication.outbox.filter((message) => message.purpose === 'manager_update');

test('the TypeScript constants match contracts/v1.schema.json', () => {
  const defs = schema.$defs;
  assert.deepEqual([...JOB_STATUSES], defs.RepairJob.properties.status.enum);
  assert.deepEqual([...PARTS_STATUSES], defs.RepairJob.properties.parts_status.enum);
  assert.deepEqual([...ACTION_TYPES], defs.ActionReceipt.properties.action_type.enum);
  assert.deepEqual([...ACTION_STATUSES], defs.ActionReceipt.properties.status.enum);
});

test('an unapproved or changed-version recommendation creates no job', async () => {
  const env = setup();
  const draft = { ...(await approved()), status: 'draft' as const, approval: null };
  await assert.rejects(createRepairJob({ recommendation: draft, authority: authority() }, env.context), ApprovalError);

  const changed = { ...(await approved()), version: 2 };
  await assert.rejects(
    createRepairJob({ recommendation: changed, authority: authority() }, env.context),
    (error: unknown) => error instanceof ApprovalError && error.code === 'approval_version_mismatch',
  );
  assert.equal((await env.context.repository.list()).length, 0);
  assert.equal(env.supplier.order_requests.length, 0);
});

test('a scope changed after approval stops every purchase and outreach', async () => {
  const env = setup();
  const recommendation = await approved();
  await createRepairJob({ recommendation, authority: authority(), job_id: 'JOB-001' }, env.context);
  const tampered = { ...recommendation, repair_scope: `${recommendation.repair_scope} Also replace the breaker.` };
  const job = await coordinateRepair('JOB-001', env.adapters, env.context, { current_recommendation: tampered });
  assert.equal(job.status, 'awaiting_authorization');
  assert.equal(env.supplier.quote_requests.length, 0);
  assert.equal(env.supplier.order_requests.length, 0);
  assert.equal(env.communication.outbox.filter((message) => message.purpose === 'technician_offer').length, 0);
  assertContract(job);
});

test('a simulated approval and authority cannot drive a live adapter', async () => {
  const env = setup();
  const live = { ...env.supplier, mode: 'live' as const, requestQuote: env.supplier.requestQuote, placeOrder: env.supplier.placeOrder };
  await createRepairJob({ recommendation: await approved(), authority: authority(), job_id: 'JOB-001' }, env.context);
  const job = await coordinateRepair('JOB-001', { ...env.adapters, suppliers: [live] }, env.context);
  assert.equal(job.status, 'awaiting_authorization');
  assert.equal(env.supplier.quote_requests.length, 0);
  assert.equal(job.actions.length > 0 && job.actions.some((receipt) => receipt.action_type === 'parts_order'), false);
});

test('a job without authority waits and runs nothing', async () => {
  const env = setup();
  const created = await createRepairJob({ recommendation: await approved(), authority: null, job_id: 'JOB-001' }, env.context);
  assert.equal(created.status, 'awaiting_authorization');
  const job = await coordinateRepair('JOB-001', env.adapters, env.context);
  assert.equal(job.status, 'awaiting_authorization');
  assert.equal(env.supplier.quote_requests.length, 0);
  assertContract(job);
});

test('a confirmed job produces one schedule-sync request and an accurate manager update', async () => {
  const env = setup();
  const job = await scheduled(env);
  assertContract(job);
  assert.equal(job.status, 'scheduled');
  assert.equal(job.parts_status, 'ordered');
  assert.equal(job.booking?.status, 'confirmed');
  assert.equal(job.booking?.technician_id, 'TECH-1');
  assert.equal(env.schedule.requests.length, 1);
  assert.equal(env.schedule.requests[0]?.reason, 'booking_confirmed');
  assert.equal(env.schedule.requests[0]?.row.technician_id, 'TECH-1');
  assert.equal(env.supplier.order_requests.length, 1);

  const booking = job.actions.find((receipt) => receipt.action_id === job.booking?.confirmation_action_id);
  assert.equal(booking?.status, 'confirmed');
  assert.equal(booking?.provider_reference, 'SIM-IN-0001');
  assert.ok((booking?.evidence_ids.length ?? 0) > 0, 'the booking carries evidence of the acceptance');
  assert.ok(job.actions.every((receipt) => receipt.mode === 'simulated' && receipt.detail.toUpperCase().includes('SIMULATED')));

  const updates = managerMessages(env);
  assert.equal(updates.length, 1);
  const body = updates[0]!.body;
  assert.match(updates[0]!.subject, /SIMULATED/);
  assert.match(body, /Dana Demo/);
  assert.match(body, /FIND-001/);
  assert.match(body, /DEMO-PART-01/);
  assert.match(body, /purchase outcome: confirmed/);
  assert.match(body, /Schedule workbook:\n- updated/);

  // The appointment starts after the parts estimate plus the buffer.
  const order = (await getJobDetail('JOB-001', env.context)).sourcing[0]!.order!;
  assert.ok(Date.parse(job.booking!.start_at) >= Date.parse(order.estimated_delivery_at!) + 60 * 60_000);
});

test('coordinating again repeats no purchase, booking or notification', async () => {
  const env = setup();
  const first = await scheduled(env);
  const counts = () => [env.supplier.quote_requests.length, env.supplier.order_requests.length, env.schedule.requests.length, env.communication.outbox.length];
  const before = counts();
  const again = await coordinateRepair('JOB-001', env.adapters, env.context);
  const third = await coordinateRepair('JOB-001', env.adapters, env.context);
  assert.deepEqual(counts(), before);
  assert.equal(again.actions.length, first.actions.length);
  assert.equal(third.state_version, again.state_version);
  assert.equal(new Set(again.actions.map((receipt) => receipt.idempotency_key)).size, again.actions.length);
});

test('a repeated event returns the same outcome and a reused id with another payload is refused', async () => {
  const env = setup();
  const job = await scheduled(env);
  const repeated = await advanceRepairJob(
    'JOB-001',
    { event_id: 'E-ACCEPT-1', type: 'technician_responded', technician_id: 'TECH-1', response: 'accepted', response_reference: 'SIM-IN-0001', mode: 'simulated' },
    env.context,
  );
  assert.deepEqual(repeated, job);
  await assert.rejects(
    advanceRepairJob(
      'JOB-001',
      { event_id: 'E-ACCEPT-1', type: 'technician_responded', technician_id: 'TECH-1', response: 'declined', response_reference: 'SIM-IN-0001', mode: 'simulated' },
      env.context,
    ),
    (error: unknown) => (error as { code?: string }).code === 'event_id_conflict',
  );
});

test('a schedule write failure is reported to the manager and retried', async () => {
  const env = setup(createInMemoryJobRepository(), 1);
  const job = await scheduled(env);
  assert.equal(job.status, 'scheduled');
  const sync = job.actions.filter((receipt) => receipt.action_type === 'schedule_sync');
  assert.equal(sync.length, 1);
  assert.equal(sync[0]!.status, 'failed');
  assert.match(managerMessages(env)[0]!.subject, /NOT updated/);
  assert.match(managerMessages(env)[0]!.body, /Schedule workbook:\n- NOT updated/);

  env.clock.advanceMinutes(16);
  const results = await processDueFollowUps(env.adapters, env.context);
  assert.ok(results.some((result) => result.kind === 'schedule_sync_retry'));
  const after = await getRepairJob('JOB-001', env.context);
  const retried = after.actions.filter((receipt) => receipt.action_type === 'schedule_sync');
  assert.deepEqual(retried.map((receipt) => receipt.status), ['failed', 'confirmed']);
  assert.ok(managerMessages(env).some((message) => /now updated/.test(message.subject)));
  assertContract(after);
});

test('a technician cancellation replans without a second order', async () => {
  const env = setup();
  await scheduled(env);
  const cancelled = await advanceRepairJob(
    'JOB-001',
    { event_id: 'E-CANCEL-1', type: 'technician_cancelled', technician_id: 'TECH-1', reason: 'Vehicle breakdown' },
    env.context,
  );
  assert.equal(cancelled.status, 'coordinating');
  assert.equal(cancelled.booking?.status, 'cancelled');

  const replanned = await coordinateRepair('JOB-001', env.adapters, env.context);
  assertContract(replanned);
  assert.equal(replanned.status, 'coordinating');
  assert.equal(replanned.booking?.technician_id, 'TECH-2');
  assert.equal(replanned.booking?.status, 'proposed');
  assert.equal(env.supplier.order_requests.length, 1, 'the part was not ordered again');
  assert.equal(replanned.actions.filter((receipt) => receipt.action_type === 'parts_order').length, 1);
  assert.deepEqual(env.schedule.requests.map((request) => request.reason), ['booking_confirmed', 'booking_cancelled']);
  assert.equal(env.schedule.requests[1]?.row.technician_id, null);
  assert.ok(managerMessages(env).some((message) => /cancelled/.test(message.subject) && /Vehicle breakdown/.test(message.subject)));

  await advanceRepairJob(
    'JOB-001',
    { event_id: 'E-ACCEPT-2', type: 'technician_responded', technician_id: 'TECH-2', response: 'accepted', response_reference: 'SIM-IN-0002', mode: 'simulated' },
    env.context,
  );
  const rebooked = await coordinateRepair('JOB-001', env.adapters, env.context);
  assert.equal(rebooked.status, 'scheduled');
  assert.equal(rebooked.booking?.technician_id, 'TECH-2');
  assert.equal(env.supplier.order_requests.length, 1);
  assert.equal(env.schedule.requests.length, 3);
  const timeline = await getJobTimeline('JOB-001', env.context);
  assert.ok(timeline.some((event) => event.type === 'technician_cancelled'), 'the cancellation stays in the history');
});

test('a technician who does not answer is followed up and the next one is contacted', async () => {
  const env = setup();
  await createRepairJob({ recommendation: await approved(), authority: authority(), job_id: 'JOB-001' }, env.context);
  const waiting = await coordinateRepair('JOB-001', env.adapters, env.context);
  assert.equal(waiting.booking?.technician_id, 'TECH-1');
  assert.deepEqual(await processDueFollowUps(env.adapters, env.context), []);

  env.clock.advanceMinutes(61);
  const results = await processDueFollowUps(env.adapters, env.context);
  assert.equal(results.length, 1);
  assert.equal(results[0]?.kind, 'technician_response');
  const job = await getRepairJob('JOB-001', env.context);
  assert.equal(job.status, 'coordinating');
  assert.equal(job.booking?.technician_id, 'TECH-2');
  assert.equal(env.supplier.order_requests.length, 1);
});

test('a parts delay replans the appointment and keeps the order', async () => {
  const env = setup();
  const job = await scheduled(env);
  const delayed = await advanceRepairJob(
    'JOB-001',
    { event_id: 'E-DELAY-1', type: 'parts_order_updated', part_id: 'DEMO-PART-01', order_status: 'delayed', estimated_delivery_at: '2026-10-03T12:00:00.000Z' },
    env.context,
  );
  assert.equal(delayed.status, 'coordinating');
  assert.equal(delayed.parts_status, 'delayed');
  assert.equal(delayed.booking?.status, 'cancelled');
  const replanned = await coordinateRepair('JOB-001', env.adapters, env.context);
  assert.equal(env.supplier.order_requests.length, 1);
  assert.ok(Date.parse(replanned.booking!.start_at) >= Date.parse('2026-10-03T13:00:00.000Z'));
  assert.ok(Date.parse(replanned.booking!.start_at) > Date.parse(job.booking!.start_at));
  assertContract(replanned);
});

test('a substitution or a missing specification goes back to the reviewer', async () => {
  const env = setup();
  const substitute = createSimulatedSupplier({
    supplier_id: 'SUP-B',
    name: 'Demo Supplier B',
    clock: env.clock,
    catalog: {
      'DEMO-PART-01': { unit_price_minor: 100, currency: 'USD', quantity_available: 9, lead_time_hours: 1, offered_part_id: 'DEMO-PART-99', offered_specification: 'Claimed equivalent' },
    },
  });
  await createRepairJob({ recommendation: await approved(), authority: authority(), job_id: 'JOB-001' }, env.context);
  const job = await coordinateRepair('JOB-001', { ...env.adapters, suppliers: [substitute] }, env.context);
  assert.equal(job.status, 'awaiting_authorization');
  assert.equal(substitute.order_requests.length, 0);
  const detail = await getJobDetail('JOB-001', env.context);
  assert.ok(detail.open_escalations.some((item) => item.code === 'substitution_proposed' && item.to === 'reviewer'));

  const other = setup();
  const unspecified = await approved();
  unspecified.parts[0]!.requires_specification_review = true;
  await createRepairJob({ recommendation: unspecified, authority: authority(), job_id: 'JOB-002' }, other.context);
  const held = await coordinateRepair('JOB-002', other.adapters, other.context);
  assert.equal(held.status, 'awaiting_authorization');
  assert.equal(other.supplier.quote_requests.length, 0);
  assert.equal(other.supplier.order_requests.length, 0);
});

test('an order above the spending authority is not placed', async () => {
  const env = setup();
  await createRepairJob({ recommendation: await approved(), authority: authority({ max_total_minor: 1_000 }), job_id: 'JOB-001' }, env.context);
  const job = await coordinateRepair('JOB-001', env.adapters, env.context);
  assert.equal(job.status, 'awaiting_authorization');
  assert.equal(env.supplier.order_requests.length, 0);
  assert.equal(job.parts_status, 'not_ordered');
});

const verification = (result: VerificationDraft['result']): VerificationDraft => ({
  schema_version: '1.0',
  case_id: 'DEMO-CASE-001',
  site_id: 'DEMO-SITE',
  asset_id: 'DEMO-A',
  verification_id: 'VER-001',
  job_id: 'JOB-001',
  version: 1,
  recommendation_version: 1,
  completion_id: 'COMP-001',
  completion_version: 1,
  result,
  checks: [],
  missing_information: [],
  analysis_mode: 'simulated',
  created_at: START,
});

const review = (decision: 'approve_closure' | 'keep_open') => ({
  reviewer_id: 'DEMO-REVIEWER',
  verification_id: 'VER-001',
  verification_version: 1,
  completion_version: 1,
  recommendation_version: 1,
  decision,
  reviewed_at: START,
  mode: 'simulated' as const,
});

test('wrong-asset completion evidence keeps the job open', async () => {
  const env = setup();
  await scheduled(env);
  const evidence = await wrongAsset();
  const received = await advanceRepairJob('JOB-001', { event_id: 'E-COMP-1', type: 'completion_evidence_received', completion: evidence }, env.context);
  assert.equal(received.status, 'awaiting_verification');
  const detail = await getJobDetail('JOB-001', env.context);
  assert.equal(detail.current_completion?.evidence[0]?.asset_id, 'DEMO-B', 'the mismatch is kept as received');
  assert.deepEqual(detail.current_completion_assessment?.asset_mismatch_evidence_ids, ['EV-COMP-001']);
  assert.equal(detail.current_completion_assessment?.acceptable_for_closure, false);

  // Even a reviewer approval and a favourable draft cannot close it.
  await advanceRepairJob('JOB-001', { event_id: 'E-VER-1', type: 'verification_draft_received', verification: verification('ready_for_review') }, env.context);
  await assert.rejects(
    advanceRepairJob('JOB-001', { event_id: 'E-CLOSE-1', type: 'closure_review_recorded', review: review('approve_closure') }, env.context),
    (error: unknown) => error instanceof EventRejectedError && error.code === 'closure_not_permitted',
  );
  await assert.rejects(
    advanceRepairJob('JOB-001', { event_id: 'E-CLOSE-1', type: 'closure_review_recorded', review: review('approve_closure') }, env.context),
    (error: unknown) => error instanceof EventRejectedError && error.code === 'closure_not_permitted',
    'the repeated event is refused the same way',
  );
  const job = await coordinateRepair('JOB-001', env.adapters, env.context);
  assert.equal(job.status, 'awaiting_verification');
  assert.equal(job.closure_review, null);
  assert.deepEqual(job.unresolved_findings, ['FIND-001']);
  assert.ok((await getJobTimeline('JOB-001', env.context)).some((event) => event.outcome === 'rejected'));
  assertContract(job);
});

test('missing completion evidence is chased and the job stays open', async () => {
  const env = setup();
  const job = await scheduled(env);
  env.clock.set(job.booking!.end_at);
  env.clock.advanceMinutes(121);
  const first = await processDueFollowUps(env.adapters, env.context);
  assert.ok(first.some((result) => result.kind === 'completion_evidence'));
  env.clock.advanceMinutes(121);
  await processDueFollowUps(env.adapters, env.context);
  const after = await getRepairJob('JOB-001', env.context);
  assert.equal(after.status, 'scheduled');
  assert.equal(after.actions.filter((receipt) => receipt.action_type === 'follow_up').length, 2);
  const detail = await getJobDetail('JOB-001', env.context);
  assert.ok(detail.open_escalations.some((item) => item.code === 'completion_evidence_missing'));
  assert.ok(detail.pending_follow_ups.some((item) => item.kind === 'completion_evidence'));
  assertContract(after);
});

test('a job closes only after an accepted verification and publishes the closure', async () => {
  const env = setup();
  await scheduled(env);
  await advanceRepairJob('JOB-001', { event_id: 'E-START', type: 'work_started', technician_id: 'TECH-1' }, env.context);
  const evidence = await wrongAsset();
  evidence.evidence[0]!.asset_id = 'DEMO-A';
  evidence.evidence[0]!.text = 'The repair is complete on panel DEMO-A.';
  evidence.comments = 'Technician reports completion on DEMO-A.';
  evidence.unresolved_items = [];
  evidence.technician_id = 'TECH-1';
  await advanceRepairJob('JOB-001', { event_id: 'E-COMP-1', type: 'completion_evidence_received', completion: evidence }, env.context);

  await assert.rejects(
    advanceRepairJob('JOB-001', { event_id: 'E-CLOSE-0', type: 'closure_review_recorded', review: review('approve_closure') }, env.context),
    (error: unknown) => error instanceof EventRejectedError && error.code === 'nothing_to_review',
  );
  await advanceRepairJob('JOB-001', { event_id: 'E-VER-1', type: 'verification_draft_received', verification: verification('ready_for_review') }, env.context);
  await assert.rejects(
    advanceRepairJob('JOB-001', { event_id: 'E-CLOSE-STALE', type: 'closure_review_recorded', review: { ...review('approve_closure'), completion_version: 2 } }, env.context),
    (error: unknown) => error instanceof EventRejectedError && error.code === 'stale_review',
  );
  const closed = await advanceRepairJob('JOB-001', { event_id: 'E-CLOSE-1', type: 'closure_review_recorded', review: review('approve_closure') }, env.context);
  assert.equal(closed.status, 'closed');
  assert.deepEqual(closed.unresolved_findings, []);

  const published = await coordinateRepair('JOB-001', env.adapters, env.context);
  assertContract(published);
  assert.equal(env.schedule.requests.at(-1)?.reason, 'closure_verified');
  assert.equal(env.schedule.rows.get('JOB-001')?.job_status, 'closed');
  assert.ok(managerMessages(env).some((message) => /verified and closed/.test(message.subject)));
  assert.ok((await getJobTimeline('JOB-001', env.context)).some((event) => event.type === 'closure_published'));
  await assert.rejects(
    advanceRepairJob('JOB-001', { event_id: 'E-LATE', type: 'work_started', technician_id: 'TECH-1' }, env.context),
    (error: unknown) => error instanceof EventRejectedError && error.code === 'job_not_open',
  );
});

test('restarting the worker preserves job status and pending follow-up work', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'thermaldesk-coordination-'));
  const env = setup(createFileJobRepository({ directory }));
  await createRepairJob({ recommendation: await approved(), authority: authority(), job_id: 'JOB-001' }, env.context);
  const before = await coordinateRepair('JOB-001', env.adapters, env.context);
  const pending = (await getJobDetail('JOB-001', env.context)).pending_follow_ups;
  assert.ok(pending.some((item) => item.kind === 'technician_response'));
  assert.ok(pending.some((item) => item.kind === 'parts_delivery'));

  // A new process: new repository object, new adapters, nothing kept in memory.
  const restarted = setup(createFileJobRepository({ directory }));
  const after = await getRepairJob('JOB-001', restarted.context);
  assert.deepEqual(after, before);
  assert.deepEqual((await getJobDetail('JOB-001', restarted.context)).pending_follow_ups, pending);

  restarted.clock.advanceMinutes(61);
  const results = await processDueFollowUps(restarted.adapters, restarted.context);
  assert.equal(results[0]?.kind, 'technician_response');
  const job = await getRepairJob('JOB-001', restarted.context);
  assert.equal(job.booking?.technician_id, 'TECH-2');
  assert.equal(job.actions.filter((receipt) => receipt.action_type === 'parts_order').length, 1);
  assert.equal(restarted.supplier.order_requests.length, 0, 'the restarted worker placed no second order');
  assertContract(job);
});

test('an interrupted action is not repeated when the provider cannot deduplicate', async () => {
  const env = setup();
  let calls = 0;
  const fragile = {
    ...env.supplier,
    deduplicates_by_key: false,
    requestQuote: env.supplier.requestQuote,
    placeOrder: async () => {
      calls += 1;
      throw new Error('connection reset after the request was sent');
    },
  };
  await createRepairJob({ recommendation: await approved(), authority: authority(), job_id: 'JOB-001' }, env.context);
  const adapters = { ...env.adapters, suppliers: [fragile] };
  const job = await coordinateRepair('JOB-001', adapters, env.context);
  await coordinateRepair('JOB-001', adapters, env.context);
  assert.equal(calls, 1, 'the order was attempted once');
  const order = job.actions.find((receipt) => receipt.action_type === 'parts_order');
  assert.equal(order?.status, 'pending');
  assert.match(order?.detail ?? '', /not repeated automatically/);
  const detail = await getJobDetail('JOB-001', env.context);
  assert.ok(detail.open_escalations.some((item) => item.code === 'action_outcome_unknown'));
  assertContract(job);
});
