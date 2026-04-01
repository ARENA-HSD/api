/**
 * HSD Arena — HTTP Long-Polling Transport
 *
 * Provides a WebSocket-like interface over plain HTTP requests so that the
 * existing `games.service.ts` handlers (handleJoinRoom, handleSubmitAnswer, etc.)
 * work **identically** for polling clients.
 *
 * Three HTTP endpoints:
 *   POST  /poll/connect         — opens a polling session, returns { pollId }
 *   POST  /poll/send            — client → server message
 *   GET   /poll/receive/:pollId — server → client messages (long-poll, 25 s timeout)
 *
 * Internally each polling session gets a PollSocketAdapter that mimics the
 * Bun WebSocket object (`ws`). Messages destined for this client are queued
 * in a Redis list and drained by the /poll/receive endpoint.
 */

import { Elysia, t } from 'elysia';
import { redis } from '../../core/cache/repositories/game.repository';
import { publish, trackSocketOpen, trackSocketClose } from '../../core/pubsub/broadcaster';
import { logEvent } from '../../shared/helpers/log.helper';

// ============================================================================
// PollSocketAdapter — ws-compatible facade
// ============================================================================

const OUTBOX_TTL = 300;          // 5 min — stale outbox auto-cleanup
const SESSION_TTL = 3600;        // 1 hour
const LONG_POLL_TIMEOUT_S = 25;  // seconds to block on BRPOP

function outboxKey(pollId: string) { return `poll:${pollId}:outbox`; }
function metaKey(pollId: string)   { return `poll:${pollId}:meta`; }
function subsKey(pollId: string)   { return `poll:${pollId}:subs`; }

/**
 * Adapter that looks like a Bun WebSocket (`ws`) to games.service.ts.
 * - `send(msg)` → pushes to Redis outbox list
 * - `subscribe(ch)` → records the channel; a background listener forwards
 *    messages from that Redis channel into the outbox
 * - `publish(ch, msg)` → delegates to the global broadcaster
 * - `id`, `data`, `raw` — mimic ws properties
 */
export class PollSocketAdapter {
    public readonly id: string;
    public data: Record<string, any> = {};
    public raw: { headers: Record<string, string> } = { headers: {} };

    private pollId: string;

    constructor(pollId: string, socketId: string, headers: Record<string, string> = {}) {
        this.pollId = pollId;
        this.id = socketId;
        this.raw = { headers };
    }

    /** Push a message into the outbox (client will fetch via /poll/receive) */
    send(message: string): void {
        redis.lpush(outboxKey(this.pollId), message).catch(err => {
            console.error('PollSocketAdapter.send error:', err);
        });
        // Keep outbox alive
        redis.expire(outboxKey(this.pollId), OUTBOX_TTL).catch(() => {});
    }

    /** Record subscription — the receive endpoint handles channel forwarding */
    subscribe(channel: string): void {
        redis.sadd(subsKey(this.pollId), channel).catch(() => {});
        redis.expire(subsKey(this.pollId), SESSION_TTL).catch(() => {});
    }

    /** Delegate to global broadcaster */
    publish(channel: string, message: string): void {
        publish(channel, message);
    }

    unsubscribe(_channel: string): void {
        // no-op for polling — cleanup happens on session expiry
    }
}

// In-memory map of active polling adapters (per-process)
const activeAdapters = new Map<string, PollSocketAdapter>();

export function getAdapter(pollId: string): PollSocketAdapter | undefined {
    return activeAdapters.get(pollId);
}

// ============================================================================
// Redis Pub/Sub Forwarder
// ============================================================================

// Dedicated subscriber connection (ioredis requires separate client for subscribe mode)
let subClient: typeof redis | null = null;
const channelToPollIds = new Map<string, Set<string>>();

function getSubClient() {
    if (!subClient) {
        subClient = redis.duplicate();
        subClient.on('message', (channel: string, message: string) => {
            const pollIds = channelToPollIds.get(channel);
            if (!pollIds) return;
            for (const pollId of pollIds) {
                redis.lpush(outboxKey(pollId), message).catch(() => {});
                redis.expire(outboxKey(pollId), OUTBOX_TTL).catch(() => {});
            }
        });
    }
    return subClient;
}

async function subscribePollToChannel(pollId: string, channel: string): Promise<void> {
    const sub = getSubClient();
    if (!channelToPollIds.has(channel)) {
        channelToPollIds.set(channel, new Set());
        await sub.subscribe(channel);
    }
    channelToPollIds.get(channel)!.add(pollId);
}

function unsubscribePoll(pollId: string): void {
    for (const [channel, ids] of channelToPollIds.entries()) {
        ids.delete(pollId);
        if (ids.size === 0) {
            channelToPollIds.delete(channel);
            subClient?.unsubscribe(channel).catch(() => {});
        }
    }
}

// ============================================================================
// Message Router — re-uses index.ts switch/case logic
// ============================================================================

// Lazy import to avoid circular dependency
let GameService: any = null;
let handleSetNickname: any = null;

async function getGameService() {
    if (!GameService) {
        const mod = await import('../games/games.service');
        GameService = mod;
        handleSetNickname = mod.handleSetNickname;
    }
    return { GameService, handleSetNickname };
}

async function routeMessage(adapter: PollSocketAdapter, type: string, data: any): Promise<void> {
    const { GameService: GS, handleSetNickname: setNick } = await getGameService();

    switch (type) {
        case 'PING':
        case 'HEARTBEAT':
            adapter.send(JSON.stringify({ type: 'PONG', data: { ts: Date.now() } }));
            break;
        case 'JOIN_ROOM':
            await GS.handleJoinRoom(adapter, data);
            break;
        case 'SET_NICKNAME':
            await setNick(adapter, data);
            break;
        case 'RECONNECT':
            await GS.handleReconnect(adapter, data);
            break;
        case 'KICK_PLAYER':
            await GS.handleKickPlayer(adapter, data);
            break;
        case 'START_GAME':
            await GS.handleStartGame(adapter, data);
            break;
        case 'SUBMIT_ANSWER':
            await GS.handleSubmitAnswer(adapter, data);
            break;
        case 'SHOW_LEADERBOARD':
            await GS.handleShowLeaderboard(adapter, data);
            break;
        case 'NEXT_QUESTION':
            await GS.handleNextQuestion(adapter, data);
            break;
        default:
            adapter.send(JSON.stringify({ type: 'ERROR', data: { message: 'Unknown event type' } }));
    }
}

// ============================================================================
// Override PollSocketAdapter.subscribe to wire up Redis pub/sub forwarding
// ============================================================================

const origSubscribe = PollSocketAdapter.prototype.subscribe;
PollSocketAdapter.prototype.subscribe = function (channel: string) {
    origSubscribe.call(this, channel);
    // Wire up live forwarding
    subscribePollToChannel((this as any).pollId, channel).catch(() => {});
};

// ============================================================================
// Elysia Plugin
// ============================================================================

export const pollingRoutes = new Elysia({ prefix: '/poll' })

    // ---- POST /poll/connect ----
    .post('/connect', async ({ body, request }) => {
        const pollId = crypto.randomUUID();
        const socketId = `poll_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;

        // Extract headers for IP detection
        const headers: Record<string, string> = {};
        request.headers.forEach((value, key) => {
            headers[key.toLowerCase()] = value;
        });

        const adapter = new PollSocketAdapter(pollId, socketId, headers);
        activeAdapters.set(pollId, adapter);
        trackSocketOpen(socketId);

        // Store metadata in Redis
        await redis.hset(metaKey(pollId), {
            socketId,
            createdAt: Date.now().toString(),
            transport: 'polling',
        });
        await redis.expire(metaKey(pollId), SESSION_TTL);

        logEvent({
            event: 'poll.session.created',
            level: 'INFO',
            source: 'system',
            data: { pollId, socketId },
        });

        return { pollId, socketId };
    }, {
        body: t.Object({}),
    })

    // ---- POST /poll/send ----
    .post('/send', async ({ body }) => {
        const { pollId, type, data } = body as { pollId: string; type: string; data: any };

        const adapter = activeAdapters.get(pollId);
        if (!adapter) {
            return { error: 'Invalid or expired polling session' };
        }

        // Refresh session TTL
        redis.expire(metaKey(pollId), SESSION_TTL).catch(() => {});

        try {
            await routeMessage(adapter, type, data);
            return { ok: true };
        } catch (err) {
            console.error('Poll send error:', err);
            adapter.send(JSON.stringify({
                type: 'ERROR',
                data: { message: 'Internal server error' },
            }));
            return { ok: true }; // don't expose error to client
        }
    }, {
        body: t.Object({
            pollId: t.String(),
            type: t.String(),
            data: t.Any(),
        }),
    })

    // ---- GET /poll/receive/:pollId ----
    .get('/receive/:pollId', async ({ params }) => {
        const { pollId } = params;

        const adapter = activeAdapters.get(pollId);
        if (!adapter) {
            return { messages: [], expired: true };
        }

        // Refresh TTL
        redis.expire(metaKey(pollId), SESSION_TTL).catch(() => {});
        redis.expire(outboxKey(pollId), OUTBOX_TTL).catch(() => {});

        // Dedicated connection for blocking pop (BRPOP blocks the connection)
        const blockClient = redis.duplicate();

        try {
            const messages: any[] = [];

            // First, drain any already-queued messages (non-blocking)
            let item: string | null;
            do {
                item = await redis.rpop(outboxKey(pollId));
                if (item) {
                    try { messages.push(JSON.parse(item)); } catch { messages.push(item); }
                }
            } while (item);

            // If we got messages, return immediately
            if (messages.length > 0) {
                await blockClient.quit();
                return { messages };
            }

            // Otherwise, long-poll: block up to LONG_POLL_TIMEOUT_S seconds
            const result = await blockClient.brpop(outboxKey(pollId), LONG_POLL_TIMEOUT_S);
            await blockClient.quit();

            if (result) {
                const [, value] = result;
                try { messages.push(JSON.parse(value)); } catch { messages.push(value); }

                // Drain any additional messages that arrived
                let extra: string | null;
                do {
                    extra = await redis.rpop(outboxKey(pollId));
                    if (extra) {
                        try { messages.push(JSON.parse(extra)); } catch { messages.push(extra); }
                    }
                } while (extra);
            }

            return { messages };
        } catch (err) {
            await blockClient.quit().catch(() => {});
            console.error('Poll receive error:', err);
            return { messages: [] };
        }
    }, {
        params: t.Object({
            pollId: t.String(),
        }),
    })

    // ---- POST /poll/disconnect ----
    .post('/disconnect', async ({ body }) => {
        const { pollId } = body as { pollId: string };
        const adapter = activeAdapters.get(pollId);
        if (adapter) {
            trackSocketClose(adapter.id);
            unsubscribePoll(pollId);
            activeAdapters.delete(pollId);

            // Clean up Redis
            await redis.del(metaKey(pollId), outboxKey(pollId), subsKey(pollId)).catch(() => {});

            logEvent({
                event: 'poll.session.closed',
                level: 'INFO',
                source: 'system',
                data: { pollId, socketId: adapter.id },
            });
        }
        return { ok: true };
    }, {
        body: t.Object({
            pollId: t.String(),
        }),
    });
