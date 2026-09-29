import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import {
  ACTION_TYPES,
  BAND_ROLES,
  advanceRepairJob,
  coordinateRepair,
  createCrewHandler,
  createInMemoryJobRepository,
  createMemoryRoom,
  createRepairJob,
  createSimulatedCommunication,
  createSimulatedRoster,
  createSimulatedSchedule,
  createSimulatedSupplier,
  createTestClock,
  decodeEnvelope,
  getJobDetail,
  getRepairJob,
  toRepairJobEnvelope,
  type CoordinationAdapters,
  type CoordinationContext,
  type CriticPolicy,
  type Recommendation,
  type Technician,
} from '../src/index.js';

const require = createRequire(import.meta.url);
const Ajv2020 = require('ajv/dist/2020');
const addFormats = require('ajv-formats');
const readJson = async (path: string) =>
  JSON.parse(await readFile(new URL(`../../../../${path}`, import.meta.url), 'utf8'));
const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
const validate = ajv.compile(await readJson('contracts/v1.schema.json'));

const approved = async (): Promise<Recommendation> => (await readJson('fixtures/approved-recommendation.json')).data;

const technician = (id: string, name: string): Technician => ({
  technician_id: id,
  name,
  qualifications: ['electrical'],
  site_ids: ['DEMO-SITE'],
  distance_km: 5,
  availability: [{ start_at: '2026-09-30T00:00:00.000Z', end_at: '2026-10-10T00:00:00.000Z' }],
  contact: { channel: 'simulated', address: `sim:${id}` },
  active: true,
});

async function crew(options: { policy?: CriticPolicy; parts?: boolean; lead_time_hours?: number; seats?: number } = {}) {
  const clock = createTestClock('2026-09-29T20:00:00.000Z');
  const supplier = createSimulatedSupplier({
    supplier_id: 'SUP-A',
    name: 'Demo Supplier A',
    clock,
    catalog: {
      'DEMO-PART-01': { unit_price_minor: 12_500, currency: 'USD', quantity_available: 5, lead_time_hours: options.lead_time_hours ?? 24 },
    },
  });
  const communication = createSimulatedCommunication();
  const schedule = createSimulatedSchedule({ clock });
  const adapters: CoordinationAdapters = {
    suppliers: [supplier],
    roster: createSimulatedRoster([technician('TECH-1', 'Dana Demo')]),
    communication,
    schedule,
    manager: { manager_id: 'MGR-DEMO', name: 'Morgan Manager', address: 'sim:manager' },
  };
  const context: CoordinationContext = { repository: createInMemoryJobRepository(), clock };
  const recommendation = await approved();
  if (options.parts === false) recommendation.parts = [];
  await createRepairJob(
    {
      recommendation,
      job_id: 'JOB-001',
      runtime: 'band',
      requirements: { required_qualifications: ['electrical'] },
      authority: {
        authority_id: 'AUTH-DEMO',
        mode: 'simulated',
        currency: 'USD',
        max_total_minor: 50_000,
        allowed_actions: [...ACTION_TYPES],
        expires_at: '2026-12-31T00:00:00.000Z',
      },
    },
    context,
  );
  const room = createMemoryRoom('ROOM-SIMULATED', { max_participants: options.seats });
  for (const role of BAND_ROLES) {
    room.registerPeer(role, createCrewHandler(role, { context, adapters, policy: options.policy }));
  }
  // The person starts a room with the coordinator only. Everyone else is recruited.
  room.join('Morgan Manager');
  room.join('RepairCoordinator');
  return { clock, supplier, communication, schedule, adapters, context, room };
}

const messagesTo = (env: Awaited<ReturnType<typeof crew>>, name: string) =>
  env.room.log.filter((entry) => entry.kind === 'message' && entry.mentions.includes(name));

test('the crew books a repair through the room: recruit, verdict, handoff, report', async () => {
  const env = await crew();
  await env.room.post('Morgan Manager', '@RepairCoordinator coordinate JOB-001', ['RepairCoordinator']);

  // Roster decided at runtime from the case.
  assert.deepEqual(env.room.participants().sort(), ['AuthorityCritic', 'Morgan Manager', 'PartsSourcer', 'RepairCoordinator', 'TechDispatcher']);

  // The order ran only after the critic approved it in the room.
  const verdicts = messagesTo(env, 'PartsSourcer').filter((entry) => decodeEnvelope(entry.content)?.kind === 'verdict');
  assert.equal(verdicts.length, 1);
  assert.equal(verdicts[0]!.sender, 'AuthorityCritic');
  assert.match(verdicts[0]!.content, /^APPROVED/);
  assert.equal(env.supplier.order_requests.length, 1);

  let detail = await getJobDetail('JOB-001', env.context);
  assert.equal(detail.runtime, 'band');
  assert.equal(detail.verdict_requests[0]?.status, 'approved');
  assert.equal(detail.verdict_requests[0]?.decided_by, 'AuthorityCritic');
  assert.match(detail.verdict_requests[0]?.reference ?? '', /^band:ROOM-SIMULATED:MSG-/);

  // Dependent handoff: the dispatcher planned from the estimate in the sourcer's message.
  const handoff = decodeEnvelope(messagesTo(env, 'TechDispatcher')[0]!.content);
  assert.equal(handoff?.kind, 'parts_handoff');
  const estimate = handoff?.kind === 'parts_handoff' ? handoff.parts_delivery_estimate : null;
  assert.equal(estimate, '2026-09-30T20:00:00.000Z');
  assert.equal(detail.parts_handoff?.parts_delivery_estimate, estimate);
  assert.equal(detail.job.booking?.start_at, '2026-09-30T21:00:00.000Z');
  assert.equal(detail.job.status, 'coordinating');

  // The technician's reply arrives from the communication channel, then the room is told.
  await advanceRepairJob(
    'JOB-001',
    { event_id: 'E-ACCEPT-1', type: 'technician_responded', technician_id: 'TECH-1', response: 'accepted', response_reference: 'SIM-IN-0001', mode: 'simulated' },
    env.context,
  );
  assert.equal((await getRepairJob('JOB-001', env.context)).status, 'coordinating', 'no booking without a verdict');
  await env.room.post('Morgan Manager', '@RepairCoordinator update JOB-001', ['RepairCoordinator']);

  const job = await getRepairJob('JOB-001', env.context);
  assert.ok(validate(toRepairJobEnvelope(job)), JSON.stringify(validate.errors));
  assert.equal(job.status, 'scheduled');
  assert.equal(job.booking?.status, 'confirmed');
  assert.ok(env.room.participants().includes('ScheduleReporter'), 'the reporter was recruited when there was something to publish');
  assert.equal(env.schedule.requests.length, 1);
  detail = await getJobDetail('JOB-001', env.context);
  assert.deepEqual(detail.verdict_requests.map((item) => [item.action_type, item.status]), [['parts_order', 'approved'], ['booking', 'approved']]);

  // The room ends on a report addressed to the person who asked.
  const report = messagesTo(env, 'Morgan Manager').at(-1)!;
  assert.equal(report.sender, 'ScheduleReporter');
  assert.match(report.content, /Recommendation: no action is needed/);
  assert.match(report.content, /Schedule workbook: updated \(simulated\)/);
  assert.ok(env.room.log.some((entry) => entry.kind === 'event' && entry.sender === 'AuthorityCritic' && /pass: /.test(entry.content)));
  assert.equal(env.room.log.filter((entry) => entry.kind === 'undelivered').length, 0);
});

test('the critic can block a purchase and nothing is ordered', async () => {
  const env = await crew({ policy: { max_single_order_minor: 10_000 } });
  await env.room.post('Morgan Manager', '@RepairCoordinator coordinate JOB-001', ['RepairCoordinator']);

  assert.equal(env.supplier.quote_requests.length, 1);
  assert.equal(env.supplier.order_requests.length, 0, 'the blocked order never reached the supplier');
  const job = await getRepairJob('JOB-001', env.context);
  assert.equal(job.status, 'awaiting_authorization');
  assert.equal(job.parts_status, 'not_ordered');
  assert.equal(job.actions.filter((receipt) => receipt.action_type === 'parts_order').length, 0);
  const detail = await getJobDetail('JOB-001', env.context);
  assert.equal(detail.verdict_requests[0]?.status, 'blocked');
  assert.match(detail.verdict_requests[0]?.reason ?? '', /single order may not exceed 100\.00 USD/);
  assert.ok(detail.open_escalations.some((item) => item.code === 'verdict_blocked'));
  assert.equal(messagesTo(env, 'TechDispatcher').length, 0, 'no handoff after a blocked purchase');
  const told = messagesTo(env, 'Morgan Manager').at(-1)!;
  assert.equal(told.sender, 'RepairCoordinator');
  assert.match(told.content, /not ordered/);
  assert.match(told.content, /AuthorityCritic blocked/);
  assert.equal(told.content.match(/single order may not exceed/g)?.length, 1, 'the reason is reported once');
});

test('a job without parts never recruits the parts specialist', async () => {
  const env = await crew({ parts: false });
  await env.room.post('Morgan Manager', '@RepairCoordinator coordinate JOB-001', ['RepairCoordinator']);
  assert.equal(env.room.participants().includes('PartsSourcer'), false);
  assert.equal(messagesTo(env, 'PartsSourcer').length, 0);
  const job = await getRepairJob('JOB-001', env.context);
  assert.equal(job.parts_status, 'not_required');
  assert.equal(job.booking?.technician_id, 'TECH-1');
  assert.equal(job.booking?.start_at, '2026-09-30T00:00:00.000Z', 'nothing to wait for, so the first free slot is offered');
});

test('the appointment follows the estimate that was handed over', async () => {
  const early = await crew({ lead_time_hours: 24 });
  await early.room.post('Morgan Manager', '@RepairCoordinator coordinate JOB-001', ['RepairCoordinator']);
  const late = await crew({ lead_time_hours: 72 });
  await late.room.post('Morgan Manager', '@RepairCoordinator coordinate JOB-001', ['RepairCoordinator']);
  assert.equal((await getRepairJob('JOB-001', early.context)).booking?.start_at, '2026-09-30T21:00:00.000Z');
  assert.equal((await getRepairJob('JOB-001', late.context)).booking?.start_at, '2026-10-02T21:00:00.000Z');
});

test('delete test: without the room a Band job buys nothing and contacts nobody', async () => {
  const env = await crew();
  const job = await coordinateRepair('JOB-001', env.adapters, env.context);
  await coordinateRepair('JOB-001', env.adapters, env.context);
  assert.equal(env.supplier.order_requests.length, 0);
  assert.equal(env.communication.outbox.length, 0);
  assert.equal(job.booking, null);
  assert.equal(job.parts_status, 'not_ordered');
  const detail = await getJobDetail('JOB-001', env.context);
  assert.equal(detail.verdict_requests.length, 1);
  assert.equal(detail.verdict_requests[0]?.status, 'pending');
  assert.ok(validate(toRepairJobEnvelope(job)), JSON.stringify(validate.errors));
});

test('a verdict that does not match the recorded request is blocked', async () => {
  const env = await crew();
  await coordinateRepair('JOB-001', env.adapters, env.context, { stage: 'sourcing' });
  const request = (await getJobDetail('JOB-001', env.context)).verdict_requests[0]!;
  env.room.join('AuthorityCritic');
  env.room.join('PartsSourcer');
  const tampered = { ...(request.details as Record<string, unknown>), total_minor: 1 };
  const block = '```';
  await env.room.post(
    'PartsSourcer',
    `Verdict needed.\n\n${block}thermaldesk\n${JSON.stringify({ kind: 'verdict_request', job_id: 'JOB-001', requested_by: 'Morgan Manager', request_id: request.request_id, action_type: 'parts_order', summary: request.summary, details: tampered, reply_to: 'PartsSourcer' })}\n${block}`,
    ['AuthorityCritic'],
  );
  assert.equal(env.supplier.order_requests.length, 0);
  assert.equal((await getJobDetail('JOB-001', env.context)).verdict_requests[0]?.status, 'blocked');
});

test('in a room with five seats the finished parts specialist makes room for the reporter', async () => {
  const env = await crew({ seats: 5 });
  await env.room.post('Morgan Manager', '@RepairCoordinator coordinate JOB-001', ['RepairCoordinator']);
  assert.equal(env.room.participants().length, 5);
  await advanceRepairJob(
    'JOB-001',
    { event_id: 'E-ACCEPT-1', type: 'technician_responded', technician_id: 'TECH-1', response: 'accepted', response_reference: 'SIM-IN-0001', mode: 'simulated' },
    env.context,
  );
  await env.room.post('Morgan Manager', '@RepairCoordinator update JOB-001', ['RepairCoordinator']);

  assert.deepEqual(env.room.participants().sort(), ['AuthorityCritic', 'Morgan Manager', 'RepairCoordinator', 'ScheduleReporter', 'TechDispatcher']);
  assert.ok(env.room.log.some((entry) => entry.kind === 'left' && entry.mentions.includes('PartsSourcer')));
  assert.equal(env.supplier.order_requests.length, 1, 'the order placed before the specialist left still stands');
  const report = messagesTo(env, 'Morgan Manager').at(-1)!;
  assert.equal(report.sender, 'ScheduleReporter');
  assert.match(report.content, /Recommendation: no action is needed/);
  assert.equal((await getRepairJob('JOB-001', env.context)).status, 'scheduled');
});
