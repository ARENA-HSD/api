
// GAMES CONTROLLER


import { Elysia, t } from 'elysia';
import bearer from '@elysiajs/bearer';
import jwtPlugin from '@elysiajs/jwt';
import * as GamesHelper from '../../core/cache/repositories/game.repository';
import * as GameService from './games.service';
import { jwtConfig } from '../../middleware/auth.middleware';
import { getUserRoleInOrg, hasQuizPermission } from '../../middleware/rbac.middleware';
import { db, schema } from '../../core/database/client';
import { eq } from 'drizzle-orm';
import type {
  CreateGameRequest,
  CreateGameResponse,
  GameSummaryResponse,
} from './games.types';


// ELYSIA APP WITH HTTP + WEBSOCKET


export const gamesRoutes = new Elysia({ prefix: '/games' })
  // JWT Middleware
  .use(bearer())
  .use(jwtPlugin({ name: 'jwt', secret: jwtConfig.secret }))

  // HTTP ENDPOINTS


  /**
   * POST /games - Create a new game
   */
  .post(
    '/',
    async ({ body, set, bearer, jwt }): Promise<CreateGameResponse> => {
      try {
        // Verify JWT
        if (!bearer) {
          set.status = 401;
          return { success: false, gameId: '', pin: '', mode: 'PERSONAL', message: 'Bearer token required' };
        }

        const payload = await jwt.verify(bearer);
        if (!payload || !payload.sub) {
          set.status = 401;
          return { success: false, gameId: '', pin: '', mode: 'PERSONAL', message: 'Invalid token' };
        }

        const userId = payload.sub as string;
        const { quizId } = body as CreateGameRequest;

        // RBAC: Quiz'in ait oldugu org'da kullanicinin yetkisi var mi?
        const quiz = await db.query.quizzes.findFirst({
          where: eq(schema.quizzes.id, quizId),
          columns: { orgId: true },
        });

        if (!quiz) {
          set.status = 404;
          return { success: false, gameId: '', pin: '', mode: 'PERSONAL', message: 'Quiz not found' };
        }

        const userRole = await getUserRoleInOrg(userId, quiz.orgId);
        if (!hasQuizPermission(userRole)) {
          set.status = 403;
          return { success: false, gameId: '', pin: '', mode: 'PERSONAL', message: 'Insufficient permissions' };
        }

        const result = await GameService.createGame(quizId);

        set.status = result.status;
        return {
          success: result.success,
          gameId: result.gameId,
          pin: result.pin,
          mode: result.mode,
        };
      } catch (error) {
        console.error('Create game error:', error);
        set.status = 500;
        return {
          success: false,
          gameId: '',
          pin: '',
          mode: 'PERSONAL',
        };
      }
    },
    {
      body: t.Object({
        quizId: t.String(),
      }),
      response: t.Object({
        success: t.Boolean(),
        gameId: t.String(),
        pin: t.String(),
        mode: t.String(),
        message: t.Optional(t.String()),
      }),
      detail: {
        summary: 'Create a new game session',
        tags: ['Game Operations'],
        security: [{ BearerAuth: [] }],
      },
    }
  )

  /**
   * GET /games/:id - Get game summary
   */
  .get(
    '/:id',
    async ({ params, set, bearer, jwt }): Promise<GameSummaryResponse> => {
      try {
        // Verify JWT
        if (!bearer) {
          set.status = 401;
          return { success: false, status: 'FINISHED', totalPlayers: 0, message: 'Bearer token required' };
        }

        const payload = await jwt.verify(bearer);
        if (!payload || !payload.sub) {
          set.status = 401;
          return { success: false, status: 'FINISHED', totalPlayers: 0, message: 'Invalid token' };
        }

        const userId = payload.sub as string;
        const { id: pin } = params;
        const state = await GamesHelper.getGameState(pin);

        if (!state) {
          set.status = 404;
          return { success: false, status: 'FINISHED', totalPlayers: 0 };
        }

        // RBAC: Quiz'in ait oldugu org'da kullanicinin yetkisi var mi?
        const quiz = await db.query.quizzes.findFirst({
          where: eq(schema.quizzes.id, state.quizId),
          columns: { orgId: true },
        });

        if (!quiz) {
          set.status = 404;
          return { success: false, status: 'FINISHED', totalPlayers: 0, message: 'Quiz not found' };
        }

        const userRole = await getUserRoleInOrg(userId, quiz.orgId);
        if (!hasQuizPermission(userRole)) {
          set.status = 403;
          return { success: false, status: 'FINISHED', totalPlayers: 0, message: 'Insufficient permissions' };
        }

        const leaderboard = await GamesHelper.getLeaderboard(pin, 100);

        return {
          success: true,
          status: state.status,
          totalPlayers: state.totalPlayers,
          winner: leaderboard[0]?.nickname,
          finalScores: leaderboard,
        };
      } catch (error) {
        console.error('Get game error:', error);
        set.status = 500;
        return { success: false, status: 'FINISHED', totalPlayers: 0 };
      }
    },
    {
      response: t.Object({
        success: t.Boolean(),
        status: t.String(),
        totalPlayers: t.Number(),
        winner: t.Optional(t.String()),
        finalScores: t.Optional(t.Any()),
        message: t.Optional(t.String()),
      }),
      detail: {
        summary: 'Get game summary',
        tags: ['Game Operations'],
        security: [{ BearerAuth: [] }],
      },
    }
  )

  /**
   * DELETE /games/:id - End game and cleanup
   */
  .delete(
    '/:id',
    async ({ headers,  params, set, bearer, jwt  }) => {
      try {
        // Verify JWT
        if (!bearer) {
          set.status = 401;
          return { success: false, message: 'Bearer token required' };
        }

        const payload = await jwt.verify(bearer);
        if (!payload || !payload.sub) {
          set.status = 401;
          return { success: false, message: 'Invalid token' };
        }

        const userId = payload.sub as string;
        const { id: pin } = params;
        const state = await GamesHelper.getGameState(pin);

        if (!state) {
          set.status = 404;
          return { success: false };
        }

        // RBAC: Quiz'in ait oldugu org'da kullanicinin yetkisi var mi?
        const quiz = await db.query.quizzes.findFirst({
          where: eq(schema.quizzes.id, state.quizId),
          columns: { orgId: true },
        });

        if (!quiz) {
          set.status = 404;
          return { success: false, message: 'Quiz not found' };
        }

        const userRole = await getUserRoleInOrg(userId, quiz.orgId);
        if (!hasQuizPermission(userRole)) {
          set.status = 403;
          return { success: false, message: 'Insufficient permissions' };
        }

        await GamesHelper.cleanupGame(pin);
        return { success: true };
      } catch (error) {
        console.error('Delete game error:', error);
        set.status = 500;
        return { success: false };
      }
    },
    {
      response: t.Object({
        success: t.Boolean(),
        message: t.Optional(t.String()),
      }),
      detail: {
        summary: 'Delete game and cleanup',
        tags: ['Game Operations'],
        security: [{ BearerAuth: [] }],
      },
    }
  );