import { BAND_ROLES, decodeEnvelope, encodeEnvelope, type BandRole, type CrewHandler } from '@thermaldesk/coordination';
import type { RepairPreparation } from './repair-preparation';

/** Band routes actual research/draft work; this lane has no purchase or send adapters. */
export function createPreparationCrewHandler(role: BandRole, preparation: Pick<RepairPreparation, 'runRole'>): CrewHandler {
  const next: Partial<Record<BandRole, BandRole>> = { RepairCoordinator: 'PartsSourcer', PartsSourcer: 'AuthorityCritic', AuthorityCritic: 'TechDispatcher', TechDispatcher: 'ScheduleReporter' };
  return async ({ message, tools }) => {
    const envelope = decodeEnvelope(message.content);
    if (!envelope || envelope.kind === 'report') return;
    if (role !== 'RepairCoordinator' && (envelope.kind !== 'job_event' || envelope.what !== `prepare:${role}`)) return;
    if (role === 'RepairCoordinator') {
      const present = (await tools.getParticipants()).map(person => person.name);
      for (const name of BAND_ROLES) if (!present.includes(name)) await tools.addParticipant(name, 'member');
    }
    const summary = await preparation.runRole(envelope.job_id, role);
    const target = next[role];
    await tools.sendMessage(encodeEnvelope(summary, target
      ? { kind: 'job_event', job_id: envelope.job_id, requested_by: envelope.requested_by, what: `prepare:${target}` }
      : { kind: 'report', job_id: envelope.job_id, requested_by: envelope.requested_by, headline: 'Research and drafts prepared; nothing purchased, sent or booked.', details: [summary] }), [target ?? 'RepairCoordinator']);
  };
}
