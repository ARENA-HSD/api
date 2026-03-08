import { Elysia, t } from "elysia";
import bearer from "@elysiajs/bearer";
import jwtPlugin from "@elysiajs/jwt";
import { and, eq, ne, or } from "drizzle-orm";
import { db, schema } from "../../core/database/client";
import { jwtConfig, toPublicUser } from "../../middleware/auth.middleware";

type CookieJar = Record<string, { value?: string | undefined }> | undefined;
type AuthPayload = { sub: string; email: string };

const getCookieValue = (cookies: any): string | undefined => {
  return cookies?.token?.value;
};

const requireAuth = async (
  jwt: { verify: (token: string) => Promise<unknown> },
  bearerToken: string | null | undefined,
  cookie: any,
  set: any
) => {
  const token = bearerToken || getCookieValue(cookie);
  if (!token) {
    set.status = 401;
    return null;
  }

  try {
    const payload = (await jwt.verify(token)) as AuthPayload;
    return payload;
  } catch {
    set.status = 401;
    return null;
  }
};

export const usersRoutes = new Elysia({ prefix: "/users" })
  .use(bearer())
  .use(jwtPlugin({ name: "jwt", secret: jwtConfig.secret }))
  .post(
    "/",
    async ({ body, set, jwt }) => {
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

      const token = await jwt.sign({ sub: created.id, email: created.email });

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
  .delete(
    "/:id",
    async ({ set, params, cookie, bearer, jwt }) => {
      const auth = await requireAuth(jwt, bearer, cookie, set);
      if (!auth)
        return { success: false, message: "Unauthorized" };

      if (auth.sub !== params.id) {
        set.status = 403;
        return { success: false, message: "Forbidden" };
      }

      const [deleted] = await db
        .delete(schema.users)
        .where(eq(schema.users.id, params.id))
        .returning({ id: schema.users.id });

      if (!deleted) {
        set.status = 404;
        return { success: false, message: "User not found" };
      }

      return { success: true, data: { id: deleted.id } };
    },
    {
      params: t.Object({ id: t.String({ format: "uuid" }) }),
      headers: t.Object({ Authorization: t.Optional(t.String()) }),
      response: t.Object({
        success: t.Boolean(),
        data: t.Optional(t.Object({ id: t.String({ format: "uuid" }) })),
        message: t.Optional(t.String()),
      }),
      detail: {
        summary: "Delete the user",
        tags: ["User Operations"],
      },
    }
  )
  .patch(
    "/:id",
    async ({ set, params, cookie, bearer, body, jwt }) => {
      const auth = await requireAuth(jwt, bearer, cookie, set);
      if (!auth)
        return { success: false, message: "Unauthorized" };

      if (auth.sub !== params.id) {
        set.status = 403;
        return { success: false, message: "Forbidden" };
      }

      const updates: Partial<typeof schema.users.$inferInsert> = {};

      if (body.name) updates.username = body.name;
      if (body.email) updates.email = body.email;
      if (body.password) updates.password = await Bun.password.hash(body.password);

      if (Object.keys(updates).length === 0) {
        set.status = 400;
        return { success: false, message: "No fields to update" };
      }

      if (updates.email) {
        const [emailConflict] = await db
          .select({ id: schema.users.id })
          .from(schema.users)
          .where(and(eq(schema.users.email, updates.email), ne(schema.users.id, params.id)))
          .limit(1);

        if (emailConflict) {
          set.status = 409;
          return { success: false, message: "Email already in use" };
        }
      }

      if (updates.username) {
        const [usernameConflict] = await db
          .select({ id: schema.users.id })
          .from(schema.users)
          .where(and(eq(schema.users.username, updates.username), ne(schema.users.id, params.id)))
          .limit(1);

        if (usernameConflict) {
          set.status = 409;
          return { success: false, message: "Username already in use" };
        }
      }

      const [updated] = await db
        .update(schema.users)
        .set(updates)
        .where(eq(schema.users.id, params.id))
        .returning();

      if (!updated) {
        set.status = 404;
        return { success: false, message: "User not found" };
      }

      return {
        success: true,
        data: { user: toPublicUser(updated) },
      };
    },
    {
      params: t.Object({ id: t.String({ format: "uuid" }) }),
      headers: t.Object({ Authorization: t.Optional(t.String()) }),
      body: t.Object({
        name: t.Optional(t.String()),
        email: t.Optional(t.String({ format: "email" })),
        password: t.Optional(t.String({ minLength: 6 })),
      }),
      response: t.Object({
        success: t.Boolean(),
        data: t.Optional(t.Object({
          user: t.Object({
            id: t.String({ format: "uuid" }),
            username: t.String(),
            email: t.String({ format: "email" }),
            createdAt: t.Date(),
          }),
        })),
        message: t.Optional(t.String()),
      }),
      detail: {
        summary: "Update the user",
        tags: ["User Operations"],
      },
    }
  )
  .get(
    "/:id",
    async ({ set, params }) => {
      const [user] = await db
        .select()
        .from(schema.users)
        .where(eq(schema.users.id, params.id))
        .limit(1);

      if (!user) {
        set.status = 404;
        return { success: false, message: "User not found" };
      }

      return { success: true, data: { user: toPublicUser(user) } };
    },
    {
      params: t.Object({ id: t.String({ format: "uuid" }) }),
      response: t.Object({
        success: t.Boolean(),
        data: t.Optional(t.Object({
          user: t.Object({
            id: t.String({ format: "uuid" }),
            username: t.String(),
            email: t.String({ format: "email" }),
            createdAt: t.Date(),
          }),
        })),
        message: t.Optional(t.String()),
      }),
      detail: {
        summary: "Get user by ID",
        tags: ["User Operations"],
      },
    }
  )
  .get(
    "/",
    async () => {
      const users = await db.select().from(schema.users);
      return { success: true, data: { users: users.map(toPublicUser) } };
    },
    {
      response: t.Object({
        success: t.Boolean(),
        data: t.Optional(t.Object({
          users: t.Array(t.Object({
            id: t.String({ format: "uuid" }),
            username: t.String(),
            email: t.String({ format: "email" }),
            createdAt: t.Date(),
          })),
        })),
        message: t.Optional(t.String()),
      }),
      detail: {
        summary: "Get all users",
        tags: ["User Operations"],
      },
    }
  )

  // ─── MY INVITATIONS ─────────────────────────────────────────

  //  GET /users/me/invitations — Kullanıcının tüm PENDING davetlerini org adıyla listele
  .get(
    "/me/invitations",
    async ({ set, bearer: bearerToken, cookie, jwt }) => {
      // 1. Auth — Token zorunlu
      const auth = await requireAuth(jwt, bearerToken, cookie, set);
      if (!auth) return { success: false, message: "Bearer token required" };

      // 2. Kullanıcının davetlerini getir (org adı + inviter username ile)
      try {
        const { getMyInvitations } = await import("../invitations/invitations.service");
        const result = await getMyInvitations(auth.sub);

        if (!result.success) {
          set.status = (result as any).status || 500;
          return { success: false, message: (result as any).message };
        }

        return { success: true, data: result.data };
      } catch (error) {
        set.status = 500;
        return { success: false, message: "Failed to fetch invitations" };
      }
    },
    {
      response: t.Object({
        success: t.Boolean(),
        data: t.Optional(t.Any()),
        message: t.Optional(t.String()),
      }),
      detail: {
        summary: "List my pending invitations",
        description: "Returns all PENDING invitations for the authenticated user, with organization names and inviter usernames.",
        tags: ["User Operations"],
        security: [{ BearerAuth: [] }],
      },
    }
  )

  //  PATCH /users/me/invitations/:invitationId — Daveti kabul veya reddet
  .patch(
    "/me/invitations/:invitationId",
    async ({ set, params, body, bearer: bearerToken, cookie, jwt }) => {
      // 1. Auth — Token zorunlu
      const auth = await requireAuth(jwt, bearerToken, cookie, set);
      if (!auth) return { success: false, message: "Bearer token required" };

      // 2. Status validasyonu
      const status = body.status.toUpperCase();
      if (status !== "ACCEPTED" && status !== "REJECTED") {
        set.status = 400;
        return { success: false, message: "Status must be ACCEPTED or REJECTED" };
      }

      // 3. Mevcut respondToInvitation servisini çağır (inviteeId === userId kontrolü orada)
      try {
        const { respondToInvitation } = await import("../invitations/invitations.service");
        const result = await respondToInvitation(
          params.invitationId,
          auth.sub,
          status as "ACCEPTED" | "REJECTED"
        );

        if (!result.success) {
          set.status = (result as any).status || 500;
          return { success: false, message: (result as any).message };
        }

        return { success: true, data: result.data };
      } catch (error) {
        set.status = 500;
        return { success: false, message: "Failed to respond to invitation" };
      }
    },
    {
      params: t.Object({
        invitationId: t.String({ format: "uuid" }),
      }),
      body: t.Object({
        status: t.String(),
      }),
      response: t.Object({
        success: t.Boolean(),
        data: t.Optional(t.Any()),
        message: t.Optional(t.String()),
      }),
      detail: {
        summary: "Accept or reject an invitation",
        description: "The authenticated user can accept (becomes MANAGER) or reject a pending invitation.",
        tags: ["User Operations"],
        security: [{ BearerAuth: [] }],
      },
    }
  );