import { RedisClient } from "bun";
import { Elysia } from "elysia";
import { db, schema } from "./core/database/client";
import { openapi } from "@elysiajs/openapi";
import { gamesRoutes } from "./modules/games/games.controller";
import { usersRoutes } from "./modules/users/users.controller";
import { orgRoutes } from "./modules/organizations/organizations.controller";
import { questionsRoutes } from "./modules/questions/questions.controller";
import { quizzesRoutes } from "./modules/quizzes/quizzes.controller";
import { loginRoutes } from "./modules/auth/auth.controller";
import { invitationsRoutes } from "./modules/invitations/invitations.controller";
import { cleanupExpiredInvitations } from "./modules/invitations/invitations.service";
import { cors } from '@elysiajs/cors';
import * as GamesHelper from './core/cache/repositories/game.repository';
import * as GameService from './modules/games/games.service';
import { register, httpRequestsTotal, httpRequestDurationSeconds } from "./lib/metrics";
import { logEvent } from "./shared/helpers/log.helper";
import { trackSocketOpen, trackSocketClose } from './core/pubsub/broadcaster';
import { rateLimit } from 'elysia-rate-limit';
import { handleSetNickname } from './modules/games/games.service';

// ✅ Environment Variable Validation
const requiredEnvVars = ['DATABASE_URL', 'REDIS_URL', 'JWT_SECRET'];

console.log('🔍 Validating environment variables...');

const missingVars: string[] = [];
for (const varName of requiredEnvVars) {
  if (!process.env[varName]) {
    missingVars.push(varName);
  }
}

if (missingVars.length > 0) {
  console.error('❌ Missing required environment variables:');
  missingVars.forEach(v => console.error(`   - ${v}`));
  console.error('\n💡 Please check your .env file');
  process.exit(1);
}

console.log('✅ All required environment variables present');

// Optional variables with defaults
const optionalEnvVars: Record<string, string> = {
  PORT: '3000',
  NODE_ENV: 'development',
  LOG_LEVEL: 'info'
};

console.log('ℹ️  Optional environment variables:');
for (const [key, defaultValue] of Object.entries(optionalEnvVars)) {
  const value = process.env[key] || defaultValue;
  console.log(`   - ${key}: ${value}${!process.env[key] ? ' (default)' : ''}`);

  if (!process.env[key]) {
    process.env[key] = defaultValue;
  }
}

const redisClient = new RedisClient();

// Track active websocket connections for server-level publishing
const activeSockets = new Set<any>();

const app = new Elysia({
  serve: {
    maxRequestBodySize: 1024 * 100, // 100KB payload limiti
  },
})
  .derive(() => {
    return {
      startTime: process.hrtime()
    }
  })
  .onAfterResponse(({ request, set, path, startTime }) => {
    if (startTime) {
      const diff = process.hrtime(startTime);
      const durationSeconds = (diff[0] * 1e9 + diff[1]) / 1e9;

      const statusCode = set.status ? String(set.status) : '200';
      const method = request.method;

      httpRequestDurationSeconds.labels(method, path, statusCode).observe(durationSeconds);
      httpRequestsTotal.labels(method, path, statusCode).inc();
    }
  })
  .get("/metrics", async ({ set }) => {
    set.headers["Content-Type"] = register.contentType;
    return await register.metrics();
  })
  .use(openapi({
    documentation: {
      info: {
        title: "ARENA API",
        version: "1.0.0",
        description: "API documentation for the ARENA application."
      },
      tags: [
        { name: 'User Operations', description: 'User related endpoints' },
        { name: 'Auth Operations', description: 'Authentication and login endpoints' },
        { name: 'Organization Operations', description: 'Organization related endpoints' },
        { name: 'Quiz Operations', description: 'Quiz related endpoints' },
        { name: 'Question Operations', description: 'Question related endpoints' },
        { name: 'Game Operations', description: 'Game related endpoints' },
        { name: 'Invitation Operations', description: 'Invitation related endpoints' },
      ],
      components: {
        securitySchemes: {
          BearerAuth: {
            type: 'http',
            scheme: 'bearer',
            bearerFormat: 'JWT',
            description: 'Login endpoint\'inden token alıp buraya yapıştır. Korumalı endpoint\'ler için gerekli.'
          }
        }
      }
      // Global security kaldırıldı - her endpoint kendi belirleyecek

    },
  }))
  .use(
    new Elysia()
      .use(loginRoutes)
      .use(usersRoutes)
      .use(quizzesRoutes)
      .use(questionsRoutes)
      .use(invitationsRoutes)
      .post('/rate-limit', () => {
        return 'Rate limit test';
      })
      .use(rateLimit({
        duration: 60 * 1000, // 60 seconds
        max: 50, // 50 requests per minute
      }))
      .use(orgRoutes)
      .use(gamesRoutes)
      .post('/rate-limit', () => {
        return 'Rate limit test';
      })
  )
  .get("/", () => { return "API is working."; }, { detail: { summary: 'Main endpoint' } })
  .get("/db-health", async () => {
    const timestamp = new Date().toISOString();

    let databaseStatus: "connected" | "disconnected" = "connected";
    let databaseError: string | undefined;
    try {
      await db.select().from(schema.organizations).limit(1);
    } catch (error) {
      databaseStatus = "disconnected";
      databaseError = error instanceof Error ? error.message : "Unknown error";
      logEvent({ event: 'db.connection.failed', level: 'CRITICAL', source: 'system', data: { error: databaseError } });
    }

    let redisStatus: "connected" | "disconnected" | "error" = "connected";
    let redisError: string | undefined;
    try {
      if (!redisClient.connected) {
        await redisClient.connect();
      }
      const pong = await redisClient.send("PING", []);
      if (pong !== "PONG") {
        redisStatus = "error";
        redisError = `Unexpected PING response: ${String(pong)}`;
      }
    } catch (error) {
      redisStatus = "disconnected";
      redisError = error instanceof Error ? error.message : "Unknown error";
      logEvent({ event: 'redis.connection.failed', level: 'CRITICAL', source: 'system', data: { error: redisError } });
    }

    const status = databaseStatus === "connected" && redisStatus === "connected" ? "healthy" : "error";

    return {
      status,
      database: databaseStatus,
      redis: redisStatus,
      ...(databaseError ? { databaseError } : {}),
      ...(redisError ? { redisError } : {}),
      timestamp,
    };
  }, {
    detail: { summary: 'Database health check endpoint' }
  })
  .ws('/ws', {
    async open(ws) {
      console.log('WebSocket connected:', ws.id);
      // Add to active sockets
      activeSockets.add(ws);
      // Track socket ID for liveness checks (synchronous — no await)
      trackSocketOpen(ws.id);
    },

    async message(ws, message: any) {
      try {
        const event = typeof message === 'string' ? JSON.parse(message) : message;
        const type = event.type;
        const data = event.data;

        switch (type) {
          case 'JOIN_ROOM':
            await GameService.handleJoinRoom(ws, data);
            break;
          case 'SET_NICKNAME':
            await handleSetNickname(ws, data);
            break;
          case 'RECONNECT':
            await GameService.handleReconnect(ws, data);
            break;
          case 'KICK_PLAYER':
            await GameService.handleKickPlayer(ws, data);
            break;
          case 'START_GAME':
            await GameService.handleStartGame(ws, data);
            break;
          case 'SUBMIT_ANSWER':
            await GameService.handleSubmitAnswer(ws, data);
            break;
          case 'SHOW_LEADERBOARD':
            await GameService.handleShowLeaderboard(ws, data);
            break;
          case 'NEXT_QUESTION':
            await GameService.handleNextQuestion(ws, data);
            break;
          default:
            logEvent({ event: 'ws.unknown_event', level: 'WARNING', source: 'code', data: { type, socketId: ws.id } });
            ws.send(JSON.stringify({
              type: 'ERROR',
              data: { message: 'Unknown event type' },
            }));
        }
      } catch (error) {
        console.error('WebSocket message error:', error);
        logEvent({ event: 'ws.parse.error', level: 'ERROR', source: 'code', data: { error: error instanceof Error ? error.message : 'unknown', socketId: ws.id } });
        ws.send(JSON.stringify({
          type: 'ERROR',
          data: { message: 'Internal server error' },
        }));
      }
    },

    async close(ws) {
      const socketId = ws.id;
      const metadata = ws.data as any;

      console.log('WebSocket disconnected:', socketId);

      // Remove from active sockets so we don't publish to closed sockets
      try {
        activeSockets.delete(ws);
        // Track socket close synchronously — no await, no race
        trackSocketClose(socketId);
      } catch (err) {
        // ignore
      }

      // ws.data contains pin if player joined a game
      if (metadata?.pin) {
        const pin = metadata.pin;

        try {
          const gameState = await GamesHelper.getGameState(pin);
          if (!gameState) return;

          const isHost = gameState.hostSocketId === socketId;
          const sessionToken = isHost
            ? gameState.hostSessionToken
            : await GamesHelper.getSessionBySocket(pin, socketId);

          if (isHost) {
            // Clear hostSocketId so host can reconnect via RECONNECT or JOIN_ROOM
            await GamesHelper.updateGameState(pin, { hostSocketId: '' });
            console.log(`Host disconnected, cleared hostSocketId for pin=${pin}`);

            // Start grace period for host (don't wipe hostSessionToken yet)
            if (sessionToken) {
              GameService.startDisconnectGracePeriod(pin, socketId, sessionToken);
            }
            return;
          }

          // PLAYER disconnect
          const playerInfo = await GamesHelper.getPlayerInfo(pin, socketId);
          if (!playerInfo) return;

          if (gameState.status === 'ACTIVE' && sessionToken) {
            // ACTIVE game: don't remove player — mark as disconnected, start grace period
            await GamesHelper.markPlayerDisconnected(pin, socketId);
            GameService.startDisconnectGracePeriod(pin, socketId, sessionToken);

            console.log(`Player disconnected during active game ${pin}: ${playerInfo.nickname} (grace period started)`);
            logEvent({ event: 'game.player.disconnected', level: 'WARNING', source: 'code', data: { pin, socketId, nickname: playerInfo.nickname } });

            // Notify host
            try {
              const { publish } = await import('./core/pubsub/broadcaster');
              await publish(`game:${pin}:host`, JSON.stringify({
                type: 'PLAYER_DISCONNECTED',
                data: { nickname: playerInfo.nickname },
              }));
            } catch (err) {
              console.error('Failed to publish PLAYER_DISCONNECTED', err);
            }
          } else {
            // LOBBY or FINISHED or no session: immediate cleanup
            const result = await GamesHelper.handlePlayerDisconnect(pin, socketId);
            if (sessionToken) {
              await GamesHelper.removeSession(pin, sessionToken, socketId);
            }

            if (result.success && result.shouldBroadcast && result.state?.status === 'LOBBY') {
              const recentPlayers = await GamesHelper.getRecentPlayers(pin, 28);
              try {
                const { publish } = await import('./core/pubsub/broadcaster');
                const updatedState = await GamesHelper.getGameState(pin);
                await publish(`game:${pin}:host`, JSON.stringify({
                  type: 'LOBBY_UPDATE',
                  data: {
                    count: updatedState ? updatedState.totalPlayers : (result.state.totalPlayers - 1),
                    recentPlayers
                  }
                }));
              } catch (err) {
                console.error('Failed to publish LOBBY_UPDATE on disconnect', err);
              }
            }
          }
        } catch (error) {
          console.error('WebSocket close error:', error);
        }
      }
    },
  })
  .use(cors({
    origin: [/^https?:\/\/(.*?\.)?localhost:\d+$/, "https://efe.efehidir.tr"],
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Upgrade', 'Connection', 'x-organization-domain'],
    credentials: true
  }))
  ;

// Expose server instance for service-level publishes used in games.service
app.listen(3000);

import('./core/pubsub/broadcaster').then(({ setPublisher }) => {
  setPublisher(async (channel: string, message: string) => {
    app.server?.publish(channel, message);
  });
}).catch(err => {
  console.error('Failed to set publisher', err);
  logEvent({ event: 'ws.publisher.error', level: 'CRITICAL', source: 'system', data: { error: err instanceof Error ? err.message : 'unknown' } });
});

console.log(
  `🦊 Elysia is running at ${app.server?.hostname}:${app.server?.port}`
);

// Her saat suresi dolmus davetleri temizle
setInterval(async () => {
  const count = await cleanupExpiredInvitations();
  if (count > 0) console.log(`🧹 ${count} expired invitation(s) cleaned up`);
}, 60 * 60 * 1000);
cleanupExpiredInvitations();
