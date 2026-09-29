import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { rm } from 'node:fs/promises';
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
  const smoke = spawn(process.execPath, [resolve(web, 'scripts', 'smoke.mjs'), '--reset-demo'], {
    cwd: root,
    env: { ...process.env, THERMALDESK_URL: base },
    stdio: 'inherit',
  });
  const [code] = await once(smoke, 'exit');
  if (code !== 0) throw new Error(`HTTP system test exited with code ${code}.`);
} finally {
  if (server.exitCode === null) {
    server.kill('SIGTERM');
    await Promise.race([once(server, 'exit'), new Promise(resolveWait => setTimeout(resolveWait, 5_000))]);
  }
  await rm(testArtifacts, { recursive: true, force: true });
}
