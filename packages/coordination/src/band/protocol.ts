/**
 * What the ThermalDesk crew says in a Band room.
 *
 * Every message is readable text for people plus one machine-readable block for the agent
 * that is @mentioned. Agents act only on messages that mention them.
 */
import type { ActionType } from '../contract.js';

export const BAND_ROLES = [
  'RepairCoordinator',
  'PartsSourcer',
  'AuthorityCritic',
  'TechDispatcher',
  'ScheduleReporter',
] as const;
export type BandRole = (typeof BAND_ROLES)[number];

/** The one job each agent owns. */
export const ROLE_DESCRIPTIONS: Record<BandRole, string> = {
  RepairCoordinator: 'Opens the case, decides which specialists it needs and recruits them. Does no specialist work.',
  PartsSourcer: 'Gets quotes for the approved parts and orders them once the critic has approved.',
  AuthorityCritic: 'Approves or blocks every purchase and booking against approval, authority and policy.',
  TechDispatcher: 'Plans the appointment after the handed-over parts estimate and contacts technicians.',
  ScheduleReporter: 'Updates the schedule workbook and reports the outcome to the person who asked.',
};

/** Keys of the agents in `agent_config.yaml`. */
export const ROLE_CONFIG_KEYS: Record<BandRole, string> = {
  RepairCoordinator: 'repair_coordinator',
  PartsSourcer: 'parts_sourcer',
  AuthorityCritic: 'authority_critic',
  TechDispatcher: 'tech_dispatcher',
  ScheduleReporter: 'schedule_reporter',
};

export interface RoomParticipant {
  id: string;
  name: string;
  type: string;
}

/** The part of Band's agent tools the crew uses. Band's own tools satisfy it. */
export interface RoomTools {
  sendMessage(content: string, mentions?: string[]): Promise<unknown>;
  sendEvent(content: string, messageType: string, metadata?: Record<string, unknown>): Promise<unknown>;
  addParticipant(name: string, role?: string): Promise<unknown>;
  getParticipants(): Promise<RoomParticipant[]>;
  lookupPeers?(page?: number, pageSize?: number): Promise<{ data: { id?: string; name?: string; type?: string }[] }>;
}

export interface RoomMessage {
  id: string;
  roomId: string;
  content: string;
  senderName: string | null;
  senderType: string;
}

interface EnvelopeBase {
  job_id: string;
  /** The person who asked. The final report is addressed to them. */
  requested_by: string;
}

export type Envelope =
  | (EnvelopeBase & { kind: 'kickoff' })
  | (EnvelopeBase & { kind: 'job_event'; what: string })
  | (EnvelopeBase & { kind: 'stage_request'; stage: 'sourcing' | 'outreach' | 'publication' })
  | (EnvelopeBase & {
      kind: 'parts_handoff';
      /** Latest delivery estimate among parts still to arrive. `null`: nothing has to arrive. */
      parts_delivery_estimate: string | null;
      parts: { part_id: string; supplier_name: string; purchase_outcome: string; estimated_delivery_at: string | null }[];
    })
  | (EnvelopeBase & {
      kind: 'verdict_request';
      request_id: string;
      action_type: ActionType;
      summary: string;
      details: unknown;
      reply_to: string;
    })
  | (EnvelopeBase & {
      kind: 'verdict';
      request_id: string;
      verdict: 'approved' | 'blocked';
      reason: string;
      checks: string[];
    })
  | (EnvelopeBase & {
      kind: 'booking_handoff';
      technician_name: string;
      start_at: string;
      end_at: string;
    })
  | (EnvelopeBase & { kind: 'notice'; headline: string; details: string[] })
  | (EnvelopeBase & { kind: 'report'; headline: string; details: string[] });

const FENCE = '```';
const BLOCK = new RegExp(`${FENCE}thermaldesk\\s*\\n([\\s\\S]*?)\\n${FENCE}`);

export function encodeEnvelope(text: string, envelope: Envelope): string {
  return `${text}\n\n${FENCE}thermaldesk\n${JSON.stringify(envelope)}\n${FENCE}`;
}

export function decodeEnvelope(content: string): Envelope | null {
  const match = BLOCK.exec(content);
  if (!match?.[1]) return null;
  try {
    const parsed = JSON.parse(match[1]) as Envelope;
    return parsed && typeof parsed === 'object' && typeof parsed.kind === 'string' && typeof parsed.job_id === 'string'
      ? parsed
      : null;
  } catch {
    return null;
  }
}

/** Reads "coordinate JOB-001" or "update JOB-001" as typed by a person. */
export function parseCommand(content: string): { command: 'coordinate' | 'update'; job_id: string } | null {
  const match = /\b(coordinate|start|update|sync)\s+(?:job\s+)?([A-Za-z0-9][A-Za-z0-9._:-]*)/i.exec(content);
  if (!match?.[1] || !match[2]) return null;
  const word = match[1].toLowerCase();
  return { command: word === 'coordinate' || word === 'start' ? 'coordinate' : 'update', job_id: match[2] };
}
