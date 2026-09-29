/**
 * Simulated adapters. Nothing here contacts a supplier, a technician or a workbook.
 * Every outcome is labelled SIMULATED and deduplicated on the idempotency key.
 */
import type { ActionReceipt } from '../contract.js';
import type {
  AdapterOutcome,
  Clock,
  CommunicationAdapter,
  OrderRequest,
  OutboundMessage,
  QuoteRequest,
  ScheduleAdapter,
  ScheduleRow,
  ScheduleSyncRequest,
  SupplierAdapter,
  Technician,
  TechnicianRoster,
} from '../types.js';
import { toIso } from '../util.js';

export interface SimulatedCatalogEntry {
  unit_price_minor: number;
  currency: string;
  quantity_available: number;
  lead_time_hours: number;
  /** Set these to make the supplier propose a substitution instead of the approved part. */
  offered_part_id?: string;
  offered_specification?: string;
}

export interface SimulatedSupplierOptions {
  supplier_id: string;
  name: string;
  clock: Clock;
  catalog: Record<string, SimulatedCatalogEntry>;
  /** What the supplier answers to an order. Defaults to `confirmed`. */
  order_outcome?: 'confirmed' | 'pending' | 'failed';
}

export interface SimulatedSupplier extends SupplierAdapter {
  /** Requests that reached the supplier. A deduplicated repeat is not counted again. */
  readonly quote_requests: QuoteRequest[];
  readonly order_requests: OrderRequest[];
}

export function createSimulatedSupplier(options: SimulatedSupplierOptions): SimulatedSupplier {
  const quotes = new Map<string, Awaited<ReturnType<SupplierAdapter['requestQuote']>>>();
  const orders = new Map<string, Awaited<ReturnType<SupplierAdapter['placeOrder']>>>();
  const quote_requests: QuoteRequest[] = [];
  const order_requests: OrderRequest[] = [];
  const deliveryFor = (part_id: string) => {
    const item = options.catalog[part_id];
    return item ? toIso(options.clock.now().getTime() + item.lead_time_hours * 3_600_000) : null;
  };

  return {
    supplier_id: options.supplier_id,
    name: options.name,
    mode: 'simulated',
    deduplicates_by_key: true,
    quote_requests,
    order_requests,
    async requestQuote(request) {
      const known = quotes.get(request.idempotency_key);
      if (known) return known;
      quote_requests.push(request);
      const item = options.catalog[request.part_id];
      const reference = `SIM-${options.supplier_id}-Q-${String(quote_requests.length).padStart(4, '0')}`;
      const outcome = item
        ? {
            status: 'confirmed' as const,
            provider_reference: reference,
            detail: `SIMULATED quote from ${options.name} for ${request.part_id}.`,
            quote: {
              offered_part_id: item.offered_part_id ?? request.part_id,
              offered_specification: item.offered_specification ?? request.approved_specification,
              quantity_available: item.quantity_available,
              unit_price_minor: item.unit_price_minor,
              currency: item.currency,
              estimated_delivery_at: deliveryFor(request.part_id),
              valid_until: toIso(options.clock.now().getTime() + 24 * 3_600_000),
            },
            raw: { simulated: true, supplier_id: options.supplier_id, reference, request },
          }
        : {
            status: 'confirmed' as const,
            provider_reference: reference,
            detail: `SIMULATED reply from ${options.name}: ${request.part_id} is not in the catalogue.`,
            quote: null,
            raw: { simulated: true, supplier_id: options.supplier_id, reference, request, available: false },
          };
      quotes.set(request.idempotency_key, outcome);
      return outcome;
    },
    async placeOrder(request) {
      const known = orders.get(request.idempotency_key);
      if (known) return known;
      order_requests.push(request);
      const status = options.order_outcome ?? 'confirmed';
      const reference = `SIM-${options.supplier_id}-O-${String(order_requests.length).padStart(4, '0')}`;
      const outcome = {
        status,
        provider_reference: status === 'failed' ? null : reference,
        detail:
          status === 'failed'
            ? `SIMULATED refusal from ${options.name}. No purchase was made.`
            : `SIMULATED order at ${options.name}, ${status}. No real purchase was made.`,
        estimated_delivery_at: status === 'failed' ? null : deliveryFor(request.part_id),
        raw: { simulated: true, supplier_id: options.supplier_id, reference, request, status },
      };
      orders.set(request.idempotency_key, outcome);
      return outcome;
    },
  };
}

export function createSimulatedRoster(technicians: Technician[]): TechnicianRoster {
  return {
    mode: 'simulated',
    async listTechnicians() {
      return structuredClone(technicians);
    },
  };
}

export interface SimulatedCommunication extends CommunicationAdapter {
  /** Messages that were sent. A deduplicated repeat is not added again. */
  readonly outbox: OutboundMessage[];
}

export function createSimulatedCommunication(
  options: { fail?: (message: OutboundMessage) => string | null } = {},
): SimulatedCommunication {
  const sent = new Map<string, AdapterOutcome>();
  const outbox: OutboundMessage[] = [];
  return {
    channel: 'simulated',
    mode: 'simulated',
    deduplicates_by_key: true,
    outbox,
    async send(message) {
      const known = sent.get(message.idempotency_key);
      if (known) return known;
      const failure = options.fail?.(message) ?? null;
      let outcome: AdapterOutcome;
      if (failure) {
        outcome = {
          status: 'failed',
          provider_reference: null,
          detail: `SIMULATED send failure: ${failure}`,
          raw: { simulated: true, failure },
        };
      } else {
        outbox.push(message);
        const reference = `SIM-MSG-${String(outbox.length).padStart(4, '0')}`;
        outcome = {
          status: 'confirmed',
          provider_reference: reference,
          detail: `SIMULATED message to ${message.recipient.name} (${message.recipient.role}). Nobody was contacted.`,
          raw: { simulated: true, reference, recipient: message.recipient, subject: message.subject },
        };
      }
      sent.set(message.idempotency_key, outcome);
      return outcome;
    },
  };
}

export interface SimulatedSchedule extends ScheduleAdapter {
  /** Requests that reached the adapter, including failed ones. */
  readonly requests: ScheduleSyncRequest[];
  /** The rows as the stand-in holds them, keyed by job id. */
  readonly rows: Map<string, ScheduleRow>;
}

/**
 * Stand-in for Zubair's Excel adapter so the coordinator can run before it is merged.
 * It writes no workbook. `fail_first` makes the first calls fail to exercise the retry path.
 */
export function createSimulatedSchedule(options: { clock: Clock; fail_first?: number }): SimulatedSchedule {
  const requests: ScheduleSyncRequest[] = [];
  const rows = new Map<string, ScheduleRow>();
  const done = new Map<string, ActionReceipt>();
  let failures = options.fail_first ?? 0;
  return {
    mode: 'simulated',
    deduplicates_by_key: true,
    requests,
    rows,
    async syncSchedule(request) {
      const known = done.get(request.idempotency_key);
      if (known) return known;
      requests.push(request);
      const base = {
        action_id: `SIM-SCHEDULE-${String(requests.length).padStart(4, '0')}`,
        job_id: request.job_id,
        action_type: 'schedule_sync' as const,
        idempotency_key: request.idempotency_key,
        mode: 'simulated' as const,
        evidence_ids: [],
        recorded_at: toIso(options.clock.now()),
      };
      if (failures > 0) {
        failures -= 1;
        return {
          ...base,
          status: 'failed',
          provider_reference: null,
          detail: 'SIMULATED workbook write failure. No workbook was changed.',
        };
      }
      rows.set(request.job_id, request.row);
      const receipt: ActionReceipt = {
        ...base,
        status: 'confirmed',
        provider_reference: `SIM-ROW-${request.job_id}`,
        detail: `SIMULATED schedule stand-in stored the row for ${request.job_id} (${request.reason}). No real workbook was changed.`,
      };
      done.set(request.idempotency_key, receipt);
      return receipt;
    },
  };
}
