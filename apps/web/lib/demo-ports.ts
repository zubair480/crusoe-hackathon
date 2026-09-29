/** Deterministic, visibly simulated adapters. These are not teammates' production services. */
import { randomUUID } from 'node:crypto';
import inspectionFixture from '../../../fixtures/inspection.json';
import scopeFixture from '../../../fixtures/approved-recommendation.json';
import completionFixture from '../../../fixtures/completion-wrong-asset.json';
import type { TeamPorts, Recommendation, RepairJob, ActionReceipt, InspectionPackage, CompletionEvidence } from './model';
import { collectCompletionEvidence as collectIntakeCompletion } from '@thermaldesk/intake';

export const initialInspection = () => structuredClone(inspectionFixture.data) as InspectionPackage;
export const reviewableDemoScope = (): Recommendation => ({
  ...structuredClone(scopeFixture.data) as Recommendation, status: 'draft', approval: null,
});
const now = () => new Date().toISOString();
function receipt(jobId: string, type: ActionReceipt['action_type'], detail: string, sequence: number): ActionReceipt {
  return { action_id: randomUUID(), job_id: jobId, action_type: type, idempotency_key: `demo:${jobId}:${type}:${sequence}`, mode: 'simulated', status: 'confirmed', provider_reference: `DEMO-${randomUUID().slice(0, 8)}`, evidence_ids: [], detail, recorded_at: now() };
}
export const demoPorts: TeamPorts = {
  async analyzeInspection(inspection) {
    return { ...reviewableDemoScope(), status: 'needs_information', approval: null, parts: [], repair_scope: 'Obtain calibrated thermal data and qualified assessment before defining repairs.', missing_information: [...inspection.missing_information], findings: [{ id: 'FIND-001', description: 'Reported hotspot. Cause and temperature are unverified.', evidence_ids: inspection.evidence.map(e => e.id), severity: 'unassessed', uncertainties: ['Fixture inference only; Crusoe is not connected.'] }] };
  },
  async coordinateRepair(recommendation, previous) {
    if (recommendation.status !== 'approved' || recommendation.approval?.recommendation_version !== recommendation.version) throw new Error('Approve the current scope before dispatch.');
    if (previous?.booking?.status === 'confirmed') return previous;
    const at = now();
    const sequence = (previous?.state_version ?? 0) + 1;
    const id = previous?.job_id ?? 'JOB-001';
    const actions = [...(previous?.actions ?? [])];
    if (!actions.some(a => a.action_type === 'parts_order' && a.status === 'confirmed')) actions.push(receipt(id, 'parts_order', 'SIMULATED: training prop DEMO-PART-01 reserved; no purchase or charge.', sequence));
    actions.push(receipt(id, 'technician_contact', 'SIMULATED: demo technician availability confirmed; nobody was contacted.', sequence));
    const bookingReceipt = receipt(id, 'booking', 'SIMULATED: demo appointment confirmed; no external booking.', sequence);
    actions.push(bookingReceipt);
    return {
      schema_version: '1.0', case_id: recommendation.case_id, site_id: recommendation.site_id, asset_id: recommendation.asset_id,
      job_id: id, recommendation_id: recommendation.recommendation_id, recommendation_version: recommendation.version,
      state_version: sequence, status: 'scheduled', parts_status: 'available', actions,
      booking: { technician_id: previous ? 'DEMO-TECH-2' : 'DEMO-TECH-1', technician_name: previous ? 'Jordan Lee (demo)' : 'Alex Morgan (demo)', start_at: '2026-09-30T16:00:00Z', end_at: '2026-09-30T18:00:00Z', status: 'confirmed', confirmation_action_id: bookingReceipt.action_id },
      authority: { authority_id: 'DEMO-AUTHORITY', mode: 'simulated', currency: 'USD', max_total_minor: 0, allowed_actions: ['parts_order', 'technician_contact', 'booking', 'schedule_sync', 'manager_notify', 'follow_up'], expires_at: '2099-01-01T00:00:00Z' },
      closure_review: null, unresolved_findings: recommendation.findings.map(f => f.id), updated_at: at,
    };
  },
  async cancelBooking(job) {
    if (job.status !== 'scheduled' || !job.booking) throw new Error('Only a scheduled appointment can be cancelled.');
    return { ...job, status: 'blocked', booking: { ...job.booking, status: 'cancelled' }, state_version: job.state_version + 1, updated_at: now() };
  },
  async notifyManager(job, sync) {
    if (sync.status !== 'confirmed') throw new Error('The workbook update failed. Resolve it before claiming the schedule is updated.');
    const key = `demo:${job.job_id}:manager_notify:${job.state_version}`;
    if (job.actions.some(a => a.idempotency_key === key)) return job;
    return { ...job, actions: [...job.actions, receipt(job.job_id, 'manager_notify', `SIMULATED manager update: ${job.booking?.technician_name}; job ${job.status}; parts ${job.parts_status}; actual local workbook updated. No message sent.`, job.state_version)], updated_at: now() };
  },
  async submitCompletion(job) { return { ...job, status: 'awaiting_verification', closure_review: null, state_version: job.state_version + 1, updated_at: now() }; },
  async closeRepair(job, review) { return { ...job, status: 'closed', closure_review: review, unresolved_findings: [], state_version: job.state_version + 1, updated_at: now() }; },
  async collectCompletionEvidence(job, scenario, version) {
    const completion = structuredClone(completionFixture.data) as CompletionEvidence;
    let reportedStatus: CompletionEvidence['reported_status'] = completion.reported_status;
    let comments = completion.comments;
    let evidenceAsset = completion.evidence[0].asset_id;
    let unresolvedItems = completion.unresolved_items;
    if (scenario !== 'wrong_asset') {
      evidenceAsset = job.asset_id;
      reportedStatus = scenario === 'complete' ? 'complete' : 'incomplete';
      comments = scenario === 'complete' ? 'Fictional technician reports the training prop replaced on DEMO-A. Demo evidence only.' : 'The part has not arrived; no repair was completed.';
      unresolvedItems = scenario === 'complete' ? [] : ['Repair has not been performed.'];
    }
    return collectIntakeCompletion({
      case_id: job.case_id, site_id: job.site_id, asset_id: job.asset_id,
      completion_id: completion.completion_id, job_id: job.job_id, version,
      technician_id: job.booking?.technician_id ?? 'DEMO-TECH', reported_status: reportedStatus,
      comments, unresolved_items: unresolvedItems, created_at: now(),
      transcript: {
        text: comments, uri: scenario === 'wrong_asset' ? completion.evidence[0].uri : 'demo://completion-statement',
        source: 'synthetic', mode: 'simulated', asset_id: evidenceAsset, captured_at: now(),
        segments: [{ id: `DEMO-SEG-${version}`, text: comments }],
      },
    });
  },
  async compareCompletion(job, recommendation, completion) {
    const sameAsset = completion.asset_id === job.asset_id && completion.evidence.every(e => e.asset_id === job.asset_id);
    const complete = completion.reported_status === 'complete' && completion.unresolved_items.length === 0;
    const ids = completion.evidence.map(e => e.id);
    return {
      schema_version: '1.0', case_id: job.case_id, site_id: job.site_id, asset_id: job.asset_id,
      verification_id: `VERIFY-${randomUUID()}`, job_id: job.job_id, version: completion.version,
      recommendation_version: recommendation.version, completion_id: completion.completion_id, completion_version: completion.version,
      result: !sameAsset ? 'mismatch' : !complete ? 'needs_information' : 'ready_for_review',
      checks: [
        { name: 'Equipment identity', result: sameAsset ? 'pass' : 'fail', evidence_ids: ids, detail: sameAsset ? 'Demo evidence identifies the expected equipment.' : 'Evidence identifies DEMO-B; the work order is for DEMO-A.' },
        { name: 'Reported completion', result: complete ? 'pass' : 'fail', evidence_ids: ids, detail: complete ? 'Fictional statement says work is complete; human demo review still required.' : 'Technician statement leaves work incomplete.' },
      ],
      missing_information: !sameAsset ? ['Completion evidence for the correct equipment'] : complete ? [] : ['Evidence of completed work'], analysis_mode: 'simulated', created_at: now(),
    };
  },
};
