/**
 * Starts the five crew agents on Band with SIMULATED suppliers, messaging and schedule.
 * `npm run band:check` only verifies that agent_config.yaml names all five agents.
 */
import { readFile } from 'node:fs/promises';
import { createRepairJob, getRepairJob } from '../engine.js';
import { ACTION_TYPES } from '../contract.js';
import { systemClock } from '../clock.js';
import { createFileJobRepository } from '../repository.js';
import {
  createSimulatedCommunication,
  createSimulatedRoster,
  createSimulatedSchedule,
  createSimulatedSupplier,
} from '../adapters/simulated.js';
import type { CoordinationAdapters, CoordinationContext } from '../types.js';
import { startBandCrew } from './live.js';
import { BAND_ROLES, ROLE_CONFIG_KEYS, ROLE_DESCRIPTIONS, type BandRole } from './protocol.js';

const configPath = process.env.BAND_AGENT_CONFIG ?? 'agent_config.yaml';
const checkOnly = process.argv.includes('--check');

async function checkConfig(): Promise<BandRole[]> {
  const sdk = await import('@band-ai/sdk');
  const missing: BandRole[] = [];
  for (const role of BAND_ROLES) {
    try {
      const config = sdk.loadAgentConfig(ROLE_CONFIG_KEYS[role], configPath);
      if (!config.agentId || !config.apiKey) throw new Error('agent_id or api_key is empty');
      console.log(`ok       ${ROLE_CONFIG_KEYS[role].padEnd(20)} ${role}`);
    } catch (error) {
      missing.push(role);
      console.log(`MISSING  ${ROLE_CONFIG_KEYS[role].padEnd(20)} ${role}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return missing;
}

const missing = await checkConfig();
if (missing.length > 0) {
  console.log(`\nBand is NOT configured. Register these agents at https://app.band.ai/agents and add them to ${configPath}:`);
  for (const role of missing) console.log(`  ${ROLE_CONFIG_KEYS[role]}: ${role} - ${ROLE_DESCRIPTIONS[role]}`);
  process.exit(1);
}
if (checkOnly) {
  console.log(`\n${configPath} names all five agents. Credentials are verified when the agents connect.`);
  process.exit(0);
}

const clock = systemClock;
const context: CoordinationContext = {
  repository: createFileJobRepository({ directory: process.env.COORDINATION_DATA_DIR ?? '.data/band' }),
  clock,
};
const day = 86_400_000;
const adapters: CoordinationAdapters = {
  suppliers: [
    createSimulatedSupplier({
      supplier_id: 'SUP-A',
      name: 'Demo Supplier A',
      clock,
      catalog: { 'DEMO-PART-01': { unit_price_minor: 12_500, currency: 'USD', quantity_available: 5, lead_time_hours: 24 } },
    }),
  ],
  roster: createSimulatedRoster([
    {
      technician_id: 'TECH-1',
      name: 'Dana Demo',
      qualifications: ['electrical'],
      site_ids: ['DEMO-SITE'],
      distance_km: 5,
      availability: [{ start_at: new Date(Date.now()).toISOString(), end_at: new Date(Date.now() + 10 * day).toISOString() }],
      contact: { channel: 'simulated', address: 'sim:TECH-1' },
      active: true,
    },
  ]),
  communication: createSimulatedCommunication(),
  schedule: createSimulatedSchedule({ clock }),
  manager: { manager_id: 'MGR-DEMO', name: 'Demo Manager', address: 'sim:manager' },
};

try {
  await getRepairJob('JOB-001', context);
} catch {
  const fixture = JSON.parse(
    await readFile(new URL('../../../../../fixtures/approved-recommendation.json', import.meta.url), 'utf8'),
  );
  await createRepairJob(
    {
      recommendation: fixture.data,
      job_id: 'JOB-001',
      runtime: 'band',
      requirements: { required_qualifications: ['electrical'] },
      authority: {
        authority_id: 'AUTH-DEMO',
        mode: 'simulated',
        currency: 'USD',
        max_total_minor: 50_000,
        allowed_actions: [...ACTION_TYPES],
        expires_at: new Date(Date.now() + 30 * day).toISOString(),
      },
    },
    context,
  );
  console.log('Seeded fictional job JOB-001 from fixtures/approved-recommendation.json.');
}

const crew = await startBandCrew({ context, adapters, config_path: configPath });
console.log(`\nThe crew is connected to Band: ${crew.roles.join(', ')}.`);
console.log('Suppliers, messaging and the schedule are SIMULATED. Only the coordination runs on Band.');
console.log('In a Band room with RepairCoordinator, write:  @RepairCoordinator coordinate JOB-001');
console.log('Press Ctrl+C to stop.');
const stop = async () => {
  await crew.stop();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
