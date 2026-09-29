import { expect, it } from 'vitest';
import { exportReport } from './report';
import { seed } from './store';
import { reviewableDemoScope } from './demo-ports';

it('exports every draft finding, evidence reference, uncertainty and analysis blocker before repair approval', () => {
  const state = seed();
  state.recommendation = {
    ...reviewableDemoScope(), status: 'needs_information',
    findings: [
      { id: 'F1', description: 'First finding', evidence_ids: ['EV-IMAGE-1'], severity: 'unassessed', uncertainties: ['Load unknown'] },
      { id: 'F2', description: 'Second finding', evidence_ids: ['EV-IMAGE-2'], severity: 'low', uncertainties: ['Calibration unknown'] },
    ],
    missing_information: ['Analysis unavailable (not_configured).', 'Operating conditions required.'],
  };
  const report = exportReport(state);
  for (const text of ['First finding', 'Second finding', 'EV-IMAGE-1', 'EV-IMAGE-2', 'Load unknown', 'Calibration unknown', 'not_configured', 'Operating conditions required.', 'needs_information', 'not approved']) expect(report).toContain(text);
  expect(state.job).toBeNull();
  expect(report).not.toContain('<h2>Reviewed repair scope</h2>');
});

it('escapes provider output and missing-information messages in the report', () => {
  const state = seed();
  state.recommendation = reviewableDemoScope();
  state.recommendation.findings[0].description = '<img src=x onerror=alert(1)>';
  state.recommendation.findings[0].uncertainties = ['<script>unsafe()</script>'];
  state.recommendation.missing_information = ['<iframe src="https://example.invalid">'];
  const report = exportReport(state);
  expect(report).not.toMatch(/<(img|script|iframe)\b/);
  expect(report).toContain('&lt;img');
  expect(report).toContain('&lt;script&gt;');
  expect(report).toContain('&lt;iframe');
});
