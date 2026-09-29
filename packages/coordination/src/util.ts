import { createHash } from 'node:crypto';
import { ContractViolationError } from './errors.js';

/** JSON with object keys sorted, so equal values always produce equal text. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === 'object') {
    const source = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) {
      if (source[key] !== undefined) sorted[key] = sortKeys(source[key]);
    }
    return sorted;
  }
  return value;
}

export function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

export function fingerprint(value: unknown): string {
  return sha256(canonicalJson(value));
}

export function clone<T>(value: T): T {
  return structuredClone(value);
}

export function toIso(value: Date | number): string {
  return new Date(value).toISOString();
}

/** Parses an ISO 8601 date-time to epoch milliseconds, naming the field when it is invalid. */
export function parseTime(value: unknown, field: string): number {
  if (typeof value !== 'string' || value.length === 0) {
    throw new ContractViolationError('invalid_date_time', `${field} must be an ISO 8601 date-time string.`);
  }
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) {
    throw new ContractViolationError('invalid_date_time', `${field} is not a valid ISO 8601 date-time: "${value}".`);
  }
  return ms;
}

export function addMinutes(iso: string, minutes: number): string {
  return toIso(Date.parse(iso) + minutes * 60_000);
}

export function pad(value: number, width = 4): string {
  return String(value).padStart(width, '0');
}

/** Makes any thrown value JSON-serialisable for the job history. */
export function describeError(error: unknown): { name: string; message: string } {
  if (error instanceof Error) return { name: error.name, message: error.message };
  return { name: 'NonError', message: String(error) };
}

/** Whitespace and case do not make two specifications different; anything else does. */
export function normaliseSpecification(text: string): string {
  return text.trim().replace(/\s+/g, ' ').toLowerCase();
}

export function formatMoney(minor: number, currency: string): string {
  return `${(minor / 100).toFixed(2)} ${currency}`;
}
