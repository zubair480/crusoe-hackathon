import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import {
  ACTION_TYPES,
  advanceRepairJob,
  coordinateRepair as runCoordinator,
  createFileJobRepository,
  createRepairJob,
  createSimulatedCommunication,
  createSimulatedRoster,
  createSimulatedSchedule,
  createSimulatedSupplier,
  getJobDetail,
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
export function createCoordinationPorts(directory: string, base: TeamPorts): TeamPorts {
  const context: CoordinationContext = {
    repository: createFileJobRepository({ directory: join(directory, 'coordination') }),
  };

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
      schedule: createSimulatedSchedule({ clock: systemClock }),
      manager: { manager_id: 'MGR-DEMO', name: 'Demo Facilities Manager', address: 'sim:manager' },
    };
  };

  return {
    ...base,
    async coordinateRepair(recommendation, previous) {
      const coordinatorRecommendation = recommendation as CoordinatorRecommendation;
      const jobId = previous?.job_id ?? `JOB-${recommendation.recommendation_id}-${Date.now()}`;
      const authority = {
        authority_id: `AUTH-${jobId}`,
        mode: 'simulated' as const,
        currency: 'USD',
        max_total_minor: 1_000_000,
        allowed_actions: [...ACTION_TYPES],
        expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      };
      await createRepairJob({
        recommendation: coordinatorRecommendation,
        job_id: jobId,
        authority,
        requirements: { required_qualifications: ['electrical'], duration_minutes: 120 },
      }, context);
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
}
