/**
 * Runnable demonstration with fictional data. Everything is SIMULATED: no supplier,
 * technician, manager or workbook is contacted. Run with `npm run demo`.
 */
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ACTION_TYPES,
  advanceRepairJob,
  coordinateRepair,
  createFileJobRepository,
  createRepairJob,
  createSimulatedCommunication,
  createSimulatedRoster,
  createSimulatedSchedule,
  createSimulatedSupplier,
  createTestClock,
  getJobTimeline,
  processDueFollowUps,
  type CompletionEvidence,
  type CoordinationAdapters,
  type CoordinationContext,
  type Recommendation,
  type Technician,
} from './index.js';

const fixture = async (name: string) =>
  JSON.parse(await readFile(new URL(`../../../../fixtures/${name}`, import.meta.url), 'utf8')).data;

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

async function environment() {
  const clock = createTestClock('2026-09-29T20:00:00.000Z');
  const directory = await mkdtemp(join(tmpdir(), 'thermaldesk-demo-'));
  const context: CoordinationContext = { repository: createFileJobRepository({ directory }), clock };
  const adapters: CoordinationAdapters = {
    suppliers: [
      createSimulatedSupplier({
        supplier_id: 'SUP-A',
        name: 'Demo Supplier A',
        clock,
        catalog: { 'DEMO-PART-01': { unit_price_minor: 12_500, currency: 'USD', quantity_available: 5, lead_time_hours: 24 } },
      }),
    ],
    roster: createSimulatedRoster([technician('TECH-1', 'Dana Demo', 5), technician('TECH-2', 'Eli Example', 20)]),
    communication: createSimulatedCommunication(),
    schedule: createSimulatedSchedule({ clock }),
    manager: { manager_id: 'MGR-DEMO', name: 'Morgan Manager', address: 'sim:manager' },
  };
  const recommendation: Recommendation = await fixture('approved-recommendation.json');
  await createRepairJob(
    {
      recommendation,
      job_id: 'JOB-001',
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
  await coordinateRepair('JOB-001', adapters, context);
  return { clock, context, adapters };
}

async function print(title: string, context: CoordinationContext): Promise<void> {
  console.log(`\n=== ${title} ===`);
  for (const event of await getJobTimeline('JOB-001', context)) {
    const mode = event.mode ? ` [${event.mode}]` : '';
    const flag = event.outcome === 'rejected' ? ' REJECTED' : '';
    console.log(`${String(event.sequence).padStart(3)} v${event.state_version} ${event.status_after.padEnd(22)} ${event.type}${mode}${flag}: ${event.summary}`);
  }
}

const accept = (event_id: string, technician_id: string, reference: string) => ({
  event_id,
  type: 'technician_responded' as const,
  technician_id,
  response: 'accepted' as const,
  response_reference: reference,
  mode: 'simulated' as const,
});

async function happyPath(): Promise<void> {
  const { context, adapters } = await environment();
  await advanceRepairJob('JOB-001', accept('E-ACCEPT-1', 'TECH-1', 'SIM-IN-0001'), context);
  await coordinateRepair('JOB-001', adapters, context);
  await advanceRepairJob('JOB-001', { event_id: 'E-START', type: 'work_started', technician_id: 'TECH-1' }, context);
  const completion: CompletionEvidence = await fixture('completion-wrong-asset.json');
  completion.technician_id = 'TECH-1';
  completion.comments = 'Technician reports completion on DEMO-A.';
  completion.unresolved_items = [];
  completion.evidence[0]!.asset_id = 'DEMO-A';
  completion.evidence[0]!.text = 'The repair is complete on panel DEMO-A.';
  await advanceRepairJob('JOB-001', { event_id: 'E-COMP-1', type: 'completion_evidence_received', completion }, context);
  await advanceRepairJob(
    'JOB-001',
    {
      event_id: 'E-VER-1',
      type: 'verification_draft_received',
      verification: {
        schema_version: '1.0', case_id: 'DEMO-CASE-001', site_id: 'DEMO-SITE', asset_id: 'DEMO-A',
        verification_id: 'VER-001', job_id: 'JOB-001', version: 1, recommendation_version: 1,
        completion_id: 'COMP-001', completion_version: 1, result: 'ready_for_review', checks: [],
        missing_information: [], analysis_mode: 'simulated', created_at: '2026-09-29T20:00:00.000Z',
      },
    },
    context,
  );
  await advanceRepairJob(
    'JOB-001',
    {
      event_id: 'E-CLOSE-1',
      type: 'closure_review_recorded',
      review: {
        reviewer_id: 'DEMO-REVIEWER', verification_id: 'VER-001', verification_version: 1, completion_version: 1,
        recommendation_version: 1, decision: 'approve_closure', reviewed_at: '2026-09-29T20:00:00.000Z', mode: 'simulated',
      },
    },
    context,
  );
  await coordinateRepair('JOB-001', adapters, context);
  await print('HAPPY PATH (all integrations SIMULATED)', context);
}

async function exceptionPath(): Promise<void> {
  const { clock, context, adapters } = await environment();
  clock.advanceMinutes(61);
  await processDueFollowUps(adapters, context);
  await advanceRepairJob('JOB-001', accept('E-ACCEPT-2', 'TECH-2', 'SIM-IN-0002'), context);
  await coordinateRepair('JOB-001', adapters, context);
  await advanceRepairJob(
    'JOB-001',
    { event_id: 'E-CANCEL-1', type: 'technician_cancelled', technician_id: 'TECH-2', reason: 'Vehicle breakdown' },
    context,
  );
  await coordinateRepair('JOB-001', adapters, context);
  await print('EXCEPTION PATH: no reply, then cancellation (all integrations SIMULATED)', context);
}

await happyPath();
await exceptionPath();
