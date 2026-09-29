import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { analyzeInspection, compareCompletion, CrusoeAdapter, FixtureAnalysisAdapter, type AnalysisTelemetry } from '@thermaldesk/analysis';
import { assertContract } from '@thermaldesk/contracts';
import { demoPorts } from './demo-ports';
import type { TeamPorts } from './model';

export function createAnalysisPorts(directory: string, mode: 'fixture' | 'crusoe' = 'fixture'): TeamPorts {
  const adapter = mode === 'crusoe' ? new CrusoeAdapter({
    resolveImage: async evidence => {
      const match = /^local-evidence:\/\/([a-f0-9-]{36}\.(png|jpg))$/.exec(evidence.uri);
      if (!match) throw new Error('Analysis accepts only locally uploaded JPEG/PNG references.');
      const bytes = await readFile(join(directory, 'evidence', match[1]));
      return `data:image/${match[2] === 'jpg' ? 'jpeg' : 'png'};base64,${bytes.toString('base64')}`;
    },
  }) : new FixtureAnalysisAdapter();
  async function record(operation: string, caseId: string, telemetry: AnalysisTelemetry) {
    await mkdir(directory, { recursive: true });
    // Operational metadata only: no API keys, images, transcripts or request bodies.
    await appendFile(join(directory, 'analysis-telemetry.jsonl'), JSON.stringify({ at: new Date().toISOString(), operation, case_id: caseId, ...telemetry }) + '\n', 'utf8');
  }
  return {
    ...demoPorts,
    async analyzeInspection(inspection) {
      const result = await analyzeInspection(inspection, { adapter });
      assertContract('Recommendation', result.data);
      await record('analyzeInspection', inspection.case_id, result.telemetry);
      return result.data;
    },
    async compareCompletion(job, recommendation, completion) {
      // Sunny's local input type restricts approval to null, although comparison accepts
      // approved v1 records at runtime. Preserve the actual approval; never strip it.
      const input = recommendation as unknown as Parameters<typeof compareCompletion>[1];
      const result = await compareCompletion(job, input, completion, { mode: completion.evidence.every(e => e.mode === 'live') ? 'live' : 'simulated' });
      assertContract('VerificationDraft', result.data);
      await record('compareCompletion', job.case_id, result.telemetry);
      return result.data;
    },
  };
}
