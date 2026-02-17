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

      try {
        const question = await questionService.createQuestion(
          params.orgDomain,
          params.quizId,
          body
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
        text: t.String({ minLength: 5 }),
        mediaUrl: t.Optional(t.String()),
        timeLimit: t.Number({ minimum: 10, maximum: 120 }),
        points: t.Number({ minimum: 100 }),
        options: t.Array(t.String(), { minItems: 4, maxItems: 4 }),
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
    async ({ set, params }) => {
      try {
        const questions = await questionService.listQuestions(
          params.orgDomain,
          params.quizId
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
        tags: ["Question Operations"],
      },
    }
  )

  // GET - Get single question by ID
  .get(
    "/:questionId",
    async ({ set, params }) => {
      try {
        const question = await questionService.getQuestionById(
          params.orgDomain,
          params.quizId,
          params.questionId
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

      try {
        const updated = await questionService.updateQuestion(
          params.orgDomain,
          params.quizId,
          params.questionId,
          body
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
        text: t.Optional(t.String({ minLength: 5 })),
        mediaUrl: t.Optional(t.String()),
        timeLimit: t.Optional(t.Number({ minimum: 10, maximum: 120 })),
        points: t.Optional(t.Number({ minimum: 100 })),
        options: t.Optional(t.Array(t.String(), { minItems: 4, maxItems: 4 })),
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

      try {
        const deleted = await questionService.deleteQuestion(
          params.orgDomain,
          params.quizId,
          params.questionId
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
  );
