import type { Clock } from './types.js';

export const systemClock: Clock = { now: () => new Date() };

export interface TestClock extends Clock {
  set(iso: string): void;
  advanceMinutes(minutes: number): void;
  advanceHours(hours: number): void;
}

/** A controlled clock for tests and the demo, so follow-ups do not need real waiting. */
export function createTestClock(startIso: string): TestClock {
  let current = Date.parse(startIso);
  if (Number.isNaN(current)) {
    throw new RangeError(`createTestClock: "${startIso}" is not a valid ISO 8601 date-time.`);
  }
  return {
    now: () => new Date(current),
    set(iso: string) {
      const next = Date.parse(iso);
      if (Number.isNaN(next)) {
        throw new RangeError(`TestClock.set: "${iso}" is not a valid ISO 8601 date-time.`);
      }
      current = next;
    },
    advanceMinutes(minutes: number) {
      current += minutes * 60_000;
    },
    advanceHours(hours: number) {
      current += hours * 3_600_000;
    },
  };
}
