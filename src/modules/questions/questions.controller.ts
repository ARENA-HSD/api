import { Elysia, t } from "elysia";
import bearer from "@elysiajs/bearer";
import jwtPlugin from "@elysiajs/jwt";
import { jwtConfig } from "../../middleware/auth.middleware";
import { requireAuth } from "../../shared/helpers/crypto.helper";
import * as questionService from "./questions.service";

export const questionsRoutes = new Elysia({
  prefix: "/org/:orgDomain/quizzes/:quizId/questions",
})
  .use(bearer())
  .use(jwtPlugin({ name: "jwt", secret: jwtConfig.secret }))

  // POST - Create question
  .post(
    "/",
    async ({ set, params, body, bearer, cookie, jwt }) => {
      const auth = await requireAuth(jwt, bearer, cookie, set);
      if (!auth) {
        return { success: false, message: "Unauthorized" };
      }

      const userId = auth.sub;

      try {
        const question = await questionService.createQuestion(
          params.orgDomain,
          params.quizId,
          body,
          userId
        );

        return {
          success: true,
          data: { question },
          message: "Question created successfully",
        };
      } catch (error) {
        if (error instanceof Error) {
          if (error.message === "Organization not found") {
            set.status = 404;
            return { success: false, message: error.message };
          }
          if (error.message === "Quiz not found in organization") {
            set.status = 404;
            return { success: false, message: error.message };
          }
          if (
            error.message.includes("Options must") ||
            error.message.includes("correctIndex must") ||
            error.message.includes("timeLimit must") ||
            error.message.includes("points must") ||
            error.message.includes("Text must")
          ) {
            set.status = 400;
            return { success: false, message: error.message };
          }
        }
        set.status = 500;
        return { success: false, message: "Failed to create question" };
      }
    },
    {
      body: t.Object({
        text: t.String({ minLength: 5, maxLength: 1000 }),
        mediaUrl: t.Optional(t.String({ maxLength: 2048 })),
        timeLimit: t.Number({ minimum: 10, maximum: 120 }),
        points: t.Number({ minimum: 100, maximum: 1000 }),
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
          }), { minItems: 4, maxItems: 4 }),
        correctIndex: t.Number({ minimum: 0, maximum: 3 }),
        orderIndex: t.Number({ minimum: 0 }),
      }),
      response: t.Object({
        success: t.Boolean(),
        data: t.Optional(t.Any()),
        message: t.Optional(t.String()),
      }),
      detail: {
        summary: "Create a new question",
        description:
          "Creates a new question for the quiz. Must have exactly 4 options.",
        tags: ["Question Operations"],
        security: [{ BearerAuth: [] }],
      },
    }
  )

  // GET - List all questions (sorted by orderIndex)
  .get(
    "/",
    async ({ set, params, bearer, cookie, jwt }) => {
      const auth = await requireAuth(jwt, bearer, cookie, set);
      if (!auth) {
        return { success: false, message: "Unauthorized" };
      }

      const userId = auth.sub;

      try {
        const questions = await questionService.listQuestions(
          params.orgDomain,
          params.quizId,
          userId
        );

        return {
          success: true,
          data: { questions },
        };
      } catch (error) {
        if (error instanceof Error) {
          if (error.message === "Organization not found") {
            set.status = 404;
            return { success: false, message: error.message };
          }
          if (error.message === "Quiz not found in organization") {
            set.status = 404;
            return { success: false, message: error.message };
          }
        }
        set.status = 500;
        return { success: false, message: "Failed to fetch questions" };
      }
    },
    {
      response: t.Object({
        success: t.Boolean(),
        data: t.Optional(t.Any()),
        message: t.Optional(t.String()),
      }),
      detail: {
        summary: "Get all questions for a quiz",
        description: "Returns all questions sorted by orderIndex (ASC)",
        security: [{ BearerAuth: [] }],
        tags: ["Question Operations"],
      },
    }
  )

  // GET - Get single question by ID
  .get(
    "/:questionId",
    async ({ set, params, bearer, cookie, jwt }) => {
      const auth = await requireAuth(jwt, bearer, cookie, set);
      if (!auth) {
        return { success: false, message: "Unauthorized" };
      }

      const userId = auth.sub;

      try {
        const question = await questionService.getQuestionById(
          params.orgDomain,
          params.quizId,
          params.questionId,
          userId
        );

        return {
          success: true,
          data: { question },
        };
      } catch (error) {
        if (error instanceof Error) {
          if (
            error.message === "Organization not found" ||
            error.message === "Quiz not found in organization" ||
            error.message === "Question not found"
          ) {
            set.status = 404;
            return { success: false, message: error.message };
          }
        }
        set.status = 500;
        return { success: false, message: "Failed to fetch question" };
      }
    },
    {
      params: t.Object({
        orgDomain: t.String(),
        quizId: t.String(),
        questionId: t.String(),
      }),
      response: t.Object({
        success: t.Boolean(),
        data: t.Optional(t.Any()),
        message: t.Optional(t.String()),
      }),
      detail: {
        summary: "Get question by ID",
        description: "Returns a single question with hierarchy validation",
        security: [{ BearerAuth: [] }],
        tags: ["Question Operations"],
      },
    }
  )

  // PATCH - Update question
  .patch(
    "/:questionId",
    async ({ set, params, body, bearer, cookie, jwt }) => {
      const auth = await requireAuth(jwt, bearer, cookie, set);
      if (!auth) {
        return { success: false, message: "Unauthorized" };
      }

      const userId = auth.sub;

      try {
        const updated = await questionService.updateQuestion(
          params.orgDomain,
          params.quizId,
          params.questionId,
          body,
          userId
        );

        return {
          success: true,
          data: { question: updated },
          message: "Question updated successfully",
        };
      } catch (error) {
        if (error instanceof Error) {
          if (
            error.message === "Organization not found" ||
            error.message === "Quiz not found in organization" ||
            error.message === "Question not found"
          ) {
            set.status = 404;
            return { success: false, message: error.message };
          }
          if (
            error.message.includes("Options must") ||
            error.message.includes("correctIndex must") ||
            error.message.includes("timeLimit must") ||
            error.message.includes("points must") ||
            error.message.includes("Text must")
          ) {
            set.status = 400;
            return { success: false, message: error.message };
          }
        }
        set.status = 500;
        return { success: false, message: "Failed to update question" };
      }
    },
    {
      params: t.Object({
        orgDomain: t.String(),
        quizId: t.String(),
        questionId: t.String(),
      }),
      body: t.Object({
        text: t.Optional(t.String({ minLength: 5, maxLength: 1000 })),
        mediaUrl: t.Optional(t.String({ maxLength: 2048 })),
        timeLimit: t.Optional(t.Number({ minimum: 10, maximum: 120 })),
        points: t.Optional(t.Number({ minimum: 100, maximum: 1000 })),
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
          }), { minItems: 4, maxItems: 4 }),
        correctIndex: t.Optional(t.Number({ minimum: 0, maximum: 3 })),
        orderIndex: t.Optional(t.Number({ minimum: 0 })),
      }),
      response: t.Object({
        success: t.Boolean(),
        data: t.Optional(t.Any()),
        message: t.Optional(t.String()),
      }),
      detail: {
        summary: "Update question",
        description:
          "Update question details. If options provided, must be exactly 4.",
        tags: ["Question Operations"],
        security: [{ BearerAuth: [] }],
      },
    }
  )

  // DELETE - Delete question
  .delete(
    "/:questionId",
    async ({ set, params, bearer, cookie, jwt }) => {
      const auth = await requireAuth(jwt, bearer, cookie, set);
      if (!auth) {
        return { success: false, message: "Unauthorized" };
      }

      const userId = auth.sub;

      try {
        const deleted = await questionService.deleteQuestion(
          params.orgDomain,
          params.quizId,
          params.questionId,
          userId
        );

        return {
          success: true,
          data: { id: deleted.id },
          message: "Question deleted successfully",
        };
      } catch (error) {
        if (error instanceof Error) {
          if (
            error.message === "Organization not found" ||
            error.message === "Quiz not found in organization" ||
            error.message === "Question not found"
          ) {
            set.status = 404;
            return { success: false, message: error.message };
          }
        }
        set.status = 500;
        return { success: false, message: "Failed to delete question" };
      }
    },
    {
      params: t.Object({
        orgDomain: t.String(),
        quizId: t.String(),
        questionId: t.String(),
      }),
      response: t.Object({
        success: t.Boolean(),
        data: t.Optional(t.Any()),
        message: t.Optional(t.String()),
      }),
      detail: {
        summary: "Delete question",
        description: "Delete a question from the quiz",
        tags: ["Question Operations"],
        security: [{ BearerAuth: [] }],
      },
    }
  )
   /**
   * POST /org/:orgDomain/quizzes/:quizId/questions/reorder
   * Reorder questions
   */
  .post(
    '/reorder',
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
        const result = await questionService.reorderQuestions(
          params.orgDomain,
          params.quizId,
          body,
          userId
        );

        set.status = result.status;
        if (result.success && 'data' in result) {
          return { success: true, data: result.data };
        }
        return { success: false, message: result.message };
      } catch (error) {
        console.error('Reorder questions error:', error);
        set.status = 500;
        return { success: false, message: 'Internal server error' };
      }
    },
    {
      body: t.Object({
        questionIds: t.Array(t.String()),
      }),
      response: t.Object({
        success: t.Boolean(),
        data: t.Optional(t.Any()),
        message: t.Optional(t.String()),
      }),
      detail: {
        summary: 'Reorder questions',
        tags: ['Question Operations'],
        description: 'Reorder questions by providing an array of question IDs in the new order.',
        security: [{ BearerAuth: [] }],
      },
    }
  );
