import { Elysia, t } from "elysia";

export const questionsRoutes = new Elysia({ prefix: "/org/:orgId/quizzes/:quizId/questions" })
  .post("/",  async ({ set, params, headers, cookie }) => {
      return {
        success: true
      };
    },
    {
      body: t.Object({
        text: t.String(),
        mediaUrl: t.Optional(t.String()),
        timeLimit: t.Number(),
        points: t.Optional(t.Number()),
        options: t.Array(t.String()),
        correctIndex: t.Number(),
        orderIndex: t.Number(),
      }),
      response: t.Object({
        success: t.Boolean(),
        data: t.Optional(t.Any()),
        message: t.Optional(t.String()),
      }),
      detail: { 
	        summary: 'Create the question', 
	        tags: ['Question Operations'] 
	  } 
    })
  .patch("/:questionId", async ({ set, params, headers, cookie }) => {
      return {
        success: true
      };
    },
    {
      body: t.Object({
        text: t.Optional(t.String()),
        mediaUrl: t.Optional(t.String()),
        timeLimit: t.Optional(t.Number()),
        points: t.Optional(t.Number()),
        options: t.Optional(t.Array(t.String())),
        correctIndex: t.Optional(t.Number()),
        orderIndex: t.Optional(t.Number()),
      }),
      response: t.Object({
        success: t.Boolean(),
        data: t.Optional(t.Any()),
        message: t.Optional(t.String()),
      }),
      detail: { 
	        summary: 'Update the question', 
	        tags: ['Question Operations'] 
	  } 
    })
  .get("/", async ({ set, params, headers, cookie }) => {
      return {
        success: true
      };
    },
    {
      response: t.Object({
        success: t.Boolean(),
        data: t.Optional(t.Any()),
        message: t.Optional(t.String()),
      }),
      detail: { 
	        summary: 'Get all questions', 
	        tags: ['Question Operations'] 
	  } 
    });
