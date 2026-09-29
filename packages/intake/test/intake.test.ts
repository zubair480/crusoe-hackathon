import assert from 'node:assert/strict';
import test from 'node:test';
import { assertContract } from '@thermaldesk/contracts';
import { collectCompletionEvidence, createInspectionPackage } from '../src/index.ts';

const transcript = {
  text: 'Technician reports a hotspot and requests review.',
  uri: 'repo://fixtures/transcript.txt',
  source: 'synthetic' as const,
  mode: 'simulated' as const,
  asset_id: 'DEMO-A',
  captured_at: '2026-09-29T18:00:00Z',
  segments: [{ id: 'SEG-1', text: 'Technician reports a hotspot and requests review.', start_seconds: 0, end_seconds: 4, speaker: 'TECH-1' }],
};

test('creates a schema-valid inspection while preserving transcript provenance', () => {
  const result = createInspectionPackage({ case_id: 'CASE-1', site_id: 'SITE-1', asset_id: 'DEMO-A', transcript, created_at: '2026-09-29T18:00:00Z' });
  assertContract('InspectionPackage', result);
  assert.equal(result.evidence[0]?.uri, transcript.uri);
  assert.equal(result.evidence[0]?.segments?.[0]?.id, 'SEG-1');
  assert.match(result.missing_information.join(' '), /thermal image/i);
});

test('requires real provenance before labelling a transcript Plaud-derived', () => {
  assert.throws(() => createInspectionPackage({
    case_id: 'CASE-1', site_id: 'SITE-1', asset_id: 'DEMO-A',
    transcript: { ...transcript, source: 'plaud', mode: 'simulated' },
  }), /Plaud|Synthetic/);
});

test('keeps wrong-asset completion visible and schema-valid', () => {
  const result = collectCompletionEvidence({
    case_id: 'CASE-1', site_id: 'SITE-1', asset_id: 'DEMO-A', job_id: 'JOB-1', version: 1,
    technician_id: 'TECH-1', reported_status: 'complete', comments: 'Work complete on DEMO-B.',
    transcript: { ...transcript, asset_id: 'DEMO-B', text: 'Work complete on DEMO-B.' },
  });
  assertContract('CompletionEvidence', result);
  assert.equal(result.evidence[0]?.asset_id, 'DEMO-B');
  assert.match(result.unresolved_items.join(' '), /DEMO-B.*DEMO-A/);
});
