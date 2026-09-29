import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { expect, it, vi } from 'vitest';
import { seed } from './store';
import { reviewableDemoScope } from './demo-ports';

const source = await readFile(new URL('../public/mcc/js/integration.js', import.meta.url), 'utf8');
async function bridge({ locked = false, failAnalysis = false } = {}) {
  const state = seed();
  if (locked) state.job = { job_id: 'JOB-EXISTING', status: 'scheduled' } as typeof state.job;
  const uploaded = { ...state, revision: 1 };
  const recommendation = { ...reviewableDemoScope(), status: 'needs_information', missing_information: ['Calibrated measurements required.'] };
  const analyzed = { ...uploaded, revision: 2, recommendation };
  const root = { innerHTML: '', classList: { toggle() {} }, setAttribute() {}, querySelectorAll: () => [], querySelector: () => null };
  const fetch = vi.fn(async (url: string, options?: RequestInit) => {
    if (url.endsWith('/api/health')) return Response.json({ integrations: { crusoe: 'simulated' } });
    if (url.endsWith('/api/evidence')) return Response.json(uploaded, { status: 201 });
    if (options?.method === 'POST') return failAnalysis
      ? Response.json({ error: 'Case changed. Refresh.' }, { status: 409 })
      : Response.json(analyzed);
    return Response.json(failAnalysis ? uploaded : state);
  });
  const window: any = { dispatchEvent: vi.fn() };
  runInNewContext(source, {
    window, document: { createElement: () => root, head: { append() {} }, body: { append() {} } },
    location: { search: '', port: '3001', origin: 'http://127.0.0.1:3001' },
    localStorage: { getItem: () => null, setItem() {} },
    URLSearchParams, FormData, structuredClone, fetch,
    CustomEvent: class { constructor(public type: string, public init: unknown) {} },
  });
  await window.thermaldeskWorkflow.refresh();
  fetch.mockClear();
  return { workflow: window.thermaldeskWorkflow, fetch, root };
}

it('automatically analyzes a saved upload at its returned revision and offers a report before a job exists', async () => {
  const { workflow, fetch, root } = await bridge();
  await workflow.upload(new File(['image bytes'], 'inspection.png', { type: 'image/png' }));
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(fetch.mock.calls[0][0]).toContain('/api/evidence');
  expect(JSON.parse(String(fetch.mock.calls[1][1]?.body))).toEqual({ command: 'analyze', expectedRevision: 1 });
  expect(workflow.state.revision).toBe(2);
  expect(root.innerHTML).toContain('Draft report');
  expect(root.innerHTML).toContain('Calibrated measurements required.');
  expect(root.innerHTML).toContain('no live Crusoe analysis');
});

it('keeps a saved upload visible when analysis fails and does not retry automatically', async () => {
  const { workflow, fetch, root } = await bridge({ failAnalysis: true });
  await workflow.upload(new File(['image bytes'], 'inspection.png', { type: 'image/png' }));
  expect(fetch.mock.calls.filter(([, options]) => options?.method === 'POST')).toHaveLength(2);
  expect(root.innerHTML).toContain('was saved, but analysis could not complete');
  expect(root.innerHTML).toContain('Use Analyze evidence to retry');
  expect(workflow.state.revision).toBe(1);
});

it('reports a locked inspection without uploading or resetting an existing repair', async () => {
  const { workflow, fetch, root } = await bridge({ locked: true });
  await workflow.upload(new File(['image bytes'], 'inspection.png', { type: 'image/png' }));
  expect(fetch).not.toHaveBeenCalled();
  expect(root.innerHTML).toContain('Upload blocked: repair JOB-EXISTING is scheduled');
  expect(workflow.state.job.job_id).toBe('JOB-EXISTING');
});

it('escapes file names in failure messages', async () => {
  const { workflow, root } = await bridge({ failAnalysis: true });
  await workflow.upload(new File(['image bytes'], '<img src=x onerror=alert(1)>.png', { type: 'image/png' }));
  expect(root.innerHTML).not.toContain('<img src=x');
  expect(root.innerHTML).toContain('&lt;img');
});
