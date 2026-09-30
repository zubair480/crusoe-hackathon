import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const web = resolve(root, 'apps', 'web');
const port = process.env.THERMALDESK_SYSTEM_TEST_PORT ?? '3210';
const base = `http://127.0.0.1:${port}`;
const next = resolve(root, 'node_modules', 'next', 'dist', 'bin', 'next');
const testArtifacts = join(tmpdir(), `thermaldesk-system-${process.pid}`);
let logs = '';

const server = spawn(process.execPath, [next, 'start', '--hostname', '127.0.0.1', '--port', port], {
  cwd: web,
  env: {
    ...process.env,
    THERMALDESK_ANALYSIS_MODE: 'fixture',
    CRUSOE_LIVE_REQUESTS_ENABLED: 'false',
    THERMALDESK_DEV_FRONTEND_ORIGINS: base,
    THERMALDESK_ARTIFACT_DIR: testArtifacts,
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
for (const stream of [server.stdout, server.stderr]) stream.on('data', chunk => { logs = (logs + chunk).slice(-8000); });

async function waitForHealth() {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) throw new Error(`Server exited before health check.\n${logs}`);
    try {
      const response = await fetch(`${base}/api/health`);
      if (response.ok) return;
    } catch {}
    await new Promise(resolveWait => setTimeout(resolveWait, 250));
  }
  throw new Error(`Server did not become healthy within 30 seconds.\n${logs}`);
}

try {
  await waitForHealth();
  const landing = await fetch(`${base}/`);
  if (!landing.ok || landing.url !== `${base}/mcc/index.html`) {
    throw new Error(`3D application landing failed: ${landing.status} ${landing.url}`);
  }
  const bridge = await fetch(`${base}/mcc/js/integration.js`);
  const bridgeSource = await bridge.text();
  if (!bridge.ok || !bridgeSource.includes('thermaldesk:state')) {
    throw new Error('3D application workflow bridge is missing or invalid.');
  }
  const coordination = await fetch(`${base}/api/coordination`);
  const coordinationState = await coordination.json();
  if (!coordination.ok || coordinationState.band?.agents?.length !== 5 || coordinationState.band.connected || JSON.stringify(coordinationState).includes('api_key')) {
    throw new Error('Coordination status must expose five disconnected agents without credentials.');
  }
  const blockedBand = await fetch(`${base}/api/coordination`, {
    method: 'POST', headers: { Origin: base, 'Content-Type': 'application/json' },
    body: JSON.stringify({ command: 'start_band', expectedRevision: coordinationState.revision }),
  });
  if (blockedBand.status !== 409) throw new Error('Band start must require explicit live-transport opt-in.');
  const deniedBand = await fetch(`${base}/api/coordination`, {
    method: 'POST', headers: { Origin: 'https://untrusted.example', 'Content-Type': 'application/json' },
    body: JSON.stringify({ command: 'check_band', expectedRevision: coordinationState.revision }),
  });
  if (deniedBand.status !== 403) throw new Error('Coordination must reject an untrusted mutation origin.');
  const smoke = spawn(process.execPath, [resolve(web, 'scripts', 'smoke.mjs'), '--reset-demo'], {
    cwd: root,
    env: { ...process.env, THERMALDESK_URL: base },
    stdio: 'inherit',
  });
  const [code] = await once(smoke, 'exit');
  if (code !== 0) throw new Error(`HTTP system test exited with code ${code}.`);
  const beforePreparation = await (await fetch(`${base}/api/case`)).json();
  const preparedResponse = await fetch(`${base}/api/preparation`, {
    method: 'POST', headers: { Origin: base, 'Content-Type': 'application/json' },
    body: JSON.stringify({ command: 'prepare', expectedRevision: beforePreparation.revision }),
  });
  const prepared = await preparedResponse.json();
  if (!preparedResponse.ok || prepared.quotes.length || prepared.selected_total_minor !== null || prepared.history.length < 5) {
    throw new Error('Preparation must produce agent work without fabricated prices.');
  }
  const partId = beforePreparation.recommendation.parts[0].part_id;
  const rfqResponse = await fetch(`${base}/api/preparation?draft=rfq&id=${encodeURIComponent(partId)}`);
  const rfq = await rfqResponse.text();
  if (!rfqResponse.ok || !rfq.includes('X-Unsent: 1') || !rfqResponse.headers.get('content-disposition')?.includes('attachment')) throw new Error('RFQ must download as an unsent email draft.');
  const afterPreparation = await (await fetch(`${base}/api/case`)).json();
  if (JSON.stringify(beforePreparation.job) !== JSON.stringify(afterPreparation.job)) throw new Error('Preparation must not purchase, book or alter the canonical repair job.');
  const workbench = await fetch(`${base}/api/preparation/workbench`);
  if (!workbench.ok || !(await workbench.text()).includes('Parts & dispatch')) throw new Error('Parts and dispatch workbench is unavailable.');
  console.log('Preparation HTTP checks: PASS (five agent outputs, no invented quotes, unsent RFQ, unchanged execution state).');
  if (process.argv.includes('--live-band')) {
    // Explicit opt-in: only fictional fixture data goes to the registered Band crew.
    // The server is always stopped below; model/provider inference remains disabled.
    const output = resolve(root, 'artifacts', `band-preparation-run-${Date.now()}`);
    await mkdir(output, { recursive: true });
    const getJson = async path => {
      const response = await fetch(base + path, { signal: AbortSignal.timeout(10_000) });
      if (!response.ok) throw new Error(`Read failed: ${path}, HTTP ${response.status}`);
      return response.json();
    };
    const post = async (path, command, fields = {}) => {
      const current = await getJson('/api/case');
      const response = await fetch(base + path, {
        method: 'POST', headers: { Origin: base, 'Content-Type': 'application/json' },
        body: JSON.stringify({ command, expectedRevision: current.revision, ...fields }), signal: AbortSignal.timeout(60_000),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(`${command}: ${result.error ?? response.status}`);
      return result;
    };
    try {
      await post('/api/case', 'reset_demo');
      await post('/api/case', 'load_demo_scope');
      await post('/api/case', 'approve_scope', { reviewer: 'Synthetic live-transport test reviewer' });
      const fixture = await getJson('/api/case'), part = fixture.recommendation.parts[0];
      await post('/api/preparation', 'budget', { values: { total_minor: 20000, currency: 'USD', recorded_by: 'Fictional test budget' } });
      const quote = { part_id: part.part_id, offered_part_id: part.part_id, specification: part.approved_specification,
        supplier: 'Fictional test supplier', quantity: part.quantity, total_minor: 12345, currency: 'USD',
        source_url: 'https://supplier.example/fictional-test-quote', recorded_by: 'Synthetic test operator',
        valid_until: new Date(Date.now() + 86400000).toISOString(), delivery_at: new Date(Date.now() + 172800000).toISOString() };
      await post('/api/preparation', 'quote', { values: quote });
      await post('/api/preparation', 'quote', { values: { ...quote, supplier: 'Fictional rejected supplier', offered_part_id: 'WRONG-TEST-PART', total_minor: 30000 } });
      await post('/api/preparation', 'contact', { values: { name: 'Fictional test technician', email: 'technician@example.com', qualifications: 'Fictional test qualification', recorded_by: 'Synthetic test reviewer' } });
      const before = await getJson('/api/preparation');
      if (before.quotes[0].status !== 'eligible_for_review' || before.quotes[1].status !== 'blocked' || before.selected_total_minor !== 12345) throw new Error('Quote checks failed over HTTP.');
      const prior = new Set(before.history.map(item => item.id));
      const dispatch = await post('/api/coordination', 'dispatch_band', { allowLiveBand: true });
      await writeFile(join(output, 'dispatch.json'), JSON.stringify(dispatch.dispatch, null, 2));
      let completed, observed;
      const deadline = Date.now() + 60_000;
      while (Date.now() < deadline) {
        observed = await getJson('/api/preparation');
        const fresh = observed.history.filter(item => !prior.has(item.id));
        if (['RepairCoordinator', 'PartsSourcer', 'AuthorityCritic', 'TechDispatcher', 'ScheduleReporter'].every(role => fresh.some(item => item.role === role))) { completed = fresh; break; }
        await new Promise(resolveWait => setTimeout(resolveWait, 1000));
      }
      await writeFile(join(output, 'preparation.json'), JSON.stringify(observed, null, 2));
      if (!completed) throw new Error(`Live Band handoff incomplete; evidence: ${output}`);
      const final = await getJson('/api/case');
      if (final.job.actions.length || final.job.booking) throw new Error('Preparation unexpectedly created an external action or booking.');
      const duplicate = await post('/api/coordination', 'dispatch_band', { allowLiveBand: true });
      if (!duplicate.dispatch.duplicate || duplicate.dispatch.room_id !== dispatch.dispatch.room_id) throw new Error('Unchanged Band dispatch was not deduplicated.');
      for (const [kind, id] of [['rfq', part.part_id], ['technician', before.contacts[0].id]]) {
        const response = await fetch(`${base}/api/preparation?draft=${kind}&id=${encodeURIComponent(id)}`);
        const draft = await response.text();
        if (!response.ok || !draft.includes('X-Unsent: 1')) throw new Error(`${kind} email draft failed.`);
        await writeFile(join(output, `${kind}.eml`), draft);
      }
      // Drain pending sends, then read the actual provider transcript as delivery proof.
      await post('/api/coordination', 'stop_band');
      const { BandLink, loadAgentConfig } = await import('@band-ai/sdk');
      const { NoopLogger } = await import('@band-ai/sdk/core');
      const config = loadAgentConfig('repair_coordinator', process.env.BAND_AGENT_CONFIG || resolve(root, 'packages/coordination/agent_config.yaml'));
      const rest = new BandLink({ ...config, logger: new NoopLogger() }).rest;
      const transcript = await rest.getChatContext({ chatId: dispatch.dispatch.room_id, page: 1, pageSize: 100 }, { maxRetries: 0, timeoutInSeconds: 15 });
      const messages = transcript.data.map(item => ({ id: item.id, sender: item.sender_name, content: item.content, at: item.inserted_at }));
      await writeFile(join(output, 'band-transcript.json'), JSON.stringify(messages, null, 2));
      if (!messages.some(item => item.sender === 'ScheduleReporter' && item.content.includes('"kind":"report"'))) throw new Error('Final report was not found in the actual Band transcript.');
      const result = { result: 'PASS', at: new Date().toISOString(), mode: 'live_band_transport_with_fictional_data', room_id: dispatch.dispatch.room_id,
        roles: completed.map(item => ({ role: item.role, at: item.at })), selected_total_minor: observed.selected_total_minor,
        rejected_quote_reasons: observed.quotes[1].failures, duplicate_dispatch: 'prevented', final_report_delivery: 'verified_in_band_transcript', purchases: 0, emails_sent: 0, bookings: 0, paid_model_calls: 0, output };
      await writeFile(join(output, 'result.json'), JSON.stringify(result, null, 2));
      console.log(JSON.stringify(result, null, 2));
    } catch (error) {
      await writeFile(join(output, 'failure.json'), JSON.stringify({ error: error.message,
        coordination: await getJson('/api/coordination'), preparation: await getJson('/api/preparation') }, null, 2));
      throw error;
    } finally {
      await post('/api/coordination', 'stop_band');
    }
  }
} finally {
  if (server.exitCode === null) {
    server.kill('SIGTERM');
    await Promise.race([once(server, 'exit'), new Promise(resolveWait => setTimeout(resolveWait, 5_000))]);
  }
  await rm(testArtifacts, { recursive: true, force: true });
}
