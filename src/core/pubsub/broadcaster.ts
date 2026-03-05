import { logEvent } from '../../shared/helpers/log.helper';
type PublisherFn = (channel: string, message: string) => void | Promise<void>;
let publisher: PublisherFn | null = null;

export function setPublisher(fn: PublisherFn) {
  publisher = fn;
}

export async function publish(channel: string, message: string) {
  if (!publisher) {
    console.error('No publisher set - message dropped', channel, message);
    logEvent({ event: 'pubsub.publish.error', level: 'ERROR', source: 'system', data: { channel, reason: 'no_publisher_set' } });
    return;
  }

  try {
    await publisher(channel, message);
  } catch (err) {
    console.error('Publisher error', err);
    logEvent({ event: 'pubsub.publish.error', level: 'ERROR', source: 'system', data: { channel, error: err instanceof Error ? err.message : 'unknown' } });
  }
}

// Socket liveness tracker — used to detect dead host sockets
const activeSocketIds = new Set<string>();

export function trackSocketOpen(socketId: string) {
  activeSocketIds.add(socketId);
}

export function trackSocketClose(socketId: string) {
  activeSocketIds.delete(socketId);
}

export function isSocketAlive(socketId: string): boolean {
  return activeSocketIds.has(socketId);
}
