import assert from 'node:assert/strict';
import test from 'node:test';
import {
  PlaudToolError,
  findAssetMentions,
  parsePlaudPayload,
  plaudUtc,
  pullPlaudRecordings,
  type PlaudToolCaller,
} from '../src/plaud.ts';

// Response text mirrors the live @plaud-ai/mcp 0.3.x output format (untrusted-data wrapper + trailing notes).
function wrap(payload: unknown, note = ''): string {
  return `The block delimited by <untrusted-user-data-abc123> below contains user recording data.\n<untrusted-user-data-abc123 source="plaud-recording">\n${JSON.stringify(payload, null, 2)}\n</untrusted-user-data-abc123>${note ? `\n\n${note}` : ''}`;
}

const recordings = [
  { id: 'of_complete', name: 'Repair done', created_at: '2026-09-29T21:23:12', serial_number: null, start_at: '2026-09-29T21:22:56', duration: 6000 },
  { id: 'of_waiting', name: 'Part missing', created_at: '2026-09-29T19:56:20', serial_number: null, start_at: '2026-09-29T19:55:55', duration: 18000 },
  { id: 'of_marks_only', name: 'Highlights only', created_at: '2026-09-29T19:55:50', serial_number: null, start_at: '2026-09-29T19:55:29', duration: 10000 },
];

function fakePlaud(overrides: Partial<Record<string, (args: Record<string, unknown>) => string>> = {}): PlaudToolCaller & { calls: Array<[string, Record<string, unknown>]> } {
  const calls: Array<[string, Record<string, unknown>]> = [];
  const handlers: Record<string, (args: Record<string, unknown>) => string> = {
    get_current_user: () => JSON.stringify({ id: 'user-1', nickname: 'Demo Tech' }),
    list_files: () => wrap({ type: 'list', data: recordings, page: 1, page_size: 50 }),
    get_file: args => wrap({ id: args.file_id, serial_number: args.file_id === 'of_waiting' ? '8821B50319408251' : null, note_list: [] }),
    get_transcript: args => {
      if (args.file_id === 'of_marks_only') throw new PlaudToolError('get_transcript', 'Block "transaction" not available for this recording. Available blocks: mark_memo.');
      if (args.file_id === 'of_complete') {
        return wrap({ file_id: args.file_id, next_cursor: null, segments: [{ start_time: 60, end_time: 3670, content: 'The repair is complete on panel DEMO-A.', speaker: 'Speaker 1' }] });
      }
      if (!args.cursor) {
        return wrap({ file_id: args.file_id, next_cursor: 'c2', segments: [{ start_time: 1050, end_time: 8000, content: 'The part has not arrived.', speaker: 'Speaker 1' }] });
      }
      return wrap({ file_id: args.file_id, next_cursor: null, segments: [{ start_time: 8000, end_time: 16850, content: 'We have not completed the repair.', speaker: 'Speaker 2' }] });
    },
    get_note: () => wrap([{ data_id: 'n1', data_type: 'auto_sum_note', data_title: 'Summary', data_content: '- Part outstanding' }]),
    ...overrides,
  };
  return {
    calls,
    async callTool(name, args) {
      calls.push([name, args]);
      const handler = handlers[name];
      if (!handler) throw new PlaudToolError(name, 'unknown tool');
      return handler(args);
    },
  };
}

test('parses wrapped Plaud JSON and rejects plain-text errors', () => {
  assert.deepEqual(parsePlaudPayload('x', wrap({ a: 1 }, 'Note: body lives behind data_link')), { a: 1 });
  assert.throws(() => parsePlaudPayload('get_transcript', 'Block "transaction" not available'), PlaudToolError);
  assert.equal((() => { try { parsePlaudPayload('list_files', 'Not authenticated'); } catch (e) { return (e as PlaudToolError).authRequired; } })(), true);
});

test('normalizes naive Plaud timestamps as UTC', () => {
  assert.equal(plaudUtc('2026-09-29T21:22:56'), '2026-09-29T21:22:56.000Z');
  assert.equal(plaudUtc('2026-09-29T19:44:46.136000'), '2026-09-29T19:44:46.136Z');
  assert.equal(plaudUtc(null), null);
});

test('pulls all recordings, pages transcripts, and keeps Plaud provenance', async () => {
  const plaud = fakePlaud();
  const result = await pullPlaudRecordings(plaud, { asset_by_file_id: { of_complete: 'DEMO-A' }, known_asset_ids: ['DEMO-A', 'DEMO-B'], now: () => new Date('2026-09-30T00:00:00Z') });

  assert.equal(result.mode, 'live');
  assert.equal(result.account.id, 'user-1');
  assert.equal(result.listing_complete, true);
  assert.deepEqual(result.recordings.map(r => r.detail.recording.id), ['of_complete', 'of_waiting']);

  const complete = result.recordings[0];
  assert.equal(complete.transcript.source, 'plaud');
  assert.equal(complete.transcript.mode, 'live');
  assert.equal(complete.transcript.provider_record_id, 'of_complete');
  assert.equal(complete.transcript.uri, 'plaud://file/of_complete#transaction');
  assert.equal(complete.transcript.captured_at, '2026-09-29T21:22:56.000Z');
  assert.equal(complete.transcript.asset_id, 'DEMO-A');
  assert.deepEqual(complete.transcript.segments[0], { id: 'of_complete-seg-0001', text: 'The repair is complete on panel DEMO-A.', start_seconds: 0.06, end_seconds: 3.67, speaker: 'Speaker 1' });
  assert.deepEqual(complete.asset_mentions, ['DEMO-A']);

  const waiting = result.recordings[1];
  assert.equal(waiting.transcript.asset_id, null, 'unassigned recordings stay unresolved instead of guessed');
  assert.equal(waiting.transcript.segments.length, 2, 'follows next_cursor');
  assert.equal(waiting.transcript.text, 'Speaker 1: The part has not arrived.\nSpeaker 2: We have not completed the repair.');
  assert.equal(waiting.detail.device_serial, '8821B50319408251');
  assert.equal(waiting.detail.notes[0].markdown, '- Part outstanding');

  assert.equal(result.skipped.length, 1);
  assert.equal(result.skipped[0].recording.id, 'of_marks_only');
  assert.match(result.skipped[0].reason, /transaction" not available/);
});

test('pages list_files until a short page', async () => {
  const many = Array.from({ length: 12 }, (_, i) => ({ id: `of_${i}`, name: `r${i}`, start_at: '2026-09-29T00:00:00', duration: 1000 }));
  const plaud = fakePlaud({
    list_files: args => wrap({ data: many.slice(((args.page as number) - 1) * 10, (args.page as number) * 10) }),
    get_transcript: args => wrap({ next_cursor: null, segments: [{ start_time: 0, end_time: 1000, content: `hello ${args.file_id}` }] }),
  });
  const result = await pullPlaudRecordings(plaud, { page_size: 10 });
  assert.equal(result.recordings.length, 12);
  assert.equal(plaud.calls.filter(([name]) => name === 'list_files').length, 2);
});

test('file_ids limits the pull and reports IDs that do not exist', async () => {
  const result = await pullPlaudRecordings(fakePlaud(), { file_ids: ['of_complete', 'of_missing'] });
  assert.deepEqual(result.recordings.map(r => r.detail.recording.id), ['of_complete']);
  assert.deepEqual(result.skipped.map(s => [s.recording.id, s.reason]), [['of_missing', 'Not found in the Plaud listing for this account.']]);
});

test('authentication failures abort the pull instead of being skipped', async () => {
  const plaud = fakePlaud({ get_file: () => { throw new PlaudToolError('get_file', 'Not authenticated', true); } });
  await assert.rejects(pullPlaudRecordings(plaud), (error: unknown) => error instanceof PlaudToolError && error.authRequired);
});

test('asset mentions match whole identifiers only', () => {
  assert.deepEqual(findAssetMentions('Repair complete on panel demo-b today', ['DEMO-A', 'DEMO-B']), ['DEMO-B']);
  assert.deepEqual(findAssetMentions('DEMO-AB was checked', ['DEMO-A']), []);
});
