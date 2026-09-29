/**
 * Demo helper: records a SIMULATED technician acceptance for the open offer of a job, the
 * way an inbound reply from a real channel would. Run with `npm run band:accept -- JOB-001`.
 */
import { advanceRepairJob, getJobDetail } from '../engine.js';
import { createFileJobRepository } from '../repository.js';
import type { CoordinationContext } from '../types.js';

const job_id = process.argv[2] ?? 'JOB-001';
const context: CoordinationContext = {
  repository: createFileJobRepository({ directory: process.env.COORDINATION_DATA_DIR ?? '.data/band' }),
};
const detail = await getJobDetail(job_id, context);
const offer = detail.offers.find((item) => item.generation === detail.generation && item.status === 'awaiting_response');
if (!offer) {
  console.log(`Job ${job_id} has no open offer. Status: ${detail.job.status}.`);
  process.exit(1);
}
const reference = `SIM-IN-${Date.now()}`;
const job = await advanceRepairJob(
  job_id,
  {
    event_id: `demo-accept:${offer.offer_id}`,
    type: 'technician_responded',
    technician_id: offer.technician_id,
    response: 'accepted',
    response_reference: reference,
    response_text: 'ACCEPT (simulated reply)',
    mode: 'simulated',
    reported_by: 'demo:band-accept',
  },
  context,
);
console.log(`SIMULATED reply recorded: ${offer.technician_name} accepted ${offer.start_at} (reference ${reference}).`);
console.log(`Job ${job_id} is ${job.status}; booking ${job.booking?.status}. On the Band runtime the booking waits for the critic.`);
console.log(`Now write in the Band room:  @RepairCoordinator update ${job_id}`);
