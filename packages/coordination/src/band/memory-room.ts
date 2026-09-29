/**
 * An in-memory room for tests and the offline demo. It is a SIMULATED transport, not Band.
 * It follows Band's rules: an agent sees only messages that mention it, and only a
 * participant of the room can be mentioned.
 */
import type { CrewHandler } from './crew.js';
import type { RoomParticipant, RoomTools } from './protocol.js';

export interface RoomLogEntry {
  sequence: number;
  kind: 'message' | 'event' | 'joined' | 'left' | 'undelivered';
  sender: string;
  mentions: string[];
  content: string;
  message_type: string;
}

export interface MemoryRoom {
  readonly transport: 'simulated';
  readonly room_id: string;
  readonly log: RoomLogEntry[];
  /** Makes an agent reachable. It joins the room only when somebody adds it. */
  registerPeer(name: string, handler: CrewHandler): void;
  /** Adds a person or an agent to the room. */
  join(name: string): void;
  participants(): string[];
  /** Posts a message and runs the crew until nobody has anything left to do. */
  post(sender: string, content: string, mentions: string[]): Promise<void>;
}

export function createMemoryRoom(room_id = 'ROOM-SIMULATED', options: { max_participants?: number } = {}): MemoryRoom {
  const peers = new Map<string, CrewHandler>();
  const members = new Set<string>();
  const log: RoomLogEntry[] = [];
  const queue: { id: string; sender: string; content: string; target: string }[] = [];
  let sequence = 0;
  let draining = false;

  const record = (entry: Omit<RoomLogEntry, 'sequence'>) => {
    sequence += 1;
    log.push({ sequence, ...entry });
    return sequence;
  };

  const participantsOf = (): RoomParticipant[] =>
    [...members].map((name) => ({ id: name, name, type: peers.has(name) ? 'Agent' : 'User' }));

  function send(sender: string, content: string, mentions: string[]): void {
    const id = record({ kind: 'message', sender, mentions, content, message_type: 'text' });
    for (const target of mentions) {
      if (!members.has(target)) {
        record({ kind: 'undelivered', sender, mentions: [target], content: `${target} is not in the room.`, message_type: 'text' });
        continue;
      }
      if (peers.has(target)) queue.push({ id: `MSG-${id}`, sender, content, target });
    }
  }

  const toolsFor = (name: string): RoomTools => ({
    async sendMessage(content, mentions = []) {
      send(name, content, mentions);
      return { ok: true };
    },
    async sendEvent(content, messageType) {
      record({ kind: 'event', sender: name, mentions: [], content, message_type: messageType });
      return { ok: true };
    },
    async addParticipant(target) {
      if (!peers.has(target)) throw new Error(`Participant '${target}' not found.`);
      if (!members.has(target)) {
        if (options.max_participants !== undefined && members.size >= options.max_participants) {
          throw new Error('Participant limit reached for this chat room.');
        }
        members.add(target);
        record({ kind: 'joined', sender: name, mentions: [target], content: `${name} added ${target}.`, message_type: 'text' });
      }
      return { status: 'added' };
    },
    async removeParticipant(target) {
      if (members.delete(target)) {
        record({ kind: 'left', sender: name, mentions: [target], content: `${name} removed ${target}.`, message_type: 'text' });
      }
      return { status: 'removed' };
    },
    async getParticipants() {
      return participantsOf();
    },
    async lookupPeers() {
      return { data: [...peers.keys()].filter((peer) => !members.has(peer)).map((peer) => ({ id: peer, name: peer, type: 'Agent' })) };
    },
  });

  async function drain(): Promise<void> {
    if (draining) return;
    draining = true;
    try {
      for (let next = queue.shift(); next; next = queue.shift()) {
        const handler = peers.get(next.target);
        if (!handler) continue;
        await handler({
          message: { id: next.id, roomId: room_id, content: next.content, senderName: next.sender, senderType: peers.has(next.sender) ? 'Agent' : 'User' },
          tools: toolsFor(next.target),
        });
      }
    } finally {
      draining = false;
    }
  }

  return {
    transport: 'simulated',
    room_id,
    log,
    registerPeer(name, handler) {
      peers.set(name, handler);
    },
    join(name) {
      members.add(name);
    },
    participants: () => [...members],
    async post(sender, content, mentions) {
      send(sender, content, mentions);
      await drain();
    },
  };
}
