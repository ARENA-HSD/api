import { Elysia, t } from "elysia";

export const quizzesRoutes = new Elysia({ prefix: "/org/:orgId/quizzes" })
  .post("/",  async ({ set, params, headers, cookie }) => {
      return {
        success: true
      };
    },
    {
      body: t.Object({
        title: t.String(),
        defaultMode: t.String({ enum: ["PERSONAL", "STAGE"] }),
      }),
      response: t.Object({
        success: t.Boolean(),
        data: t.Optional(t.Any()),
        message: t.Optional(t.String()),
      }),
      detail: { 
	        summary: 'Create the quiz', 
	        tags: ['Quiz Operations'] 
	  } 
    })
  .delete("/:quizId",  async ({ set, params, headers, cookie }) => {
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
	        summary: 'Delete the quiz', 
	        tags: ['Quiz Operations'] 
	  } 
    })
  .patch("/:quizId",  async ({ set, params, headers, cookie }) => {
      return {
        success: true
      };
    },
    {
      body: t.Object({
        title: t.Optional(t.String()),
        defaultMode: t.Optional(t.String({ enum: ["PERSONAL", "STAGE"] })),
      }),
      response: t.Object({
        success: t.Boolean(),
        data: t.Optional(t.Any()),
        message: t.Optional(t.String()),
      }),
      detail: { 
	        summary: 'Update the quiz', 
	        tags: ['Quiz Operations'] 
	  } 
    })
  .get("/:quizId",  async ({ set, params, headers, cookie }) => {
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
	        summary: 'Get quiz by ID', 
	        tags: ['Quiz Operations'] 
	  } 
    })
  .get("/",  async ({ set, params, headers, cookie }) => {
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
	        summary: 'Get all quizzes', 
	        tags: ['Quiz Operations'] 
	  } 
    });
