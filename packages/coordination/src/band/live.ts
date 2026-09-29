/**
 * Runs the crew on Band. Needs `@band-ai/sdk` (Node.js 22.12 or newer) and one registered
 * Band agent per role in `agent_config.yaml`. Each agent gets its own connection.
 */
import { createCrewHandler, type CrewDeps } from './crew.js';
import { BAND_ROLES, ROLE_CONFIG_KEYS, type BandRole } from './protocol.js';

export interface LiveCrewOptions extends CrewDeps {
  /** Defaults to `./agent_config.yaml`. The file holds API keys and must stay out of git. */
  config_path?: string;
  roles?: readonly BandRole[];
  /** How often each agent's connection is checked. Defaults to 15 seconds. */
  supervise_every_ms?: number;
  /** Called when an agent is found stopped or has been reconnected. */
  onNotice?: (notice: string) => void;
}

export interface LiveCrew {
  readonly transport: 'band';
  readonly roles: readonly BandRole[];
  /** Connection state of each agent as the SDK reports it. */
  states(): Record<string, string>;
  stop(): Promise<void>;
}

export async function startBandCrew(options: LiveCrewOptions): Promise<LiveCrew> {
  const sdk = await import('@band-ai/sdk');
  const core = await import('@band-ai/sdk/core');
  // BAND_DEBUG=1 prints what the SDK does, which helps when an agent stays silent.
  const logger = process.env.BAND_DEBUG ? new core.ConsoleLogger() : undefined;
  const roles = options.roles ?? BAND_ROLES;
  // Read every credential first, so a missing one stops the start before anything connects.
  const configs = roles.map((role) => ({ role, config: sdk.loadAgentConfig(ROLE_CONFIG_KEYS[role], options.config_path) }));
  type Live = InstanceType<typeof sdk.Agent>;
  const agents = new Map<BandRole, Live>();
  const create = (role: BandRole, config: (typeof configs)[number]['config']): Live => {
    const handler = createCrewHandler(role, options);
    const adapter = new sdk.GenericAdapter(async ({ message, tools }) => {
      const lookupPeers = tools.lookupPeers?.bind(tools);
      await handler({
        message: {
          id: message.id,
          roomId: message.roomId,
          content: message.content,
          senderName: message.senderName,
          senderType: message.senderType,
        },
        tools: {
          sendMessage: (content, mentions) => tools.sendMessage(content, mentions),
          sendEvent: (content, messageType, metadata) => tools.sendEvent(content, messageType, metadata),
          addParticipant: (name, participantRole) => tools.addParticipant(name, participantRole),
          removeParticipant: (name) => tools.removeParticipant(name),
          getParticipants: async () =>
            (await tools.getParticipants()).map((item) => ({ id: item.id, name: item.name, type: item.type })),
          lookupPeers: lookupPeers ? async (page, pageSize) => lookupPeers(page, pageSize) : undefined,
        },
      });
    });
    return sdk.Agent.create({
      adapter,
      config,
      // A restarted agent must rejoin the rooms it already belongs to, or it stays silent.
      agentConfig: { autoSubscribeExistingRooms: true },
      ...(logger ? { logger } : {}),
    });
  };

  for (const { role, config } of configs) {
    const agent = create(role, config);
    await agent.start();
    agents.set(role, agent);
  }

  // An agent whose connection ended is replaced. The timer also keeps the process alive, so
  // the crew cannot exit quietly while it is meant to be listening.
  let stopping = false;
  let checking = false;
  const notice = options.onNotice ?? (() => undefined);
  const timer = setInterval(async () => {
    if (stopping || checking) return;
    checking = true;
    try {
      for (const { role, config } of configs) {
        const status = agents.get(role)?.state.status ?? 'missing';
        if (status === 'running' || status === 'starting') continue;
        notice(`${role} is ${status}; reconnecting.`);
        try {
          await agents.get(role)?.stop().catch(() => undefined);
          const agent = create(role, config);
          await agent.start();
          agents.set(role, agent);
          notice(`${role} is connected again.`);
        } catch (error) {
          notice(`${role} could not reconnect: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    } finally {
      checking = false;
    }
  }, options.supervise_every_ms ?? 15_000);

  return {
    transport: 'band',
    roles,
    states: () => Object.fromEntries([...agents].map(([role, agent]) => [role, agent.state.status])),
    async stop() {
      stopping = true;
      clearInterval(timer);
      for (const agent of agents.values()) await agent.stop();
    },
  };
}
