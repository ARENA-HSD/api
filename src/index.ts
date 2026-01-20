import { Elysia } from "elysia";
import { db, schema } from "./db";

const app = new Elysia()
  .get("/", () => "API is working.")
  .get("/db-health", async () => {
    try {
      // Test database connection by counting organizations
      const result = await db.select().from(schema.organizations).limit(1);
      return {
        status: "healthy",
        database: "connected",
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      return {
        status: "error",
        database: "disconnected",
        error: error instanceof Error ? error.message : "Unknown error",
        timestamp: new Date().toISOString(),
      };
    }
  })
  .listen(3000);

console.log(
  `🦊 Elysia is running at ${app.server?.hostname}:${app.server?.port}`
);
