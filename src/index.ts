import { RedisClient } from "bun";
import { Elysia } from "elysia";
import { db, schema } from "./db";
import { openapi } from "@elysiajs/openapi";
import { gamesRoutes, usersRoutes, orgRoutes, questionsRoutes, quizzesRoutes, loginRoutes, invitationsRoutes } from "./routes";

const redisClient = new RedisClient();

const app = new Elysia()
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
  .use(usersRoutes)
  .use(loginRoutes)
  .use(orgRoutes)
  .use(quizzesRoutes)
  .use(questionsRoutes)
  .use(invitationsRoutes)
  .use(gamesRoutes)
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
  .listen(3000);

console.log(
  `🦊 Elysia is running at ${app.server?.hostname}:${app.server?.port}`
);
