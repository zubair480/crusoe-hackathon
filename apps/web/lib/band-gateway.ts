import { existsSync } from 'node:fs';
import { mkdir, open, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { BAND_ROLES, ROLE_CONFIG_KEYS, createCrewHandler, decodeEnvelope, encodeEnvelope, type BandRole } from '@thermaldesk/coordination';
import type { createCoordinationPorts } from './coordination-ports';

type Ports = ReturnType<typeof createCoordinationPorts>;
type Room = { job_id: string; room_id: string | null; status: 'creating' | 'ready'; events: Record<string, 'pending' | 'confirmed'> };
type Agent = import('@band-ai/sdk').Agent;
export function bandConfigPath() {
  if (process.env.BAND_AGENT_CONFIG) return resolve(process.env.BAND_AGENT_CONFIG);
  let root = process.cwd();
  while (!existsSync(join(root, 'contracts', 'v1.schema.json')) && dirname(root) !== root) root = dirname(root);
  return join(root, 'packages', 'coordination', 'agent_config.yaml');
}

/** Server-only Band transport. Reading/checking never starts agents or posts messages. */
export class BandGateway {
  private agents = new Map<BandRole, Agent>();
  private rooms: Record<string, Room> = {};
  private activeJob: string | null = null;
  private startFlight: Promise<void> | null = null;
  constructor(readonly directory: string, readonly ports: Ports, readonly configPath = bandConfigPath()) {}
  private get file() { return join(this.directory, 'band-rooms.json'); }
  private async load() {
    try { this.rooms = JSON.parse(await readFile(this.file, 'utf8')); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
  private async save() {
    const temp = `${this.file}.${randomUUID()}.tmp`;
    await writeFile(temp, JSON.stringify(this.rooms), 'utf8');
    await rename(temp, this.file);
  }
  async status() {
    await this.load();
    return { configured: existsSync(this.configPath), connected: this.agents.size === BAND_ROLES.length,
      active_job_id: this.activeJob, agents: BAND_ROLES.map(name => ({ name, connected: this.agents.get(name)?.isRunning ?? false })),
      rooms: Object.values(this.rooms), business_actions: 'simulated', schedule: 'local_workbook' };
  }
  async check() {
    const sdk = await import('@band-ai/sdk');
    const { NoopLogger } = await import('@band-ai/sdk/core');
    return Promise.all(BAND_ROLES.map(async name => {
      try {
        const config = sdk.loadAgentConfig(ROLE_CONFIG_KEYS[name], this.configPath);
        const identity = await new sdk.BandLink({ ...config, logger: new NoopLogger() }).rest.getAgentMe({ maxRetries: 0, timeoutInSeconds: 10 });
        return { name, verified: identity.id === config.agentId && identity.name === name };
      } catch { return { name, verified: false }; }
    }));
  }
  async start(jobId: string) {
    if (this.startFlight) { await this.startFlight; }
    if (this.agents.size) {
      if (this.activeJob !== jobId) throw new Error('Stop the current Band crew before switching jobs.');
      return;
    }
    this.startFlight = this.startAgents(jobId);
    try { await this.startFlight; } finally { this.startFlight = null; }
  }
  private async startAgents(jobId: string) {
    await this.load();
    if (!(await this.check()).every(agent => agent.verified)) throw new Error('Band agent identity verification failed.');
    const sdk = await import('@band-ai/sdk');
    const { NoopLogger } = await import('@band-ai/sdk/core');
    const adapters = await this.ports.adaptersForJob(jobId);
    this.activeJob = jobId;
    try {
      for (const role of BAND_ROLES) {
        const handler = createCrewHandler(role, { context: this.ports.context, adapters });
        const config = sdk.loadAgentConfig(ROLE_CONFIG_KEYS[role], this.configPath);
        const agent = sdk.Agent.create({
          config, logger: new NoopLogger(),
          agentConfig: { autoSubscribeExistingRooms: true },
          roomFilter: room => this.rooms[jobId]?.room_id === room.id,
          adapter: new sdk.GenericAdapter(async ({ message, tools }) => {
            if (this.rooms[jobId]?.room_id !== message.roomId) return;
            const envelope = decodeEnvelope(message.content);
            if (envelope && envelope.job_id !== jobId) return;
            if (!envelope && !message.content.includes(jobId)) return;
            if (envelope?.kind === 'verdict' && message.senderName !== 'AuthorityCritic') return;
            await handler({ message: { id: message.id, roomId: message.roomId, content: message.content,
              senderName: message.senderName, senderType: message.senderType }, tools: {
              sendMessage: (content, mentions) => tools.sendMessage(content, mentions),
              sendEvent: (content, kind, metadata) => tools.sendEvent(content, kind, metadata),
              addParticipant: (name, participantRole) => tools.addParticipant(name, participantRole),
              removeParticipant: name => tools.removeParticipant(name),
              getParticipants: async () => (await tools.getParticipants()).map(p => ({ id: p.id, name: p.name, type: p.type })),
              lookupPeers: tools.lookupPeers ? (page, size) => tools.lookupPeers!(page, size) : undefined,
            } });
          }),
        });
        this.agents.set(role, agent);
        await agent.start();
      }
    } catch { await this.stop(); throw new Error('Band crew connection failed. No provider error details or credentials were exposed.'); }
  }
  async stop() {
    const results = await Promise.allSettled([...this.agents.values()].map(agent => agent.stop()));
    this.agents.clear(); this.activeJob = null;
    if (results.some(result => result.status === 'rejected')) throw new Error('One or more Band agents did not confirm disconnection.');
  }
  /** Persist intent before every remote mutation; uncertain sends are never repeated automatically. */
  async dispatch(jobId: string, eventKey: string, update = false) {
    await this.start(jobId);
    await mkdir(this.directory, { recursive: true });
    const lock = await open(`${this.file}.lock`, 'wx').catch(() => { throw new Error('Band dispatch is busy; refresh its status.'); });
    try {
      await this.load();
      let room = this.rooms[jobId];
      const sender = this.agents.get('ScheduleReporter')!.runtime.link.rest;
      if (!room) {
        room = this.rooms[jobId] = { job_id: jobId, room_id: null, status: 'creating', events: {} };
        await this.save();
        const created = await sender.createChat(undefined, { maxRetries: 0, timeoutInSeconds: 15 });
        room.room_id = created.id;
        await this.save();
        const sdk = await import('@band-ai/sdk');
        const coordinator = sdk.loadAgentConfig('repair_coordinator', this.configPath);
        await sender.addChatParticipant(created.id, { participantId: coordinator.agentId, role: 'member' }, { maxRetries: 0, timeoutInSeconds: 15 });
        room.status = 'ready'; await this.save();
        await this.agents.get('RepairCoordinator')!.runtime.link.subscribeRoom(created.id);
      }
      if (!room.room_id || room.status !== 'ready') throw new Error('Band room setup has an uncertain outcome; review the saved room reference before retrying.');
      if (room.events[eventKey]) return { room_id: room.room_id, status: room.events[eventKey], duplicate: true };
      room.events[eventKey] = 'pending'; await this.save();
      const sdk = await import('@band-ai/sdk');
      const coordinator = sdk.loadAgentConfig('repair_coordinator', this.configPath);
      const content = encodeEnvelope(`${update ? 'Update' : 'Coordinate'} ${jobId}. Business actions are simulated; Excel is a real local file.`,
        update ? { kind: 'job_event', job_id: jobId, requested_by: 'ScheduleReporter', what: eventKey }
          : { kind: 'kickoff', job_id: jobId, requested_by: 'ScheduleReporter' });
      await sender.createChatMessage(room.room_id, { content, mentions: [{ id: coordinator.agentId, name: 'RepairCoordinator' }] }, { maxRetries: 0, timeoutInSeconds: 15 });
      room.events[eventKey] = 'confirmed'; await this.save();
      return { room_id: room.room_id, status: 'confirmed', duplicate: false };
    } catch (error) {
      if (error instanceof Error && /uncertain outcome/.test(error.message)) throw error;
      throw new Error('Band dispatch did not confirm success. Inspect the persisted room and pending event before retrying.');
    } finally { await lock.close(); await unlink(`${this.file}.lock`); }
  }
}
