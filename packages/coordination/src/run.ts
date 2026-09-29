import type { ActionReceipt, IntegrationMode, JobStatus, RepairJob } from './contract.js';
import { ContractViolationError } from './errors.js';
import {
  DEFAULT_CONFIG,
  type Clock,
  type CoordinationConfig,
  type CoordinationContext,
  type Escalation,
  type EscalationTarget,
  type FollowUp,
  type FollowUpKind,
  type JobRecord,
  type JobRepository,
  type OutcomeEvidence,
  type TimelineEvent,
} from './types.js';
import { systemClock } from './clock.js';
import { clone, fingerprint, pad, toIso } from './util.js';

export interface EmitInput {
  kind?: 'workflow_event' | 'execution';
  type: string;
  summary: string;
  occurred_at?: string;
  outcome?: 'applied' | 'rejected';
  rejection?: { code: string; message: string } | null;
  source_event_id?: string | null;
  payload_fingerprint?: string | null;
  action_id?: string | null;
  mode?: IntegrationMode | null;
  data?: unknown;
}

export function resolveConfig(context: CoordinationContext): CoordinationConfig {
  const config = { ...DEFAULT_CONFIG, ...(context.config ?? {}) };
  for (const [name, value] of Object.entries(config)) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
      throw new ContractViolationError('invalid_config', `config.${name} must be a non-negative number.`);
    }
  }
  return config;
}

/**
 * One loaded job record plus the helpers that change it. Every change goes through `emit`,
 * so the history explains each state, and `persist` writes with a compare-and-swap.
 */
export class JobRun {
  readonly record: JobRecord;
  readonly repository: JobRepository;
  readonly clock: Clock;
  readonly config: CoordinationConfig;
  private persistedVersion: number;
  private unsaved: TimelineEvent[] = [];
  private dirty = false;

  constructor(record: JobRecord, context: CoordinationContext) {
    this.record = record;
    this.repository = context.repository;
    this.clock = context.clock ?? systemClock;
    this.config = resolveConfig(context);
    this.persistedVersion = record.job.state_version;
  }

  get job(): RepairJob {
    return this.record.job;
  }

  nowIso(): string {
    return toIso(this.clock.now());
  }

  nowMs(): number {
    return this.clock.now().getTime();
  }

  markDirty(): void {
    this.dirty = true;
  }

  emit(input: EmitInput): TimelineEvent {
    this.record.counters.event += 1;
    const recordedAt = this.nowIso();
    const event: TimelineEvent = {
      event_id: `${this.job.job_id}-EVT-${pad(this.record.counters.event)}`,
      sequence: this.record.counters.event,
      job_id: this.job.job_id,
      kind: input.kind ?? 'execution',
      type: input.type,
      occurred_at: input.occurred_at ?? recordedAt,
      recorded_at: recordedAt,
      summary: input.summary,
      status_after: this.job.status,
      state_version: this.persistedVersion + 1,
      outcome: input.outcome ?? 'applied',
      rejection: input.rejection ?? null,
      source_event_id: input.source_event_id ?? null,
      payload_fingerprint: input.payload_fingerprint ?? null,
      action_id: input.action_id ?? null,
      mode: input.mode ?? null,
      data: input.data === undefined ? null : clone(input.data),
    };
    this.record.events.push(event);
    this.unsaved.push(event);
    this.dirty = true;
    return event;
  }

  setStatus(status: JobStatus, reason: string): void {
    if (this.job.status === status) return;
    const previous = this.job.status;
    this.job.status = status;
    this.emit({
      type: 'status_changed',
      summary: `Status ${previous} -> ${status}: ${reason}`,
      data: { from: previous, to: status, reason },
    });
  }

  /** Raises an escalation once. An open escalation with the same code and subject is reused. */
  escalate(code: string, to: EscalationTarget, subject: string, detail: string): Escalation {
    const open = this.record.escalations.find(
      (item) => item.resolved_at === null && item.code === code && item.subject === subject,
    );
    if (open) return open;
    this.record.counters.escalation += 1;
    const escalation: Escalation = {
      escalation_id: `${this.job.job_id}-ESC-${pad(this.record.counters.escalation)}`,
      code,
      to,
      subject,
      detail,
      raised_at: this.nowIso(),
      resolved_at: null,
      resolution: null,
    };
    this.record.escalations.push(escalation);
    this.emit({
      type: 'escalation_raised',
      summary: `Escalated to ${to} (${code}): ${detail}`,
      data: { escalation_id: escalation.escalation_id, code, to, subject },
    });
    return escalation;
  }

  resolveEscalations(matches: (escalation: Escalation) => boolean, resolution: string): void {
    for (const escalation of this.record.escalations) {
      if (escalation.resolved_at !== null || !matches(escalation)) continue;
      escalation.resolved_at = this.nowIso();
      escalation.resolution = resolution;
      this.emit({
        type: 'escalation_resolved',
        summary: `Resolved ${escalation.code}: ${resolution}`,
        data: { escalation_id: escalation.escalation_id, code: escalation.code },
      });
    }
  }

  openEscalations(): Escalation[] {
    return this.record.escalations.filter((item) => item.resolved_at === null);
  }

  /** Schedules a follow-up once. A pending follow-up of the same kind and subject is reused. */
  scheduleFollowUp(kind: FollowUpKind, subject: string, due_at: string, attempt = 1): FollowUp {
    const pending = this.record.follow_ups.find(
      (item) => item.status === 'pending' && item.kind === kind && item.subject === subject,
    );
    if (pending) return pending;
    this.record.counters.follow_up += 1;
    const followUp: FollowUp = {
      follow_up_id: `${this.job.job_id}-FUP-${pad(this.record.counters.follow_up)}`,
      kind,
      subject,
      due_at,
      status: 'pending',
      attempt,
      created_at: this.nowIso(),
      closed_at: null,
      outcome: null,
    };
    this.record.follow_ups.push(followUp);
    this.emit({
      type: 'follow_up_scheduled',
      summary: `Follow-up ${kind} for ${subject} due ${due_at} (attempt ${attempt})`,
      data: { follow_up_id: followUp.follow_up_id, kind, subject, due_at, attempt },
    });
    return followUp;
  }

  closeFollowUps(
    matches: (followUp: FollowUp) => boolean,
    status: 'done' | 'cancelled',
    outcome: string,
  ): void {
    for (const followUp of this.record.follow_ups) {
      if (followUp.status !== 'pending' || !matches(followUp)) continue;
      followUp.status = status;
      followUp.closed_at = this.nowIso();
      followUp.outcome = outcome;
      this.emit({
        type: status === 'done' ? 'follow_up_done' : 'follow_up_cancelled',
        summary: `Follow-up ${followUp.kind} for ${followUp.subject}: ${outcome}`,
        data: { follow_up_id: followUp.follow_up_id, kind: followUp.kind },
      });
    }
  }

  addEvidence(
    kind: OutcomeEvidence['kind'],
    mode: IntegrationMode,
    content: unknown,
    action_id: string | null,
  ): OutcomeEvidence {
    this.record.counters.evidence += 1;
    const stored = clone(content === undefined ? null : content);
    const evidence: OutcomeEvidence = {
      evidence_id: `EV-${this.job.job_id}-${pad(this.record.counters.evidence)}`,
      action_id,
      kind,
      mode,
      captured_at: this.nowIso(),
      content: stored,
      content_sha256: fingerprint(stored),
    };
    this.record.outcome_evidence.push(evidence);
    this.dirty = true;
    return evidence;
  }

  nextActionId(): string {
    this.record.counters.action += 1;
    this.dirty = true;
    return `${this.job.job_id}-ACT-${pad(this.record.counters.action)}`;
  }

  receipt(action_id: string): ActionReceipt {
    const receipt = this.job.actions.find((item) => item.action_id === action_id);
    if (!receipt) {
      throw new ContractViolationError('receipt_missing', `No receipt for action "${action_id}".`);
    }
    return receipt;
  }

  async persist(): Promise<void> {
    if (!this.dirty) return;
    const expected = this.persistedVersion;
    const next = expected + 1;
    this.job.state_version = next;
    this.job.updated_at = this.nowIso();
    for (const event of this.unsaved) event.state_version = next;
    await this.repository.save(this.record, expected);
    this.persistedVersion = next;
    this.unsaved = [];
    this.dirty = false;
  }
}

/** Serialises work per job inside one process. The repository guards across processes. */
const queues = new WeakMap<JobRepository, Map<string, Promise<unknown>>>();

export async function withJobLock<T>(
  repository: JobRepository,
  job_id: string,
  work: () => Promise<T>,
): Promise<T> {
  let perRepository = queues.get(repository);
  if (!perRepository) {
    perRepository = new Map();
    queues.set(repository, perRepository);
  }
  const previous = perRepository.get(job_id) ?? Promise.resolve();
  const current = previous.catch(() => undefined).then(work);
  const settled = current.catch(() => undefined);
  perRepository.set(job_id, settled);
  try {
    return await current;
  } finally {
    if (perRepository.get(job_id) === settled) perRepository.delete(job_id);
  }
}
