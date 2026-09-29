/**
 * Offline demonstration of the crew. The room here is a SIMULATED transport, not Band, and
 * suppliers, messaging and the schedule are simulated too. Run with `npm run band:demo`.
 */
import { readFile } from 'node:fs/promises';
import { advanceRepairJob, createRepairJob, getJobDetail } from '../engine.js';
import { ACTION_TYPES } from '../contract.js';
import { createTestClock } from '../clock.js';
import { createInMemoryJobRepository } from '../repository.js';
import {
  createSimulatedCommunication,
  createSimulatedRoster,
  createSimulatedSchedule,
  createSimulatedSupplier,
} from '../adapters/simulated.js';
import type { CoordinationAdapters, CoordinationContext } from '../types.js';
import { createCrewHandler, type CriticPolicy } from './crew.js';
import { createMemoryRoom, type MemoryRoom } from './memory-room.js';
import { BAND_ROLES } from './protocol.js';

async function setup(policy?: CriticPolicy) {
  const clock = createTestClock('2026-09-29T20:00:00.000Z');
  const context: CoordinationContext = { repository: createInMemoryJobRepository(), clock };
  const supplier = createSimulatedSupplier({
    supplier_id: 'SUP-A',
    name: 'Demo Supplier A',
    clock,
    catalog: { 'DEMO-PART-01': { unit_price_minor: 12_500, currency: 'USD', quantity_available: 5, lead_time_hours: 24 } },
  });
  const adapters: CoordinationAdapters = {
    suppliers: [supplier],
    roster: createSimulatedRoster([
      {
        technician_id: 'TECH-1',
        name: 'Dana Demo',
        qualifications: ['electrical'],
        site_ids: ['DEMO-SITE'],
        distance_km: 5,
        availability: [{ start_at: '2026-09-30T00:00:00.000Z', end_at: '2026-10-10T00:00:00.000Z' }],
        contact: { channel: 'simulated', address: 'sim:TECH-1' },
        active: true,
      },
    ]),
    communication: createSimulatedCommunication(),
    schedule: createSimulatedSchedule({ clock }),
    manager: { manager_id: 'MGR-DEMO', name: 'Morgan Manager', address: 'sim:manager' },
  };
  const fixture = JSON.parse(
    await readFile(new URL('../../../../../fixtures/approved-recommendation.json', import.meta.url), 'utf8'),
  );
  await createRepairJob(
    {
      recommendation: fixture.data,
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
  const room = createMemoryRoom();
  for (const role of BAND_ROLES) room.registerPeer(role, createCrewHandler(role, { context, adapters, policy }));
  room.join('Morgan Manager');
  room.join('RepairCoordinator');
  return { context, room, supplier };
}

function print(title: string, room: MemoryRoom): void {
  console.log(`\n=== ${title} ===`);
  for (const entry of room.log) {
    const text = entry.content.replace(/\n\n```thermaldesk[\s\S]*?```/, '').split('\n');
    const to = entry.mentions.length ? ` -> @${entry.mentions.join(', @')}` : '';
    const tag = entry.kind === 'event' ? `(${entry.message_type})` : entry.kind === 'message' ? '' : `(${entry.kind})`;
    console.log(`${String(entry.sequence).padStart(3)} ${entry.sender}${to} ${tag}`.trimEnd());
    for (const line of text) console.log(`      ${line}`);
  }
}

const happy = await setup();
await happy.room.post('Morgan Manager', '@RepairCoordinator coordinate JOB-001', ['RepairCoordinator']);
await advanceRepairJob(
  'JOB-001',
  { event_id: 'E-ACCEPT-1', type: 'technician_responded', technician_id: 'TECH-1', response: 'accepted', response_reference: 'SIM-IN-0001', mode: 'simulated' },
  happy.context,
);
await happy.room.post('Morgan Manager', '@RepairCoordinator update JOB-001', ['RepairCoordinator']);
print('CREW FLOW (SIMULATED room, SIMULATED adapters)', happy.room);
const done = await getJobDetail('JOB-001', happy.context);
console.log(`\nResult: status ${done.job.status}, parts ${done.job.parts_status}, booking ${done.job.booking?.status} with ${done.job.booking?.technician_name}.`);
console.log(`Orders that reached the supplier: ${happy.supplier.order_requests.length}. In the room: ${happy.room.participants().join(', ')}.`);

const blocked = await setup({ max_single_order_minor: 10_000 });
await blocked.room.post('Morgan Manager', '@RepairCoordinator coordinate JOB-001', ['RepairCoordinator']);
print('CRITIC BLOCKS THE PURCHASE (SIMULATED room, SIMULATED adapters)', blocked.room);
const held = await getJobDetail('JOB-001', blocked.context);
console.log(`\nResult: status ${held.job.status}, parts ${held.job.parts_status}.`);
console.log(`Orders that reached the supplier: ${blocked.supplier.order_requests.length}. In the room: ${blocked.room.participants().join(', ')}.`);
