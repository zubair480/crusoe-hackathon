import { createHash, randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { createScheduleAdapter, readSchedule, type ScheduleSnapshot } from '@thermaldesk/excel';
import {
  ACTION_TYPES,
  advanceRepairJob,
  coordinateRepair as runCoordinator,
  createFileJobRepository,
  createRepairJob,
  createSimulatedCommunication,
  createSimulatedRoster,
  createSimulatedSupplier,
  getJobDetail,
  getRepairJob,
  getJobTimeline,
  publishRepairSchedule,
  systemClock,
  type CoordinationAdapters,
  type CoordinationContext,
  type Recommendation as CoordinatorRecommendation,
  type Technician,
} from '@thermaldesk/coordination';
import type { TeamPorts } from './model';

/**
 * Composition boundary for Isaac's coordinator. Supplier, roster and communication
 * adapters remain simulated; the CaseService writes the resulting canonical job to
 * the local Excel workbook and verifies that write before manager acknowledgement.
 */
export function createCoordinationPorts(directory: string, base: TeamPorts) {
  const context: CoordinationContext = {
    repository: createFileJobRepository({ directory: join(directory, 'coordination') }),
  };
  const snapshotPath = join(directory, 'schedule-state.json');
  const readScheduleSnapshot = async (): Promise<ScheduleSnapshot> => {
    try { return JSON.parse(await readFile(snapshotPath, 'utf8')); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    // Migrate the last accepted app fingerprint, never trust a fresh external workbook read.
    try { return JSON.parse(await readFile(join(directory, 'case.json'), 'utf8')).schedule; }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    return { fingerprint: null, rows: [] };
  };
  const acceptScheduleSnapshot = async (snapshot: ScheduleSnapshot) => {
    await mkdir(directory, { recursive: true });
    const temporary = `${snapshotPath}.${randomUUID()}.tmp`;
    await writeFile(temporary, JSON.stringify(snapshot), 'utf8');
    await rename(temporary, snapshotPath);
  };
  const schedule = createScheduleAdapter({
    workbookPath: join(directory, 'demo-schedule.xlsx'),
    getExpectedFingerprint: async () => (await readScheduleSnapshot()).fingerprint,
    onConfirmed: acceptScheduleSnapshot,
  });

  const buildAdapters = (recommendation: Pick<CoordinatorRecommendation, 'site_id' | 'parts'>): CoordinationAdapters => {
    const now = Date.now();
    const technician = (id: string, name: string, distance_km: number): Technician => ({
      technician_id: id,
      name,
      qualifications: ['electrical', 'thermography'],
      site_ids: [recommendation.site_id],
      distance_km,
      availability: [{
        start_at: new Date(now + 2 * 24 * 60 * 60 * 1000).toISOString(),
        end_at: new Date(now + 12 * 24 * 60 * 60 * 1000).toISOString(),
      }],
      contact: { channel: 'simulated', address: `sim:${id}` },
      active: true,
    });
    const catalog = Object.fromEntries(recommendation.parts.map(part => [part.part_id, {
      unit_price_minor: 12_500,
      currency: 'USD',
      quantity_available: Math.max(part.quantity, 10),
      lead_time_hours: 24,
    }]));
    return {
      suppliers: [createSimulatedSupplier({ supplier_id: 'SUP-DEMO-1', name: 'Demo Electrical Supply', clock: systemClock, catalog })],
      roster: createSimulatedRoster([
        technician('TECH-DEMO-1', 'Jordan Demo Technician', 8),
        technician('TECH-DEMO-2', 'Taylor Backup Technician', 15),
      ]),
      communication: createSimulatedCommunication(),
      schedule,
      manager: { manager_id: 'MGR-DEMO', name: 'Demo Facilities Manager', address: 'sim:manager' },
    };
  };

  const adaptersForJob = async (jobId: string) => {
    const detail = await getJobDetail(jobId, context);
    return buildAdapters({ site_id: detail.job.site_id, parts: detail.approved_scope.parts });
  };
  const ensureJob = async (recommendation: CoordinatorRecommendation, previous: import('./model').RepairJob | null, runtime: 'job_queue' | 'band' = 'job_queue') => {
    const approvalKey = createHash('sha256').update(JSON.stringify(recommendation.approval)).digest('hex').slice(0, 16);
    const jobId = previous?.job_id ?? `JOB-${recommendation.recommendation_id}-v${recommendation.version}-${approvalKey}`;
    return createRepairJob({
      recommendation, job_id: jobId, runtime,
      authority: { authority_id: `AUTH-${jobId}`, mode: 'simulated', currency: 'USD', max_total_minor: 1_000_000,
        allowed_actions: [...ACTION_TYPES], expires_at: new Date(Date.now() + 30 * 86400000).toISOString() },
      requirements: { required_qualifications: ['electrical'], duration_minutes: 120 },
    }, context);
  };
  const ports: TeamPorts = {
    ...base,
    refreshJob: job => getRepairJob(job.job_id, context),
    readScheduleSnapshot,
    acceptScheduleSnapshot,
    async syncJobSchedule(job) {
      const accepted = await readScheduleSnapshot();
      const actual = await readSchedule(join(directory, 'demo-schedule.xlsx'));
      const row = accepted.rows.find(row => row.job_id === job.job_id);
      const booking = job.booking?.status === 'confirmed' ? job.booking : null;
      const latest = job.actions.filter(action => action.action_type === 'schedule_sync').at(-1);
      if (latest?.status === 'confirmed' && actual.fingerprint === accepted.fingerprint && row &&
          row.job_status === job.status && row.parts_status === job.parts_status &&
          row.technician_id === (booking?.technician_id ?? '') && row.start_at === (booking?.start_at ?? '') && row.end_at === (booking?.end_at ?? '')) return job;
      return publishRepairSchedule(job.job_id, await adaptersForJob(job.job_id), context);
    },
    async notifyManager(job) {
      return ports.syncJobSchedule!(job);
    },
    async coordinateRepair(recommendation, previous) {
      const coordinatorRecommendation = recommendation as CoordinatorRecommendation;
      const created = await ensureJob(coordinatorRecommendation, previous);
      const jobId = created.job_id;
      if ((await getJobDetail(jobId, context)).runtime === 'band') return created;
      const adapters = buildAdapters(coordinatorRecommendation);
      let job = await runCoordinator(jobId, adapters, context);
      if (job.status === 'coordinating') {
        const detail = await getJobDetail(jobId, context);
        const offer = detail.offers.find(item => item.status === 'awaiting_response');
        if (offer) {
          job = await advanceRepairJob(jobId, {
            event_id: randomUUID(),
            type: 'technician_responded',
            technician_id: offer.technician_id,
            response: 'accepted',
            response_reference: `SIM-ACCEPT-${offer.offer_id}`,
            response_text: 'Accepted in the demo workflow.',
            mode: 'simulated',
          }, context);
          job = await runCoordinator(jobId, adapters, context);
        }
      }
      return job;
    },
    async cancelBooking(job) {
      if (!job.booking) return job;
      await advanceRepairJob(job.job_id, {
        event_id: randomUUID(), type: 'technician_cancelled', technician_id: job.booking.technician_id,
        reason: 'Demo cancellation requested from the operations console.',
      }, context);
      const detail = await getJobDetail(job.job_id, context);
      return runCoordinator(job.job_id, buildAdapters({ site_id: job.site_id, parts: detail.approved_scope.parts }), context);
    },
    async submitCompletion(job, completion) {
      if (job.status === 'scheduled' && job.booking) {
        await advanceRepairJob(job.job_id, {
          event_id: randomUUID(), type: 'work_started', technician_id: job.booking.technician_id,
        }, context);
      }
      return advanceRepairJob(job.job_id, {
        event_id: randomUUID(), type: 'completion_evidence_received', completion,
      }, context);
    },
    async compareCompletion(job, recommendation, completion) {
      const verification = await base.compareCompletion(job, recommendation, completion);
      await advanceRepairJob(job.job_id, {
        event_id: randomUUID(), type: 'verification_draft_received', verification,
      }, context);
      return verification;
    },
    async closeRepair(job, review, verification) {
      // The comparison step persisted this verification. The explicit review is the
      // separate human gate that permits closure.
      void verification;
      return advanceRepairJob(job.job_id, {
        event_id: randomUUID(), type: 'closure_review_recorded', review,
      }, context);
    },
  };
  return Object.assign(ports, {
    context,
    adaptersForJob,
    createBandJob: (recommendation: import('./model').Recommendation, previous: import('./model').RepairJob | null) => ensureJob(recommendation, previous, 'band'),
    getDetail: (jobId: string) => getJobDetail(jobId, context),
    getTimeline: (jobId: string) => getJobTimeline(jobId, context),
  });
}
