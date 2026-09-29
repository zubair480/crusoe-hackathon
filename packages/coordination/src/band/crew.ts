/**
 * The ThermalDesk crew: five agents that coordinate one repair through a Band room.
 *
 * Routing lives in the room. No agent calls another agent; each acts only when it is
 * @mentioned and hands over by @mentioning the next one. The critic's verdict and the parts
 * estimate travel in messages, and the engine refuses to buy, book or plan without them.
 */
import { advanceRepairJob, coordinateRepair, getJobDetail, selectCoordinationRuntime } from '../engine.js';
import { modeCovers, type IntegrationMode } from '../contract.js';
import { systemClock } from '../clock.js';
import { CoordinationError } from '../errors.js';
import { DEFAULT_CONFIG, type CoordinationAdapters, type CoordinationContext, type JobDetail, type VerdictRequest } from '../types.js';
import { canonicalJson, formatMoney, normaliseSpecification } from '../util.js';
import {
  decodeEnvelope,
  encodeEnvelope,
  parseCommand,
  type BandRole,
  type Envelope,
  type RoomMessage,
  type RoomTools,
} from './protocol.js';

/** Rules only the critic applies, on top of the authority the engine already enforces. */
export interface CriticPolicy {
  /** A single order above this amount is blocked, even inside the total authority. */
  max_single_order_minor?: number;
  blocked_supplier_ids?: string[];
}

export interface CrewDeps {
  context: CoordinationContext;
  adapters: CoordinationAdapters;
  /** Names the agents are registered under in Band. Defaults to the role names. */
  names?: Partial<Record<BandRole, string>>;
  policy?: CriticPolicy;
}

export type CrewHandler = (input: { message: RoomMessage; tools: RoomTools }) => Promise<void>;

export function createCrewHandler(role: BandRole, deps: CrewDeps): CrewHandler {
  const nameOf = (other: BandRole) => deps.names?.[other] ?? other;
  const me = nameOf(role);
  const asked = new Set<string>();
  const announced = new Set<string>();
  const { context, adapters } = deps;

  const say = (tools: RoomTools, to: string[], text: string, envelope: Envelope) =>
    tools.sendMessage(encodeEnvelope(text, envelope), to);
  const think = (tools: RoomTools, text: string, metadata: Record<string, unknown> = {}) =>
    tools.sendEvent(text, 'thought', { agent: me, ...metadata });

  async function recruit(tools: RoomTools, roles: BandRole[]): Promise<{ added: string[]; missing: string[] }> {
    const present = (await tools.getParticipants()).map((item) => item.name);
    const peers = tools.lookupPeers ? (await tools.lookupPeers(1, 100)).data.map((item) => item.name) : null;
    const added: string[] = [];
    const missing: string[] = [];
    for (const wanted of roles) {
      const name = nameOf(wanted);
      if (present.includes(name)) continue;
      if (peers && !peers.includes(name)) {
        missing.push(name);
        continue;
      }
      try {
        await tools.addParticipant(name, 'member');
        added.push(name);
      } catch {
        missing.push(name);
      }
    }
    return { added, missing };
  }

  const problems = (detail: JobDetail): string[] =>
    detail.open_escalations.map((item) => `${item.code}: ${item.detail}`);

  async function askCritic(tools: RoomTools, detail: JobDetail, requested_by: string, action_type: VerdictRequest['action_type']): Promise<number> {
    const pending = detail.verdict_requests.filter((item) => item.status === 'pending' && item.action_type === action_type);
    for (const request of pending) {
      if (asked.has(request.request_id)) continue;
      asked.add(request.request_id);
      await say(tools, [nameOf('AuthorityCritic')], `Verdict needed before I do this: ${request.summary}.`, {
        kind: 'verdict_request',
        job_id: detail.job.job_id,
        requested_by,
        request_id: request.request_id,
        action_type: request.action_type,
        summary: request.summary,
        details: request.details,
        reply_to: me,
      });
    }
    return pending.length;
  }

  async function recordVerdict(message: RoomMessage, envelope: Extract<Envelope, { kind: 'verdict' }>): Promise<void> {
    await advanceRepairJob(
      envelope.job_id,
      {
        event_id: `band:${message.roomId}:${message.id}`,
        type: 'action_verdict_recorded',
        request_id: envelope.request_id,
        verdict: envelope.verdict,
        decided_by: message.senderName ?? nameOf('AuthorityCritic'),
        reason: envelope.reason,
        reference: `band:${message.roomId}:${message.id}`,
      },
      context,
    );
  }

  /* ------------------------------ RepairCoordinator ------------------------------ */

  async function coordinator(message: RoomMessage, tools: RoomTools): Promise<void> {
    const envelope = decodeEnvelope(message.content);
    if (envelope?.kind === 'notice') {
      await tools.sendMessage(
        [`${envelope.headline} (job ${envelope.job_id}).`, ...envelope.details.map((item) => `- ${item}`)].join('\n'),
        [envelope.requested_by],
      );
      return;
    }
    const command = envelope ? null : parseCommand(message.content);
    const job_id = envelope?.job_id ?? command?.job_id;
    const requested_by = envelope?.requested_by ?? message.senderName ?? 'requester';
    if (!job_id) {
      await tools.sendMessage('Tell me which job: write "coordinate <job id>" or "update <job id>".', [requested_by]);
      return;
    }
    const detail = await getJobDetail(job_id, context);

    if (envelope?.kind === 'job_event' || command?.command === 'update') {
      const { job } = detail;
      if (['scheduled', 'closed', 'cancelled'].includes(job.status)) {
        const { missing } = await recruit(tools, ['ScheduleReporter']);
        if (missing.length > 0) {
          await tools.sendMessage(`I cannot publish job ${job_id}: ${missing.join(', ')} is not reachable in Band.`, [requested_by]);
          return;
        }
        await think(tools, `Job ${job_id} is ${job.status}. The schedule and the report are the reporter's work.`);
        await say(tools, [nameOf('ScheduleReporter')], `Publish the current state of job ${job_id}.`, {
          kind: 'stage_request',
          stage: 'publication',
          job_id,
          requested_by,
        });
        return;
      }
      await think(tools, `Job ${job_id} is ${job.status}. Something changed, so the dispatcher looks at the appointment.`);
      await say(tools, [nameOf('TechDispatcher')], `Job ${job_id} changed. Review the appointment.`, {
        kind: 'stage_request',
        stage: 'outreach',
        job_id,
        requested_by,
      });
      return;
    }

    // Kickoff: the roster is decided from the case, not fixed in advance.
    await selectCoordinationRuntime(job_id, 'band', context);
    const partsToSource = detail.approved_scope.parts.length > 0 && detail.job.parts_status !== 'available';
    const wanted: BandRole[] = partsToSource
      ? ['AuthorityCritic', 'PartsSourcer', 'TechDispatcher']
      : ['AuthorityCritic', 'TechDispatcher'];
    const { added, missing } = await recruit(tools, wanted);
    await think(
      tools,
      `Job ${job_id} on asset ${detail.job.asset_id}: ${detail.approved_scope.parts.length} approved part(s), parts status ${detail.job.parts_status}. ` +
        `${partsToSource ? 'Parts must be sourced first.' : 'Nothing has to be sourced, so no parts specialist is needed.'} ` +
        `Recruited: ${added.join(', ') || 'nobody new'}.`,
      { recruited: added, missing },
    );
    if (missing.length > 0) {
      await tools.sendMessage(`I cannot coordinate job ${job_id}: ${missing.join(', ')} is not reachable in Band.`, [requested_by]);
      return;
    }
    if (partsToSource) {
      await say(tools, [nameOf('PartsSourcer')], `Source the approved parts for job ${job_id}.`, {
        kind: 'stage_request',
        stage: 'sourcing',
        job_id,
        requested_by,
      });
    } else {
      await say(tools, [nameOf('TechDispatcher')], `Job ${job_id} needs no parts delivery. Plan the appointment.`, {
        kind: 'parts_handoff',
        job_id,
        requested_by,
        parts_delivery_estimate: null,
        parts: [],
      });
    }
  }

  /* -------------------------------- PartsSourcer --------------------------------- */

  async function sourcer(message: RoomMessage, tools: RoomTools): Promise<void> {
    const envelope = decodeEnvelope(message.content);
    if (!envelope) return;
    if (envelope.kind === 'verdict') await recordVerdict(message, envelope);
    else if (!(envelope.kind === 'stage_request' && envelope.stage === 'sourcing')) return;

    const { job_id, requested_by } = envelope;
    await coordinateRepair(job_id, adapters, context, { stage: 'sourcing', runtime: 'band' });
    const detail = await getJobDetail(job_id, context);
    if ((await askCritic(tools, detail, requested_by, 'parts_order')) > 0) return;

    const active = detail.sourcing.filter(
      (item) => item.recommendation_version === detail.job.recommendation_version && item.status !== 'superseded',
    );
    const ordered =
      active.length === detail.approved_scope.parts.length &&
      active.every((item) => item.order && ['ordered', 'delayed', 'delivered'].includes(item.status));
    if (!ordered) {
      await say(tools, [nameOf('RepairCoordinator')], `I could not order the parts for job ${job_id}.`, {
        kind: 'notice',
        job_id,
        requested_by,
        headline: 'The approved parts were not ordered',
        details: problems(detail),
      });
      return;
    }
    const awaited = active.filter((item) => item.status !== 'delivered' && item.order?.estimated_delivery_at);
    const estimate = awaited.length
      ? new Date(Math.max(...awaited.map((item) => Date.parse(item.order!.estimated_delivery_at!)))).toISOString()
      : null;
    await think(tools, `Parts for job ${job_id} are ordered. Latest delivery estimate: ${estimate ?? 'nothing has to arrive'}.`);
    await say(
      tools,
      [nameOf('TechDispatcher')],
      `Parts for job ${job_id} are ordered. The latest delivery estimate is ${estimate ?? 'none'}. Plan the appointment after it.`,
      {
        kind: 'parts_handoff',
        job_id,
        requested_by,
        parts_delivery_estimate: estimate,
        parts: active.map((item) => ({
          part_id: item.part_id,
          supplier_name: item.order!.supplier_name,
          purchase_outcome: item.order!.purchase_outcome,
          estimated_delivery_at: item.order!.estimated_delivery_at,
        })),
      },
    );
  }

  /* ------------------------------- AuthorityCritic -------------------------------- */

  async function critic(message: RoomMessage, tools: RoomTools): Promise<void> {
    const envelope = decodeEnvelope(message.content);
    if (envelope?.kind !== 'verdict_request') return;
    const detail = await getJobDetail(envelope.job_id, context);
    const now = (context.clock ?? systemClock).now().getTime();
    const buffer = (context.config?.parts_buffer_minutes ?? DEFAULT_CONFIG.parts_buffer_minutes) * 60_000;
    const checks: string[] = [];
    const failures: string[] = [];
    const check = (name: string, passed: boolean, failure: string) => {
      checks.push(`${passed ? 'pass' : 'FAIL'}: ${name}`);
      if (!passed) failures.push(failure);
    };

    const request = detail.verdict_requests.find((item) => item.request_id === envelope.request_id);
    check('the request is recorded for this job and still open', request?.status === 'pending', `Request ${envelope.request_id} is not an open request of job ${envelope.job_id}.`);
    // The recorded request is judged, not the copy in the message.
    check(
      'the request in the room matches the recorded request',
      request !== undefined && canonicalJson(request.details) === canonicalJson(envelope.details) && request.action_type === envelope.action_type,
      'The request in the room differs from the recorded request.',
    );
    const facts = (request?.details ?? {}) as Record<string, unknown>;
    const mode = (facts.mode ?? 'live') as IntegrationMode;
    const authority = detail.job.authority;
    const approval = detail.approved_scope.approval;

    check('the approval still covers the job', detail.approval_valid, `The approval no longer covers the job: ${detail.approval_invalid_reason}`);
    check('the approval names the current version', approval.recommendation_version === detail.job.recommendation_version, 'The approval is for another recommendation version.');
    check(`the ${approval.mode} approval covers a ${mode} action`, modeCovers(approval.mode, mode), `A ${approval.mode} approval does not cover a ${mode} action.`);
    check('an authority is configured', authority !== null, 'No authority is configured.');
    if (authority) {
      check('the authority has not expired', Date.parse(authority.expires_at) > now, `Authority ${authority.authority_id} expired at ${authority.expires_at}.`);
      check(`the authority allows ${envelope.action_type}`, authority.allowed_actions.includes(envelope.action_type), `Authority ${authority.authority_id} does not allow ${envelope.action_type}.`);
      check(`the ${authority.mode} authority covers a ${mode} action`, modeCovers(authority.mode, mode), `A ${authority.mode} authority does not cover a ${mode} action.`);
    }

    if (request?.action_type === 'parts_order') {
      const part = detail.approved_scope.parts.find((item) => item.part_id === facts.part_id);
      const total = Number(facts.total_minor);
      const committed = detail.sourcing.reduce(
        (sum, item) => (item.order && !['failed', 'rejected'].includes(item.order.purchase_outcome) ? sum + item.order.total_minor : sum),
        0,
      );
      check('the part is in the approved scope', part !== undefined, `Part ${String(facts.part_id)} is not in the approved scope.`);
      if (part) {
        check('the quantity is the approved quantity', part.quantity === facts.quantity, `The approved quantity is ${part.quantity}, the order is for ${String(facts.quantity)}.`);
        check(
          'the specification is the approved specification',
          normaliseSpecification(part.approved_specification) === normaliseSpecification(String(facts.approved_specification ?? '')),
          'The specification differs from the approved one.',
        );
      }
      check('the supplier is an allowed supplier', adapters.suppliers.some((item) => item.supplier_id === facts.supplier_id), `Supplier ${String(facts.supplier_id)} is not an allowed supplier.`);
      check('the supplier is not blocked by policy', !(deps.policy?.blocked_supplier_ids ?? []).includes(String(facts.supplier_id)), `Supplier ${String(facts.supplier_id)} is blocked by policy.`);
      if (authority) {
        check('the currency is the authority currency', facts.currency === authority.currency, `The order is in ${String(facts.currency)}, the authority is in ${authority.currency}.`);
        check(
          'the order fits the remaining authority',
          Number.isFinite(total) && committed + total <= authority.max_total_minor,
          `${formatMoney(total, authority.currency)} plus ${formatMoney(committed, authority.currency)} committed exceeds ${formatMoney(authority.max_total_minor, authority.currency)}.`,
        );
      }
      const cap = deps.policy?.max_single_order_minor;
      if (cap !== undefined) {
        check(
          'the order is within the single-order limit',
          Number.isFinite(total) && total <= cap,
          `A single order may not exceed ${formatMoney(cap, String(facts.currency))}; this one is ${formatMoney(total, String(facts.currency))}.`,
        );
      }
    } else if (request?.action_type === 'booking') {
      const shortlist = detail.shortlists.find((item) => item.generation === facts.generation);
      const offer = detail.offers.find((item) => item.generation === facts.generation && item.technician_id === facts.technician_id);
      check('the technician was shortlisted from the approved roster', shortlist?.selected.some((item) => item.technician_id === facts.technician_id) === true, `Technician ${String(facts.technician_id)} is not on the shortlist.`);
      check('the technician accepted this appointment', offer?.status === 'accepted' && offer.start_at === facts.start_at && Boolean(offer.acceptance_reference), 'No recorded acceptance matches this appointment.');
      const handoff = detail.parts_handoff;
      const exception = detail.exceptions.some((item) => item.exception === 'schedule_before_parts');
      check('the parts handoff was received', handoff !== null, 'No parts handoff was received in the room.');
      if (handoff?.parts_delivery_estimate && !exception) {
        check(
          'the appointment starts after the handed-over parts estimate',
          Date.parse(String(facts.start_at)) >= Date.parse(handoff.parts_delivery_estimate) + buffer,
          `The appointment starts ${String(facts.start_at)}, before the parts estimate ${handoff.parts_delivery_estimate} plus the buffer.`,
        );
      }
    } else if (request) {
      check('the action type is one the critic judges', false, `The critic does not judge ${request.action_type}.`);
    }

    const verdict = failures.length === 0 ? 'approved' : 'blocked';
    const reason = failures.length === 0 ? `All ${checks.length} checks passed.` : failures.join(' ');
    await think(tools, `Verdict on ${envelope.request_id}: ${verdict}.\n${checks.join('\n')}`, { request_id: envelope.request_id, verdict });
    await say(
      tools,
      [envelope.reply_to],
      verdict === 'approved' ? `APPROVED ${envelope.request_id}. ${reason}` : `BLOCKED ${envelope.request_id}. ${reason}`,
      { kind: 'verdict', job_id: envelope.job_id, requested_by: envelope.requested_by, request_id: envelope.request_id, verdict, reason, checks },
    );
  }

  /* -------------------------------- TechDispatcher -------------------------------- */

  async function dispatcher(message: RoomMessage, tools: RoomTools): Promise<void> {
    const envelope = decodeEnvelope(message.content);
    if (!envelope) return;
    const { job_id, requested_by } = envelope;
    if (envelope.kind === 'parts_handoff') {
      // The appointment is planned from the estimate in this message.
      await coordinateRepair(job_id, adapters, context, {
        stage: 'outreach',
        runtime: 'band',
        parts_delivery_estimate: envelope.parts_delivery_estimate,
        handoff_reference: `band:${message.roomId}:${message.id}`,
      });
    } else if (envelope.kind === 'verdict') {
      await recordVerdict(message, envelope);
      await coordinateRepair(job_id, adapters, context, { stage: 'outreach', runtime: 'band' });
    } else if (envelope.kind === 'stage_request' && envelope.stage === 'outreach') {
      await coordinateRepair(job_id, adapters, context, { stage: 'outreach', runtime: 'band' });
    } else {
      return;
    }

    const detail = await getJobDetail(job_id, context);
    if ((await askCritic(tools, detail, requested_by, 'booking')) > 0) return;
    const booking = detail.job.booking;

    if (detail.job.status === 'scheduled' && booking?.status === 'confirmed') {
      const key = `booked:${detail.generation}:${booking.technician_id}`;
      if (announced.has(key)) return;
      announced.add(key);
      const { missing } = await recruit(tools, ['ScheduleReporter']);
      if (missing.length > 0) {
        await say(tools, [nameOf('RepairCoordinator')], `The booking for job ${job_id} is confirmed but cannot be published.`, {
          kind: 'notice',
          job_id,
          requested_by,
          headline: 'The booking is confirmed but the reporter is not reachable',
          details: missing.map((item) => `${item} is not reachable in Band.`),
        });
        return;
      }
      await say(
        tools,
        [nameOf('ScheduleReporter')],
        `Job ${job_id} is booked with ${booking.technician_name} for ${booking.start_at}. Update the schedule and report.`,
        { kind: 'booking_handoff', job_id, requested_by, technician_name: booking.technician_name, start_at: booking.start_at, end_at: booking.end_at },
      );
      return;
    }

    const waiting = detail.offers.find((item) => item.generation === detail.generation && item.status === 'awaiting_response');
    if (waiting) {
      if (announced.has(waiting.offer_id)) return;
      announced.add(waiting.offer_id);
      const from = detail.parts_handoff?.parts_delivery_estimate;
      await say(tools, [nameOf('RepairCoordinator')], `I offered ${waiting.start_at} to ${waiting.technician_name} for job ${job_id}.`, {
        kind: 'notice',
        job_id,
        requested_by,
        headline: `Appointment offered to ${waiting.technician_name}`,
        details: [
          `Proposed: ${waiting.start_at} to ${waiting.end_at}.`,
          from ? `Planned after the parts estimate ${from} handed over by the parts specialist.` : 'No parts delivery had to be awaited.',
          `A reply is due by ${waiting.respond_by}.`,
        ],
      });
      return;
    }

    const issues = problems(detail);
    const key = `issues:${issues.join('|')}`;
    if (issues.length === 0 || announced.has(key)) return;
    announced.add(key);
    await say(tools, [nameOf('RepairCoordinator')], `I could not book a technician for job ${job_id}.`, {
      kind: 'notice',
      job_id,
      requested_by,
      headline: 'No appointment is booked',
      details: issues,
    });
  }

  /* ------------------------------- ScheduleReporter ------------------------------- */

  async function reporter(message: RoomMessage, tools: RoomTools): Promise<void> {
    const envelope = decodeEnvelope(message.content);
    if (!envelope) return;
    if (envelope.kind !== 'booking_handoff' && !(envelope.kind === 'stage_request' && envelope.stage === 'publication')) return;
    const { job_id, requested_by } = envelope;
    await coordinateRepair(job_id, adapters, context, { stage: 'publication', runtime: 'band' });
    const detail = await getJobDetail(job_id, context);
    const { job } = detail;
    const last = (type: string) => [...job.actions].reverse().find((item) => item.action_type === type);
    const sync = last('schedule_sync');
    const notice = last('manager_notify');
    const booking = job.booking;
    const details = [
      `Status: ${job.status}. Parts: ${job.parts_status}.`,
      booking && booking.status !== 'cancelled'
        ? `Technician: ${booking.technician_name}, ${booking.start_at} to ${booking.end_at} (${booking.status}).`
        : 'Technician: nobody is booked.',
      !sync
        ? 'Schedule workbook: no update was requested.'
        : sync.status === 'confirmed'
          ? `Schedule workbook: updated (${sync.mode}).`
          : `Schedule workbook: NOT updated, ${sync.status}. ${sync.detail}`,
      !notice
        ? 'Manager update: not sent.'
        : notice.status === 'confirmed'
          ? `Manager update: sent (${notice.mode}).`
          : `Manager update: NOT sent, ${notice.status}. ${notice.detail}`,
      ...problems(detail).map((item) => `Needs attention: ${item}`),
    ];
    const clean = sync?.status === 'confirmed' && notice?.status === 'confirmed' && problems(detail).length === 0;
    const headline = clean
      ? `Job ${job_id} is ${job.status} and published. Recommendation: no action is needed.`
      : `Job ${job_id} is ${job.status} but not everything was published. Recommendation: review the items below.`;
    await tools.sendMessage(
      encodeEnvelope([headline, ...details.map((item) => `- ${item}`)].join('\n'), {
        kind: 'report',
        job_id,
        requested_by,
        headline,
        details,
      }),
      [requested_by],
    );
  }

  const handlers: Record<BandRole, (message: RoomMessage, tools: RoomTools) => Promise<void>> = {
    RepairCoordinator: coordinator,
    PartsSourcer: sourcer,
    AuthorityCritic: critic,
    TechDispatcher: dispatcher,
    ScheduleReporter: reporter,
  };

  return async ({ message, tools }) => {
    try {
      await handlers[role](message, tools);
    } catch (error) {
      const text = error instanceof CoordinationError ? `${error.code}: ${error.message}` : error instanceof Error ? error.message : String(error);
      await tools.sendEvent(`${me} could not handle the message: ${text}`, 'error', { agent: me });
      const envelope = decodeEnvelope(message.content);
      const target = envelope?.requested_by ?? message.senderName;
      if (target) await tools.sendMessage(`${me} could not continue${envelope ? ` with job ${envelope.job_id}` : ''}: ${text}`, [target]);
    }
  };
}
