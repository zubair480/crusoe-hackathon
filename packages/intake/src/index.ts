import { randomUUID } from 'node:crypto';
import { assertContract, type CompletionEvidence, type Evidence, type InspectionPackage } from '@thermaldesk/contracts';

export interface TranscriptInput {
  text: string;
  uri: string;
  source: 'plaud' | 'import' | 'synthetic';
  mode: 'live' | 'simulated';
  asset_id: string | null;
  captured_at?: string | null;
  provider_record_id?: string;
  segments?: NonNullable<Evidence['segments']>;
}

interface IdentityInput {
  case_id: string;
  site_id: string;
  asset_id: string;
}

export interface CreateInspectionPackageInput extends IdentityInput {
  inspection_id?: string;
  transcript: TranscriptInput;
  attachments?: Evidence[];
  created_at?: string;
}

export interface CollectCompletionEvidenceInput extends IdentityInput {
  job_id: string;
  completion_id?: string;
  version: number;
  technician_id: string;
  reported_status: CompletionEvidence['reported_status'];
  comments: string;
  transcript: TranscriptInput;
  attachments?: Evidence[];
  unresolved_items?: string[];
  created_at?: string;
}

function required(value: string, name: string): string {
  const result = value.trim();
  if (!result) throw new Error(`${name} is required.`);
  return result;
}

function transcriptEvidence(input: TranscriptInput, prefix: string): Evidence {
  const text = required(input.text, 'transcript.text');
  const uri = required(input.uri, 'transcript.uri');
  if (input.source === 'plaud' && !input.provider_record_id) {
    throw new Error('A Plaud transcript requires provider_record_id provenance.');
  }
  if (input.source === 'plaud' && input.mode !== 'live') {
    throw new Error('Synthetic or fixture transcripts cannot be labelled as Plaud-derived.');
  }
  return {
    id: `${prefix}-${randomUUID()}`,
    kind: 'transcript',
    asset_id: input.asset_id,
    source: input.source,
    mode: input.mode,
    uri,
    captured_at: input.captured_at ?? null,
    text,
    ...(input.provider_record_id ? { provider_record_id: input.provider_record_id } : {}),
    ...(input.segments ? { segments: structuredClone(input.segments) } : {}),
  };
}

export function createInspectionPackage(input: CreateInspectionPackageInput): InspectionPackage {
  const now = input.created_at ?? new Date().toISOString();
  const transcript = transcriptEvidence(input.transcript, 'EV-TRANSCRIPT');
  const evidence = [transcript, ...structuredClone(input.attachments ?? [])];
  const missing_information: string[] = [];
  if (!evidence.some(item => item.kind === 'thermal_image')) missing_information.push('Radiometric thermal image');
  if (!evidence.some(item => item.kind === 'measurement')) missing_information.push('Calibrated measurements and operating load');
  const result: InspectionPackage = {
    schema_version: '1.0',
    case_id: required(input.case_id, 'case_id'),
    site_id: required(input.site_id, 'site_id'),
    asset_id: required(input.asset_id, 'asset_id'),
    inspection_id: input.inspection_id ? required(input.inspection_id, 'inspection_id') : `INSPECT-${randomUUID()}`,
    evidence,
    observations: [{
      id: `OBS-${randomUUID()}`,
      text: 'Inspection transcript captured for qualified review.',
      evidence_ids: [transcript.id],
      segment_ids: transcript.segments?.map(segment => segment.id) ?? [],
      needs_review: true,
    }],
    missing_information,
    created_at: now,
  };
  assertContract('InspectionPackage', result);
  return result;
}

export function collectCompletionEvidence(input: CollectCompletionEvidenceInput): CompletionEvidence {
  if (!Number.isInteger(input.version) || input.version < 1) throw new Error('version must be a positive integer.');
  const transcript = transcriptEvidence(input.transcript, 'EV-COMPLETION');
  const evidence = [transcript, ...structuredClone(input.attachments ?? [])];
  const mismatchedAssets = [...new Set(evidence.map(item => item.asset_id).filter((id): id is string => Boolean(id && id !== input.asset_id)))];
  const unresolved = [...(input.unresolved_items ?? [])];
  for (const asset of mismatchedAssets) unresolved.push(`Completion evidence identifies ${asset}; expected ${input.asset_id}.`);
  const result: CompletionEvidence = {
    schema_version: '1.0',
    case_id: required(input.case_id, 'case_id'),
    site_id: required(input.site_id, 'site_id'),
    asset_id: required(input.asset_id, 'asset_id'),
    completion_id: input.completion_id ? required(input.completion_id, 'completion_id') : `COMP-${randomUUID()}`,
    job_id: required(input.job_id, 'job_id'),
    version: input.version,
    technician_id: required(input.technician_id, 'technician_id'),
    reported_status: input.reported_status,
    comments: required(input.comments, 'comments'),
    evidence,
    unresolved_items: [...new Set(unresolved)],
    created_at: input.created_at ?? new Date().toISOString(),
  };
  assertContract('CompletionEvidence', result);
  return result;
}

export type { CompletionEvidence, Evidence, InspectionPackage };

export * from './plaud.ts';
