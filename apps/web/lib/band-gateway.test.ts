import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const fake = vi.hoisted(() => ({ names: { repair_coordinator: 'RepairCoordinator', parts_sourcer: 'PartsSourcer', authority_critic: 'AuthorityCritic', tech_dispatcher: 'TechDispatcher', schedule_reporter: 'ScheduleReporter' } as Record<string, string>,
  started: 0, stopped: 0, created: 0, sent: 0, failSend: false, failStart: false,
}));
vi.mock('@band-ai/sdk/core', () => ({ NoopLogger: class {} }));
vi.mock('@band-ai/sdk', () => ({
  loadAgentConfig: (key: string) => ({ agentId: fake.names[key], apiKey: 'PRIVATE-TEST-VALUE' }),
  BandLink: class { rest; constructor(config: { agentId: string }) { this.rest = { getAgentMe: async () => ({ id: config.agentId, name: config.agentId }) }; } },
  GenericAdapter: class { constructor(readonly handler: unknown) {} },
  Agent: { create: () => ({ isRunning: true,
    start: async () => { fake.started++; if (fake.failStart && fake.started === 2) throw new Error('PRIVATE-TEST-VALUE'); },
    stop: async () => { fake.stopped++; },
    runtime: { link: { subscribeRoom: async () => {}, rest: {
      createChat: async () => { fake.created++; return { id: 'room-1' }; },
      addChatParticipant: async () => ({}),
      createChatMessage: async () => { fake.sent++; if (fake.failSend) throw new Error('PRIVATE-TEST-VALUE'); return {}; },
    } } },
  }) },
}));
import { BandGateway } from './band-gateway';
import { createCoordinationPorts } from './coordination-ports';
import { demoPorts, reviewableDemoScope } from './demo-ports';
let dir: string, gateway: BandGateway, jobId: string;
beforeEach(async () => {
  Object.assign(fake, { started: 0, stopped: 0, created: 0, sent: 0, failSend: false, failStart: false });
  dir = await mkdtemp(join(tmpdir(), 'band-gateway-test-'));
  const ports = createCoordinationPorts(dir, demoPorts);
  const recommendation = reviewableDemoScope(); recommendation.status = 'approved';
  recommendation.approval = { reviewer_id: 'demo', recommendation_version: recommendation.version, approved_at: new Date().toISOString(), mode: 'simulated' };
  jobId = (await ports.createBandJob(recommendation, null)).job_id;
  gateway = new BandGateway(dir, ports, 'FAKE-CONFIG');
});
afterEach(async () => { await gateway.stop(); await rm(dir, { recursive: true, force: true }); });
it('verifies all five identities without connecting or sending messages and exposes no keys', async () => {
  expect((await gateway.check()).every(a => a.verified)).toBe(true);
  expect(fake.started).toBe(0); expect(fake.sent).toBe(0);
  expect(JSON.stringify(await gateway.status())).not.toContain('PRIVATE-TEST-VALUE');
});
it('persists room and event receipts and does not duplicate confirmed dispatch', async () => {
  await gateway.dispatch(jobId, 'kickoff');
  expect(await gateway.dispatch(jobId, 'kickoff')).toMatchObject({ duplicate: true, status: 'confirmed' });
  expect(fake.started).toBe(5); expect(fake.created).toBe(1); expect(fake.sent).toBe(1);
});
it('retains uncertain send intent and never blindly repeats an external message', async () => {
  fake.failSend = true;
  await expect(gateway.dispatch(jobId, 'kickoff')).rejects.toThrow('did not confirm');
  expect(await gateway.dispatch(jobId, 'kickoff')).toMatchObject({ duplicate: true, status: 'pending' });
  expect(fake.sent).toBe(1);
  expect(JSON.stringify(await gateway.status())).not.toContain('PRIVATE-TEST-VALUE');
});
it('stops partially started agents and redacts provider errors on connection failure', async () => {
  fake.failStart = true;
  await expect(gateway.start(jobId)).rejects.toThrow('connection failed');
  expect(fake.stopped).toBe(2);
  expect((await gateway.status()).connected).toBe(false);
});
