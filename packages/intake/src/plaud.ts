// Plaud MCP intake adapter.
//
// Pulls recordings, timestamped speaker transcripts and Plaud notes through the
// official Plaud MCP server (`@plaud-ai/mcp`, tools list_files / get_file /
// get_transcript / get_note) and maps each transcript to the TranscriptInput
// shape accepted by createInspectionPackage / collectCompletionEvidence.
//
// Nothing here invents Plaud data: a recording without a transcript is reported
// as skipped with Plaud's own reason, and asset association is never guessed.

export interface PlaudToolCaller {
  /** Calls one Plaud MCP tool and returns the concatenated text content. Throws PlaudToolError when the tool reports an error. */
  callTool(name: string, args: Record<string, unknown>): Promise<string>;
}

export interface PlaudMcpSession extends PlaudToolCaller {
  close(): Promise<void>;
}

export class PlaudToolError extends Error {
  readonly tool: string;
  readonly authRequired: boolean;

  constructor(tool: string, message: string, authRequired = false) {
    super(`Plaud ${tool}: ${message}`);
    this.name = 'PlaudToolError';
    this.tool = tool;
    this.authRequired = authRequired;
  }
}

export interface PlaudRecording {
  id: string;
  name: string;
  /** UTC ISO timestamp with Z suffix, or null when Plaud does not provide one. */
  start_at: string | null;
  created_at: string | null;
  duration_ms: number | null;
  serial_number: string | null;
}

export interface PlaudSegment {
  id: string;
  text: string;
  start_seconds: number;
  end_seconds: number;
  speaker?: string;
}

export interface PlaudNote {
  id: string;
  type: string;
  title: string;
  markdown: string;
}

export interface PlaudRecordingDetail {
  recording: PlaudRecording;
  /** Device serial when recorded on a Plaud device; null for app/imported audio. */
  device_serial: string | null;
  transcript_block: 'transaction';
  segments: PlaudSegment[];
  notes: PlaudNote[];
}

/** Structurally identical to TranscriptInput in ./index.ts. */
export interface PlaudTranscriptInput {
  text: string;
  uri: string;
  source: 'plaud';
  mode: 'live';
  asset_id: string | null;
  captured_at: string | null;
  provider_record_id: string;
  segments: Array<{ id: string; text: string; start_seconds: number; end_seconds: number; speaker?: string }>;
}

export interface PlaudPulledRecording {
  detail: PlaudRecordingDetail;
  transcript: PlaudTranscriptInput;
  /** Known asset IDs spoken in the transcript. Advisory only — never assigned automatically. */
  asset_mentions: string[];
}

export interface PlaudSkippedRecording {
  recording: PlaudRecording;
  reason: string;
}

export interface PlaudPullResult {
  mode: 'live';
  pulled_at: string;
  account: { id: string | null; nickname: string | null };
  listing_complete: boolean;
  recordings: PlaudPulledRecording[];
  skipped: PlaudSkippedRecording[];
}

export interface ListPlaudRecordingsOptions {
  query?: string;
  date_from?: string;
  date_to?: string;
  page_size?: number;
  max_pages?: number;
}

export interface PullPlaudOptions extends ListPlaudRecordingsOptions {
  /** Only these Plaud file IDs (after listing/filtering). */
  file_ids?: string[];
  /** Asset per Plaud file ID, supplied by the operator. Unlisted recordings keep asset_id null for review. */
  asset_by_file_id?: Record<string, string>;
  /** Asset IDs to look for in transcript text, e.g. ['DEMO-A', 'DEMO-B']. */
  known_asset_ids?: string[];
  now?: () => Date;
}

export interface ConnectPlaudMcpOptions {
  command?: string;
  args?: string[];
  env?: Record<string, string>;
}

/** Spawns the local Plaud MCP server over stdio. It reuses the OAuth session stored by `@plaud-ai/mcp` login. */
export async function connectPlaudMcp(options: ConnectPlaudMcpOptions = {}): Promise<PlaudMcpSession> {
  const [{ Client }, { StdioClientTransport, getDefaultEnvironment }] = await Promise.all([
    import('@modelcontextprotocol/sdk/client/index.js'),
    import('@modelcontextprotocol/sdk/client/stdio.js'),
  ]);
  const command = options.command ?? process.env.PLAUD_MCP_COMMAND ?? 'npx';
  const args = options.args ?? (process.env.PLAUD_MCP_ARGS ? process.env.PLAUD_MCP_ARGS.split(' ').filter(Boolean) : ['-y', '@plaud-ai/mcp']);
  const transport = new StdioClientTransport({ command, args, env: { ...getDefaultEnvironment(), ...options.env }, stderr: 'ignore' });
  const client = new Client({ name: 'thermaldesk-intake', version: '0.1.0' });
  await client.connect(transport);
  return {
    async callTool(name, toolArgs) {
      const result = await client.callTool({ name, arguments: toolArgs });
      const content = Array.isArray(result.content) ? result.content : [];
      const text = content.map(item => (item && typeof item === 'object' && 'text' in item ? String(item.text) : '')).join('\n');
      if (result.isError) throw new PlaudToolError(name, text || 'tool returned an error', isAuthMessage(text));
      return text;
    },
    close: () => client.close(),
  };
}

function isAuthMessage(text: string): boolean {
  return /not authenticated|401|unauthori[sz]ed|login/i.test(text);
}

/** Extracts the JSON payload from a Plaud MCP text response (which may wrap it in an untrusted-data block and append notes). */
export function parsePlaudPayload(tool: string, text: string): unknown {
  const wrapped = /<(untrusted-user-data-[\w-]+)[^>]*>([\s\S]*?)<\/\1>/.exec(text);
  const body = (wrapped ? wrapped[2] : text).trim();
  const start = body.search(/[[{]/);
  if (start >= 0) {
    try {
      return JSON.parse(body.slice(start));
    } catch {
      // fall through to the error below
    }
  }
  throw new PlaudToolError(tool, body.slice(0, 300) || 'empty response', isAuthMessage(body));
}

async function callJson(caller: PlaudToolCaller, tool: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const payload = parsePlaudPayload(tool, await caller.callTool(tool, args));
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new PlaudToolError(tool, 'unexpected response shape');
  return payload as Record<string, unknown>;
}

/** Plaud returns naive timestamps in UTC (e.g. "2026-09-29T21:22:56"); normalize to ISO-8601 with Z. */
export function plaudUtc(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const hasZone = /(Z|[+-]\d\d:?\d\d)$/i.test(value);
  const date = new Date(hasZone ? value : `${value}Z`);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function toRecording(raw: Record<string, unknown>): PlaudRecording {
  if (typeof raw.id !== 'string' || !raw.id) throw new PlaudToolError('list_files', 'recording without id');
  return {
    id: raw.id,
    name: typeof raw.name === 'string' ? raw.name : raw.id,
    start_at: plaudUtc(raw.start_at),
    created_at: plaudUtc(raw.created_at),
    duration_ms: typeof raw.duration === 'number' ? raw.duration : null,
    serial_number: typeof raw.serial_number === 'string' ? raw.serial_number : null,
  };
}

export async function getPlaudAccount(caller: PlaudToolCaller): Promise<PlaudPullResult['account']> {
  const user = await callJson(caller, 'get_current_user', {});
  return {
    id: typeof user.id === 'string' ? user.id : null,
    nickname: typeof user.nickname === 'string' ? user.nickname : null,
  };
}

export async function listPlaudRecordings(caller: PlaudToolCaller, options: ListPlaudRecordingsOptions = {}): Promise<{ recordings: PlaudRecording[]; complete: boolean }> {
  const filtered = Boolean(options.query || options.date_from || options.date_to);
  const pageSize = Math.max(10, options.page_size ?? 50);
  const maxPages = options.max_pages ?? 100;
  const seen = new Map<string, PlaudRecording>();
  let complete = true;
  for (let page = 1; page <= maxPages; page += 1) {
    const args: Record<string, unknown> = filtered
      ? { ...(options.query ? { query: options.query } : {}), ...(options.date_from ? { date_from: options.date_from } : {}), ...(options.date_to ? { date_to: options.date_to } : {}) }
      : { page, page_size: pageSize };
    const payload = await callJson(caller, 'list_files', args);
    const data = Array.isArray(payload.data) ? payload.data : [];
    for (const item of data) {
      if (item && typeof item === 'object') {
        const recording = toRecording(item as Record<string, unknown>);
        seen.set(recording.id, recording);
      }
    }
    if (filtered) {
      complete = payload.complete !== false;
      break;
    }
    if (data.length < pageSize) break;
    if (page === maxPages) complete = false;
  }
  return { recordings: [...seen.values()], complete };
}

export async function fetchPlaudRecording(caller: PlaudToolCaller, recording: PlaudRecording): Promise<PlaudRecordingDetail> {
  const file = await callJson(caller, 'get_file', { file_id: recording.id });
  const segments: PlaudSegment[] = [];
  let cursor: string | undefined;
  do {
    const page = await callJson(caller, 'get_transcript', { file_id: recording.id, block: 'transaction', limit: 500, ...(cursor ? { cursor } : {}) });
    const items = Array.isArray(page.segments) ? page.segments : [];
    for (const raw of items) {
      const item = raw as Record<string, unknown>;
      const text = typeof item.content === 'string' ? item.content : '';
      const start = typeof item.start_time === 'number' ? item.start_time / 1000 : 0;
      const end = typeof item.end_time === 'number' ? item.end_time / 1000 : start;
      segments.push({
        id: `${recording.id}-seg-${String(segments.length + 1).padStart(4, '0')}`,
        text,
        start_seconds: start,
        end_seconds: end,
        ...(typeof item.speaker === 'string' && item.speaker ? { speaker: item.speaker } : {}),
      });
    }
    cursor = typeof page.next_cursor === 'string' && page.next_cursor ? page.next_cursor : undefined;
  } while (cursor);

  let notes: PlaudNote[] = [];
  try {
    const noteText = await caller.callTool('get_note', { file_id: recording.id });
    notes = parseNotes(noteText, file);
  } catch (error) {
    if (error instanceof PlaudToolError && error.authRequired) throw error;
    notes = parseNotes('', file);
  }

  return {
    recording: { ...recording, serial_number: typeof file.serial_number === 'string' ? file.serial_number : recording.serial_number },
    device_serial: typeof file.serial_number === 'string' ? file.serial_number : null,
    transcript_block: 'transaction',
    segments,
    notes,
  };
}

function parseNotes(noteText: string, file: Record<string, unknown>): PlaudNote[] {
  let list: unknown[] = [];
  try {
    const payload = noteText ? parsePlaudPayload('get_note', noteText) : null;
    if (Array.isArray(payload)) list = payload;
    else if (payload && typeof payload === 'object') {
      const record = payload as Record<string, unknown>;
      list = Array.isArray(record.notes) ? record.notes : Array.isArray(record.note_list) ? record.note_list : Array.isArray(record.data) ? record.data : [];
    }
  } catch {
    list = [];
  }
  if (!list.length && Array.isArray(file.note_list)) list = file.note_list;
  return list.flatMap(raw => {
    const item = raw as Record<string, unknown>;
    const markdown = [item.data_content, item.content, item.markdown].find(value => typeof value === 'string' && value.trim());
    if (typeof markdown !== 'string') return [];
    return [{
      id: String(item.data_id ?? item.id ?? ''),
      type: String(item.data_type ?? item.type ?? 'note'),
      title: String(item.data_title ?? item.data_tab_name ?? item.title ?? ''),
      markdown,
    }];
  });
}

export function plaudTranscriptInput(detail: PlaudRecordingDetail, asset_id: string | null): PlaudTranscriptInput {
  const text = detail.segments.map(segment => (segment.speaker ? `${segment.speaker}: ${segment.text}` : segment.text)).join('\n').trim();
  if (!text) throw new PlaudToolError('get_transcript', `recording ${detail.recording.id} has an empty transcript`);
  return {
    text,
    uri: `plaud://file/${detail.recording.id}#transaction`,
    source: 'plaud',
    mode: 'live',
    asset_id,
    captured_at: detail.recording.start_at,
    provider_record_id: detail.recording.id,
    segments: detail.segments.map(segment => ({ ...segment })),
  };
}

export function findAssetMentions(text: string, knownAssetIds: string[]): string[] {
  const normalized = text.toUpperCase().replace(/[^A-Z0-9]+/g, ' ');
  return knownAssetIds.filter(assetId => {
    const needle = assetId.toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();
    return needle && ` ${normalized} `.includes(` ${needle} `);
  });
}

/** Pulls every accessible Plaud recording (or a filtered subset) into normalized, contract-ready transcripts. */
export async function pullPlaudRecordings(caller: PlaudToolCaller, options: PullPlaudOptions = {}): Promise<PlaudPullResult> {
  const account = await getPlaudAccount(caller);
  const listing = await listPlaudRecordings(caller, options);
  const wanted = options.file_ids ? new Set(options.file_ids) : null;
  const recordings: PlaudPulledRecording[] = [];
  const skipped: PlaudSkippedRecording[] = [];
  for (const recording of listing.recordings) {
    if (wanted && !wanted.has(recording.id)) continue;
    try {
      const detail = await fetchPlaudRecording(caller, recording);
      if (!detail.segments.some(segment => segment.text.trim())) {
        skipped.push({ recording: detail.recording, reason: 'Plaud returned no transcript text for this recording.' });
        continue;
      }
      const transcript = plaudTranscriptInput(detail, options.asset_by_file_id?.[recording.id] ?? null);
      recordings.push({ detail, transcript, asset_mentions: findAssetMentions(transcript.text, options.known_asset_ids ?? []) });
    } catch (error) {
      if (error instanceof PlaudToolError && error.authRequired) throw error;
      skipped.push({ recording, reason: error instanceof Error ? error.message : String(error) });
    }
  }
  if (wanted) {
    for (const id of wanted) {
      if (!listing.recordings.some(recording => recording.id === id)) {
        skipped.push({ recording: { id, name: id, start_at: null, created_at: null, duration_ms: null, serial_number: null }, reason: 'Not found in the Plaud listing for this account.' });
      }
    }
  }
  return {
    mode: 'live',
    pulled_at: (options.now?.() ?? new Date()).toISOString(),
    account,
    listing_complete: listing.complete,
    recordings,
    skipped,
  };
}
