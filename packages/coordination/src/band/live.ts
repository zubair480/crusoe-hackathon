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
}

export interface LiveCrew {
  readonly transport: 'band';
  readonly roles: readonly BandRole[];
  stop(): Promise<void>;
}

export async function startBandCrew(options: LiveCrewOptions): Promise<LiveCrew> {
  const sdk = await import('@band-ai/sdk');
  const roles = options.roles ?? BAND_ROLES;
  // Read every credential first, so a missing one stops the start before anything connects.
  const configs = roles.map((role) => ({ role, config: sdk.loadAgentConfig(ROLE_CONFIG_KEYS[role], options.config_path) }));
  const agents: { stop(): Promise<unknown> }[] = [];
  for (const { role, config } of configs) {
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
          getParticipants: async () =>
            (await tools.getParticipants()).map((item) => ({ id: item.id, name: item.name, type: item.type })),
          lookupPeers: lookupPeers ? async (page, pageSize) => lookupPeers(page, pageSize) : undefined,
        },
      });
    });
    const agent = sdk.Agent.create({ adapter, config });
    await agent.start();
    agents.push(agent);
  }
  return {
    transport: 'band',
    roles,
    async stop() {
      for (const agent of agents) await agent.stop();
    },
  };
}
