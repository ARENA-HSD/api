
// QUIZZES CONTROLLER
// Routes, Validation & JWT Middleware


import { Elysia, t } from 'elysia';
import bearer from '@elysiajs/bearer';
import jwtPlugin from '@elysiajs/jwt';
import * as quizService from './quizzes.service';
import { jwtConfig } from '../../middleware/auth.middleware';
import { logEvent } from '../../shared/helpers/log.helper';


// ELYSIA ROUTES


export const quizzesRoutes = new Elysia({ prefix: '/org/:orgDomain/quizzes' })
  // JWT Middleware
  .use(bearer())
  .use(jwtPlugin({ name: 'jwt', secret: jwtConfig.secret }))


  // QUIZ ENDPOINTS


  /**
   * POST /org/:orgDomain/quizzes
   * Create a new quiz
   */
  .post(
    '/',
    async ({ params, body, bearer, jwt, set }) => {
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

        // Call service
        const result = await quizService.createQuiz(
          params.orgDomain,
          body,
          userId
        );

        set.status = result.status;
        if (result.status === 403) {
          logEvent({ event: 'quiz.access.denied', level: 'WARNING', source: 'code', data: { orgDomain: params.orgDomain } });
        }
        return result;

      } catch (error) {
        console.error('Create quiz error:', error);
        set.status = 500;
        logEvent({ event: 'quiz.db.error', level: 'ERROR', source: 'system', data: { error: error instanceof Error ? error.message : 'unknown' } });
        return { success: false, message: 'Internal server error' };
      }
    },
    {
      body: t.Object({
        title: t.String({ minLength: 3, maxLength: 100 }), // PDF requirement: min 3 chars, max 100
        defaultMode: t.Union([t.Literal('PERSONAL'), t.Literal('STAGE')]),
      }),
      response: t.Object({
        success: t.Boolean(),
        data: t.Optional(t.Any()),
        message: t.Optional(t.String()),
      }),
      detail: {
        summary: 'Create a new quiz',
        tags: ['Quiz Operations'],
        security: [{ BearerAuth: [] }],
        description: 'Creates a new quiz in the specified organization. Requires MANAGER role or higher.',
        responses: {
          201: { description: 'Quiz created successfully', content: { 'application/json': {} } },
          400: { description: 'Validation error', content: { 'application/json': {} } },
          401: { description: 'Unauthorized', content: { 'application/json': {} } },
          403: { description: 'Forbidden - Insufficient permissions', content: { 'application/json': {} } },
          404: { description: 'Organization not found', content: { 'application/json': {} } },
          500: { description: 'Internal server error', content: { 'application/json': {} } },
        },
      },
    }
  )

  /**
   * GET /org/:orgDomain/quizzes
   * List all quizzes in organization
   */
  .get(
    '/',
    async ({ params, bearer, jwt, set }) => {
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

        // Call service
        const result = await quizService.listQuizzes(params.orgDomain, userId);

        set.status = result.status;
        if (result.success) {
          return {
            success: result.success,
            data: result.data,
          };
        } else {
          return {
            success: result.success,
            message: result.message,
          };
        }
      } catch (error) {
        console.error('List quizzes error:', error);
        set.status = 500;
        logEvent({ event: 'quiz.db.error', level: 'ERROR', source: 'system', data: { error: error instanceof Error ? error.message : 'unknown' } });
        return { success: false, message: 'Internal server error' };
      }
    },
    {
      response: t.Object({
        success: t.Boolean(),
        data: t.Optional(t.Any()),
        message: t.Optional(t.String()),
      }),
      detail: {
        summary: 'Get all quizzes in organization',
        tags: ['Quiz Operations'],
        security: [{ BearerAuth: [] }],
        description: 'Lists all active quizzes for the organization. Ordered by creation date descending.',
        responses: {
          200: { description: 'List of quizzes', content: { 'application/json': {} } },
          401: { description: 'Unauthorized', content: { 'application/json': {} } },
          403: { description: 'Forbidden', content: { 'application/json': {} } },
          404: { description: 'Organization not found', content: { 'application/json': {} } },
        },
      },
    }
  )

  /**
   * GET /org/:orgDomain/quizzes/:quizId
   * Get quiz by ID with questions
   */
  .get(
    '/:quizId',
    async ({ params, bearer, jwt, set }) => {
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

        // Call service
        const result = await quizService.getQuizById(
          params.orgDomain,
          params.quizId,
          userId
        );

        set.status = result.status;
        return {
          success: result.success,
          data: result.data,
          message: result.message,
        };
      } catch (error) {
        console.error('Get quiz error:', error);
        set.status = 500;
        logEvent({ event: 'quiz.db.error', level: 'ERROR', source: 'system', data: { error: error instanceof Error ? error.message : 'unknown' } });
        return { success: false, message: 'Internal server error' };
      }
    },
    {
      response: t.Object({
        success: t.Boolean(),
        data: t.Optional(t.Any()),
        message: t.Optional(t.String()),
      }),
      detail: {
        summary: 'Get quiz by ID with questions',
        tags: ['Quiz Operations'],
        security: [{ BearerAuth: [] }],
        description: 'Retrieves detailed quiz information including all questions ordered by index.',
        responses: {
          200: { description: 'Quiz details', content: { 'application/json': {} } },
          401: { description: 'Unauthorized', content: { 'application/json': {} } },
          403: { description: 'Forbidden', content: { 'application/json': {} } },
          404: { description: 'Quiz or Organization not found', content: { 'application/json': {} } },
        },
      },
    }
  )

  /**
   * PATCH /org/:orgDomain/quizzes/:quizId
   * Update quiz
   */
  .patch(
    '/:quizId',
    async ({ params, body, bearer, jwt, set }) => {
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

        // Call service
        const result = await quizService.updateQuiz(
          params.orgDomain,
          params.quizId,
          body,
          userId
        );

        set.status = result.status;
        return {
          success: result.success,
          data: result.data,
          message: result.message,
        };
      } catch (error) {
        console.error('Update quiz error:', error);
        set.status = 500;
        logEvent({ event: 'quiz.db.error', level: 'ERROR', source: 'system', data: { error: error instanceof Error ? error.message : 'unknown' } });
        return { success: false, message: 'Internal server error' };
      }
    },
    {
      body: t.Object({
        title: t.Optional(t.String({ minLength: 3 })), // PDF requirement
        defaultMode: t.Optional(t.Union([t.Literal('PERSONAL'), t.Literal('STAGE')])),
      }),
      response: t.Object({
        success: t.Boolean(),
        data: t.Optional(t.Any()),
        message: t.Optional(t.String()),
      }),
      detail: {
        summary: 'Update quiz',
        tags: ['Quiz Operations'],
        security: [{ BearerAuth: [] }],
        description: 'Updates quiz title or default mode. Only provided fields are updated.',
        responses: {
          200: { description: 'Quiz updated', content: { 'application/json': {} } },
          400: { description: 'Validation error', content: { 'application/json': {} } },
          401: { description: 'Unauthorized', content: { 'application/json': {} } },
          403: { description: 'Forbidden', content: { 'application/json': {} } },
          404: { description: 'Quiz or Organization not found', content: { 'application/json': {} } },
        },
      },
    }
  )

  /**
   * DELETE /org/:orgDomain/quizzes/:quizId
   * Delete quiz (soft delete)
   */
  .delete(
    '/:quizId',
    async ({ params, bearer, jwt, set }) => {
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

        // Call service
        const result = await quizService.deleteQuiz(
          params.orgDomain,
          params.quizId,
          userId
        );

        set.status = result.status;
        if (result.success && 'data' in result) {
          return { success: true, data: result.data };
        }
        return { success: false, message: result.message };
      } catch (error) {
        console.error('Delete quiz error:', error);
        set.status = 500;
        logEvent({ event: 'quiz.db.error', level: 'ERROR', source: 'system', data: { error: error instanceof Error ? error.message : 'unknown' } });
        return { success: false, message: 'Internal server error' };
      }
    },
    {
      response: t.Object({
        success: t.Boolean(),
        data: t.Optional(t.Any()),
        message: t.Optional(t.String()),
      }),
      detail: {
        summary: 'Delete quiz (soft delete)',
        tags: ['Quiz Operations'],
        security: [{ BearerAuth: [] }],
        description: 'Soft deletes a quiz by setting isDeleted=true. Questions remain in DB.',
        responses: {
          200: { description: 'Quiz deleted', content: { 'application/json': {} } },
          401: { description: 'Unauthorized', content: { 'application/json': {} } },
          403: { description: 'Forbidden', content: { 'application/json': {} } },
          404: { description: 'Quiz or Organization not found', content: { 'application/json': {} } },
        },
      },
    }
  )

  /**
   * GET /org/:orgDomain/quizzes/:quizId/export
   * Export quiz to JSON
   */
  .get(
    '/:quizId/export',
    async ({ params, bearer, jwt, set }) => {
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

        // Call service
        const result = await quizService.exportQuiz(
          params.orgDomain,
          params.quizId,
          userId
        );

        set.status = result.status;
        return {
          success: result.success,
          data: 'data' in result ? result.data : undefined,
          message: result.message,
        };
      } catch (error) {
        console.error('Export quiz error:', error);
        set.status = 500;
        logEvent({ event: 'quiz.db.error', level: 'ERROR', source: 'system', data: { error: error instanceof Error ? error.message : 'unknown' } });
        return { success: false, message: 'Internal server error' };
      }
    },
    {
      response: t.Object({
        success: t.Boolean(),
        data: t.Optional(t.Any()),
        message: t.Optional(t.String()),
      }),
      detail: {
        summary: 'Export quiz to JSON',
        tags: ['Quiz Operations'],
        security: [{ BearerAuth: [] }],
        description: 'Exports a quiz and its questions as a portable JSON structure.',
      },
    }
  )

  /**
   * POST /org/:orgDomain/quizzes/:quizId/import
   * Import questions from JSON
   */
  .post(
    '/:quizId/import',
    async ({ params, body, bearer, jwt, set }) => {
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

        // Validating types (Elysia does it mostly, but just passing it properly)
        const importData = body as any;

        // Call service
        const result = await quizService.importQuestions(
          params.orgDomain,
          params.quizId,
          importData,
          userId
        );

        set.status = result.status;
        return {
          success: result.success,
          message: result.message,
        };
      } catch (error) {
        console.error('Import questions error:', error);
        set.status = 500;
        logEvent({ event: 'quiz.db.error', level: 'ERROR', source: 'system', data: { error: error instanceof Error ? error.message : 'unknown' } });
        return { success: false, message: 'Internal server error' };
      }
    },
    {
      body: t.Object({
        questions: t.Array(
          t.Object({
            text: t.String({ minLength: 5, maxLength: 1000 }),
            mediaUrl: t.Optional(t.Union([t.String(), t.Null()])),
            timeLimit: t.Number({ minimum: 10, maximum: 120 }),
            points: t.Optional(t.Number({ minimum: 100, maximum: 1000 })),
            correctIndex: t.Number({ minimum: 0, maximum: 3 }),
            options: t.Array(
              t.Object({
                text: t.String({ minLength: 1, maxLength: 200 }),
                color: t.Union([
                  t.Literal('red'),
                  t.Literal('blue'),
                  t.Literal('green'),
                  t.Literal('yellow'),
                  t.Literal('orange'),
                  t.Literal('purple'),
                  t.Literal('pink'),
                  t.Literal('brown'),
                  t.Literal('black'),
                  t.Literal('white'),
                  t.Literal('gray')
                ]),
              }),
              { minItems: 4, maxItems: 4 }
            )
          })
        ),
      }),
      response: t.Object({
        success: t.Boolean(),
        data: t.Optional(t.Any()),
        message: t.Optional(t.String()),
      }),
      detail: {
        summary: 'Import questions from JSON',
        tags: ['Quiz Operations'],
        security: [{ BearerAuth: [] }],
        description: 'Bulk inserts questions into an existing quiz from an exported JSON structure.',
      },
    }
  );