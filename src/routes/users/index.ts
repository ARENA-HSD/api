import { Elysia, t } from "elysia";
import { eq, or } from "drizzle-orm";
import { db, schema } from "../../db";
import { signUserToken, toPublicUser } from "../../lib/auth";

export const usersRoutes = new Elysia({ prefix: "/users" })
  .post(
    "/",
    async ({ body, set }) => {
      const { username, email, password } = body;

      const existing = await db
        .select()
        .from(schema.users)
        .where(or(eq(schema.users.email, email), eq(schema.users.username, username)))
        .limit(1);

      if (existing.length > 0) {
        set.status = 409;
        return { success: false, message: "User already exists" };
      }

      const hashed = await Bun.password.hash(password);

      const [created] = await db
        .insert(schema.users)
        .values({ username, email, password: hashed })
        .returning();

      const token = signUserToken({ id: created.id, email: created.email });

      return {
        success: true,
        data: {
          user: toPublicUser(created),
          token,
        },
      };
    },
    {
      body: t.Object({
        username: t.String({ minLength: 3 }),
        email: t.String({ format: "email" }),
        password: t.String({ minLength: 6 }),
      }),
      response: t.Object({
        success: t.Boolean(),
        data: t.Optional(t.Object({
          user: t.Object({
            id: t.String({ format: "uuid" }),
            username: t.String(),
            email: t.String({ format: "email" }),
          }),
          token: t.String(),
        })),
        message: t.Optional(t.String()),
      }),
      detail: {
        summary: "Create user and return token",
        tags: ["User Operations", "Auth Operations"],
      },
    }
  )
  .delete("/:id",  async ({ set, params, headers, cookie }) => {
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
	        summary: 'Delete the user', 
	        tags: ['User Operations'] 
	  } 
    })
  .patch("/:id", async ({ set, params, headers, cookie }) => {
      return {
        success: true
      };
    },
    {
      body: t.Object({
        name: t.Optional(t.String()),
        email: t.Optional(t.String({ format: "email" })),
        password: t.Optional(t.String({ minLength: 6 })),
      }),
      response: t.Object({
        success: t.Boolean(),
        data: t.Optional(t.Any()),
        message: t.Optional(t.String()),
      }),
      detail: { 
	        summary: 'Update the user', 
	        tags: ['User Operations'] 
	  } 
    })
  .get("/:id",  async ({ set, params, headers, cookie }) => {
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
	        summary: 'Get user by ID', 
	        tags: ['User Operations'] 
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
	        summary: 'Get all users', 
	        tags: ['User Operations'] 
	  } 
    });
