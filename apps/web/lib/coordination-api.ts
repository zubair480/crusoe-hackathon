import { advanceRepairJob, selectCoordinationRuntime, type WorkflowEvent } from '@thermaldesk/coordination';
import { BandGateway } from './band-gateway';
import { coordination, service } from './service';

const globals = globalThis as typeof globalThis & { thermaldeskBandGateway?: BandGateway };
export const band = globals.thermaldeskBandGateway ??= new BandGateway(service.store.directory, coordination);
export async function coordinationStatus() {
  const state = await service.read();
  return { revision: state.revision, band: await band.status(),
    detail: state.job ? await coordination.getDetail(state.job.job_id) : null,
    timeline: state.job ? await coordination.getTimeline(state.job.job_id) : [] };
}
export interface CoordinationInput {
  command: 'check_band' | 'start_band' | 'stop_band' | 'dispatch_band' | 'event';
  expectedRevision: number;
  allowLiveBand?: boolean;
  event?: WorkflowEvent;
}
export async function coordinationCommand(input: CoordinationInput) {
  if (!Number.isInteger(input.expectedRevision)) throw new Error('A case revision is required.');
  if (input.command === 'check_band') return { agents: await band.check() };
  if (input.command === 'stop_band') { await band.stop(); return band.status(); }
  if (!['start_band', 'dispatch_band', 'event'].includes(input.command)) throw new Error('Unknown coordination command.');
  if (input.command !== 'event' && input.allowLiveBand !== true) throw new Error('Set allowLiveBand to true to explicitly connect or dispatch through Band.');
  const state = await service.store.update(async state => {
    if (state.revision !== input.expectedRevision) throw new Error('Case changed. Refresh before coordinating.');
    if (state.job && (await coordination.getDetail(state.job.job_id)).job.state_version !== state.job.state_version) throw new Error('Job changed. Refresh before coordinating.');
    if (input.command === 'dispatch_band') {
      if (!state.recommendation || state.recommendation.status !== 'approved') throw new Error('Approve the current recommendation before Band dispatch.');
      state.job = await coordination.createBandJob(state.recommendation, state.job);
      state.job = await selectCoordinationRuntime(state.job.job_id, 'band', coordination.context);
    }
    if (!state.job) throw new Error('Create an approved repair job first.');
    if (input.command === 'event') {
      if (!input.event || !['technician_responded', 'technician_cancelled', 'parts_order_updated', 'work_started', 'job_cancelled'].includes(input.event.type)) {
        throw new Error('Use the dedicated review and evidence routes for approval or completion; this endpoint accepts execution events only.');
      }
      state.job = await advanceRepairJob(state.job.job_id, input.event, coordination.context);
    }
    state.revision++;
    return { state, result: state };
  });
  const job = state.job!;
  if (input.command === 'start_band') { await band.start(job.job_id); return { state, band: await band.status() }; }
  if (input.command === 'dispatch_band') {
    const detail = await coordination.getDetail(job.job_id);
    const update = Boolean(job.booking || detail.offers.some(offer => offer.status === 'accepted') || ['closed', 'cancelled'].includes(job.status));
    return { state, dispatch: await band.dispatch(job.job_id, `state:${job.state_version}`, update) };
  }
  const detail = await coordination.getDetail(job.job_id);
  if (detail.runtime === 'band' && input.allowLiveBand === true) {
    return { state, dispatch: await band.dispatch(job.job_id, `event:${input.event!.event_id}`, true) };
  }
  return { state };
}
