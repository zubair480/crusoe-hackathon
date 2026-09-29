import type { Part, PartsStatus } from './contract.js';
import type {
  CoordinationConfig,
  JobRecord,
  JobRequirements,
  PartSourcing,
  Quote,
  QuoteClassification,
  QuoteRecord,
  ShortlistEntry,
  ShortlistRecord,
  Technician,
} from './types.js';
import { normaliseSpecification, toIso } from './util.js';

/** Sourcing entries that belong to the approved version of the recommendation. */
export function activeSourcing(record: JobRecord): PartSourcing[] {
  return record.sourcing.filter(
    (entry) => entry.recommendation_version === record.job.recommendation_version && entry.status !== 'superseded',
  );
}

/**
 * Only an exact match can be ordered. A different part id or specification is a
 * substitution and goes back to the reviewer; the coordinator never judges equivalence.
 */
export function classifyQuote(part: Part, quote: Quote | null, currency: string): QuoteClassification {
  if (!quote) return 'unavailable';
  if (
    quote.offered_part_id !== part.part_id ||
    normaliseSpecification(quote.offered_specification) !== normaliseSpecification(part.approved_specification)
  ) {
    return 'substitution';
  }
  if (quote.currency !== currency) return 'currency_mismatch';
  if (quote.quantity_available < part.quantity) return 'insufficient_quantity';
  return 'match';
}

/** Earliest delivery first, then lowest price, then supplier id so the choice is stable. */
export function rankQuotes(quotes: QuoteRecord[]): QuoteRecord[] {
  const deliveryOf = (record: QuoteRecord) =>
    record.quote?.estimated_delivery_at ? Date.parse(record.quote.estimated_delivery_at) : Number.MAX_SAFE_INTEGER;
  return quotes
    .filter((record) => record.classification === 'match' && record.quote !== null)
    .sort(
      (a, b) =>
        deliveryOf(a) - deliveryOf(b) ||
        a.quote!.unit_price_minor - b.quote!.unit_price_minor ||
        a.supplier_id.localeCompare(b.supplier_id),
    );
}

export function computePartsStatus(record: JobRecord): PartsStatus {
  if (record.approved_scope.parts.length === 0) return 'not_required';
  const entries = activeSourcing(record);
  if (entries.some((entry) => entry.status === 'delayed')) return 'delayed';
  const complete = entries.length === record.approved_scope.parts.length;
  if (complete && entries.every((entry) => entry.status === 'delivered')) return 'available';
  if (complete && entries.every((entry) => entry.status === 'ordered' || entry.status === 'delivered')) {
    return 'ordered';
  }
  return 'not_ordered';
}

/** Money already committed to orders that were not refused. Superseded orders still count. */
export function committedSpendMinor(record: JobRecord): number {
  return record.sourcing.reduce((total, entry) => {
    const order = entry.order;
    if (!order || order.purchase_outcome === 'failed' || order.purchase_outcome === 'rejected') return total;
    return total + order.total_minor;
  }, 0);
}

export interface PartsPlan {
  /** True when every part is ordered with a delivery estimate, delivered, or not needed. */
  plannable: boolean;
  /** Latest delivery estimate among parts still to arrive, or null when nothing is awaited. */
  latest_delivery_at: string | null;
  reason: string;
}

export function planParts(record: JobRecord): PartsPlan {
  if (record.approved_scope.parts.length === 0) {
    return { plannable: true, latest_delivery_at: null, reason: 'No parts are required.' };
  }
  const entries = activeSourcing(record);
  if (entries.length < record.approved_scope.parts.length) {
    return { plannable: false, latest_delivery_at: null, reason: 'Not every approved part has been sourced.' };
  }
  let latest: number | null = null;
  for (const entry of entries) {
    if (entry.status === 'delivered') continue;
    const estimate = entry.order?.estimated_delivery_at ?? null;
    if ((entry.status !== 'ordered' && entry.status !== 'delayed') || !estimate) {
      return {
        plannable: false,
        latest_delivery_at: null,
        reason: `Part ${entry.part_id} is ${entry.status} and has no delivery estimate.`,
      };
    }
    latest = Math.max(latest ?? 0, Date.parse(estimate));
  }
  return {
    plannable: true,
    latest_delivery_at: latest === null ? null : toIso(latest),
    reason: latest === null ? 'All parts are delivered.' : 'All parts are ordered with a delivery estimate.',
  };
}

/** Whether the parts situation supports an appointment starting at `start_at`. */
export function partsSupportAppointment(
  record: JobRecord,
  start_at: string,
  config: CoordinationConfig,
): { supported: boolean; reason: string } {
  const exception = record.exceptions.find((item) => item.exception === 'schedule_before_parts');
  if (exception) {
    return { supported: true, reason: `Exception approved by ${exception.approved_by}: ${exception.reason}` };
  }
  if (record.approved_scope.parts.length === 0) return { supported: true, reason: 'No parts are required.' };
  const entries = activeSourcing(record);
  if (entries.length < record.approved_scope.parts.length) {
    return { supported: false, reason: 'Not every approved part has been sourced.' };
  }
  const start = Date.parse(start_at);
  for (const entry of entries) {
    if (entry.status === 'delivered') continue;
    const order = entry.order;
    if ((entry.status !== 'ordered' && entry.status !== 'delayed') || !order) {
      return { supported: false, reason: `Part ${entry.part_id} is ${entry.status}.` };
    }
    if (order.purchase_outcome !== 'confirmed') {
      return {
        supported: false,
        reason: `The order for part ${entry.part_id} is ${order.purchase_outcome}, not confirmed by the supplier.`,
      };
    }
    if (!order.estimated_delivery_at) {
      return { supported: false, reason: `Part ${entry.part_id} has no delivery estimate.` };
    }
    if (Date.parse(order.estimated_delivery_at) + config.parts_buffer_minutes * 60_000 > start) {
      return {
        supported: false,
        reason: `Part ${entry.part_id} is estimated for ${order.estimated_delivery_at}, too late for a ${start_at} start.`,
      };
    }
  }
  return { supported: true, reason: 'Every part is delivered or confirmed to arrive before the appointment.' };
}

export interface ShortlistInput {
  generation: number;
  site_id: string;
  requirements: JobRequirements;
  earliest_start_ms: number;
  latest_end_ms: number;
  excluded_technician_ids: string[];
  shortlist_size: number;
  built_at: string;
}

/**
 * Ranks the customer's roster for one booking round using only supplied facts:
 * qualifications, approved sites, availability and distance.
 */
export function buildShortlist(technicians: Technician[], input: ShortlistInput): ShortlistRecord {
  const required = input.requirements.required_qualifications.map((item) => item.trim().toLowerCase());
  const durationMs = input.requirements.duration_minutes * 60_000;
  const excluded: ShortlistRecord['excluded'] = [];
  const feasible: ShortlistEntry[] = [];

  for (const technician of technicians) {
    const reject = (reason: string) => excluded.push({ technician_id: technician.technician_id, reason });
    if (!technician.active) {
      reject('Not active on the roster.');
      continue;
    }
    if (input.excluded_technician_ids.includes(technician.technician_id)) {
      reject('Excluded for this job after a cancellation.');
      continue;
    }
    const held = technician.qualifications.map((item) => item.trim().toLowerCase());
    const missing = required.filter((item) => !held.includes(item));
    if (missing.length > 0) {
      reject(`Missing qualification: ${missing.join(', ')}.`);
      continue;
    }
    if (!technician.site_ids.includes('*') && !technician.site_ids.includes(input.site_id)) {
      reject(`Not approved for site ${input.site_id}.`);
      continue;
    }
    if (!technician.contact?.address) {
      reject('No contact address on the roster.');
      continue;
    }
    let slotStart: number | null = null;
    const windows = [...technician.availability].sort((a, b) => Date.parse(a.start_at) - Date.parse(b.start_at));
    for (const window of windows) {
      const start = Math.max(Date.parse(window.start_at), input.earliest_start_ms);
      const end = Math.min(Date.parse(window.end_at), input.latest_end_ms);
      if (Number.isFinite(start) && Number.isFinite(end) && start + durationMs <= end) {
        slotStart = start;
        break;
      }
    }
    if (slotStart === null) {
      reject('No availability long enough inside the scheduling window.');
      continue;
    }
    feasible.push({
      technician_id: technician.technician_id,
      technician_name: technician.name,
      rank: 0,
      start_at: toIso(slotStart),
      end_at: toIso(slotStart + durationMs),
      distance_km: typeof technician.distance_km === 'number' ? technician.distance_km : null,
    });
  }

  feasible.sort(
    (a, b) =>
      Date.parse(a.start_at) - Date.parse(b.start_at) ||
      (a.distance_km ?? Number.MAX_SAFE_INTEGER) - (b.distance_km ?? Number.MAX_SAFE_INTEGER) ||
      a.technician_id.localeCompare(b.technician_id),
  );
  const selected = feasible.slice(0, input.shortlist_size).map((entry, index) => ({ ...entry, rank: index + 1 }));
  for (const entry of feasible.slice(input.shortlist_size)) {
    excluded.push({ technician_id: entry.technician_id, reason: 'Ranked below the shortlist size.' });
  }
  return {
    generation: input.generation,
    built_at: input.built_at,
    earliest_start_at: toIso(input.earliest_start_ms),
    latest_end_at: toIso(input.latest_end_ms),
    required_qualifications: input.requirements.required_qualifications,
    selected,
    excluded,
  };
}
