import { Elysia, t } from "elysia";
import bearer from "@elysiajs/bearer";
import jwtPlugin from "@elysiajs/jwt";
import { jwtConfig } from "../../middleware/auth.middleware";
import { requireAuth } from "../../shared/helpers/crypto.helper";
import { logEvent } from "../../shared/helpers/log.helper";
import * as adminService from "./admin.service";

export const adminRoutes = new Elysia({ prefix: "/admin" })
  .use(bearer())
  .use(jwtPlugin({ name: "jwt", secret: jwtConfig.secret }))

  // Middleware to check WEB_ADMIN role on all admin routes
  .onBeforeHandle(async ({ headers,  set, bearer, cookie, jwt  }) => {
    const auth = await requireAuth(jwt, bearer, cookie, set);
    if (!auth) {
      set.status = 401;
      return { success: false, message: "Unauthorized" };
    }

    // Validate WEB_ADMIN role
    try {
      await adminService.validateWEBAdminRole(auth.sub);
    } catch (error) {
      set.status = 403;
      logEvent({
        event: "admin.access.denied",
        level: "WARNING",
        source: "code",
        data: { userId: auth.sub }, orgSubdomain: headers['x-organization-domain'] });
      return { success: false, message: "Access denied: WEB_ADMIN role required" };
    }
  })

  // GET /admin/info - Dashboard summary info
  .get(
    "/info",
    async ({ headers,  set  }) => {
      try {
        const info = await adminService.getAdminInfo();

        return {
          success: true,
          data: info,
          message: "Admin info fetched successfully",
        };
      } catch (error) {
        set.status = 500;
        logEvent({
          event: "admin.db.error",
          level: "ERROR",
          source: "system",
          data: { error: error instanceof Error ? error.message : "unknown" }, orgSubdomain: headers['x-organization-domain'] });
        return { success: false, message: "Failed to fetch admin info" };
      }
    },
    {
      response: t.Object({
        success: t.Boolean(),
        data: t.Optional(
          t.Object({
            userCount: t.Number(),
            organizationCount: t.Number(),
            quizCount: t.Number(),
          })
        ),
        message: t.Optional(t.String()),
      }),
      detail: {
        summary: "Get admin dashboard info",
        description:
          "WEB_ADMIN only. Returns total users, organizations, and quizzes.",
        tags: ["Admin Operations"],
        security: [{ BearerAuth: [] }],
      },
    }
  )

  // ─── ORGANIZATION ENDPOINTS ──────────────────────────────

  // GET /admin/organizations - List all organizations
  .get(
    "/organizations",
    async ({ headers,  set, query  }) => {
      try {
        const limit = Math.min(parseInt(query.limit || "20"), 100);
        const offset = Math.max(parseInt(query.offset || "0"), 0);

        const { organizations, total } = await adminService.getAllOrganizations(
          limit,
          offset
        );

        return {
          success: true,
          data: { organizations, total },
          message: "Organizations fetched successfully",
        };
      } catch (error) {
        set.status = 500;
        logEvent({
          event: "admin.db.error",
          level: "ERROR",
          source: "system",
          data: { error: error instanceof Error ? error.message : "unknown" }, orgSubdomain: headers['x-organization-domain'] });
        return { success: false, message: "Failed to fetch organizations" };
      }
    },
    {
      query: t.Object({
        limit: t.Optional(t.String()),
        offset: t.Optional(t.String()),
      }),
      response: t.Object({
        success: t.Boolean(),
        data: t.Optional(t.Any()),
        message: t.Optional(t.String()),
      }),
      detail: {
        summary: "List all organizations",
        description:
          "WEB_ADMIN only. Returns all organizations with pagination (limit max 100, default 20)",
        tags: ["Admin Operations"],
        security: [{ BearerAuth: [] }],
      },
    }
  )

  // PATCH /admin/organizations/:orgId - Update organization
  .patch(
    "/organizations/:orgId",
    async ({ headers,  set, params, body  }) => {
      try {
        const updated = await adminService.updateOrganizationAsAdmin(
          params.orgId,
          body
        );

        return {
          success: true,
          data: { organization: updated },
          message: "Organization updated successfully",
        };
      } catch (error) {
        if (error instanceof Error) {
          if (error.message === "Organization not found") {
            set.status = 404;
            return { success: false, message: error.message };
          }
          if (
            error.message === "Subdomain is not allowed" ||
            error.message === "Subdomain already exists"
          ) {
            set.status = 409;
            return { success: false, message: error.message };
          }
        }
        set.status = 500;
        logEvent({
          event: "admin.db.error",
          level: "ERROR",
          source: "system",
          data: { error: error instanceof Error ? error.message : "unknown" }, orgSubdomain: headers['x-organization-domain'] });
        return { success: false, message: "Failed to update organization" };
      }
    },
    {
      params: t.Object({
        orgId: t.String({ format: "uuid" }),
      }),
      body: t.Object({
        name: t.Optional(t.String()),
        subdomain: t.Optional(t.String({ minLength: 3 })),
        branding: t.Optional(
          t.Record(
            t.String({ maxLength: 50 }),
            t.String({ maxLength: 500 })
          )
        ),
      }),
      response: t.Object({
        success: t.Boolean(),
        data: t.Optional(t.Any()),
        message: t.Optional(t.String()),
      }),
      detail: {
        summary: "Update organization",
        description:
          "WEB_ADMIN only. Update organization name, subdomain, or branding.",
        tags: ["Admin Operations"],
        security: [{ BearerAuth: [] }],
      },
    }
  )

  // DELETE /admin/organizations/:orgId - Delete organization
  .delete(
    "/organizations/:orgId",
    async ({ headers,  set, params  }) => {
      try {
        const deleted = await adminService.deleteOrganizationAsAdmin(
          params.orgId
        );

        return {
          success: true,
          data: { id: deleted.id },
          message: "Organization deleted successfully",
        };
      } catch (error) {
        if (error instanceof Error) {
          if (error.message === "Organization not found") {
            set.status = 404;
            return { success: false, message: error.message };
          }
        }
        set.status = 500;
        logEvent({
          event: "admin.db.error",
          level: "ERROR",
          source: "system",
          data: { error: error instanceof Error ? error.message : "unknown" }, orgSubdomain: headers['x-organization-domain'] });
        return { success: false, message: "Failed to delete organization" };
      }
    },
    {
      params: t.Object({
        orgId: t.String({ format: "uuid" }),
      }),
      response: t.Object({
        success: t.Boolean(),
        data: t.Optional(t.Any()),
        message: t.Optional(t.String()),
      }),
      detail: {
        summary: "Delete organization",
        description:
          "WEB_ADMIN only. Delete organization and all related data (cascade delete).",
        tags: ["Admin Operations"],
        security: [{ BearerAuth: [] }],
      },
    }
  )

  // ─── USER MANAGEMENT ENDPOINTS ──────────────────────────────

  // GET /admin/users - List all users
  .get(
    "/users",
    async ({ headers,  set, query  }) => {
      try {
        const limit = Math.min(parseInt(query.limit || "20"), 100);
        const offset = Math.max(parseInt(query.offset || "0"), 0);

        const { users, total } = await adminService.getAllUsers(limit, offset);

        return {
          success: true,
          data: { users, total },
          message: "Users fetched successfully",
        };
      } catch (error) {
        set.status = 500;
        logEvent({
          event: "admin.db.error",
          level: "ERROR",
          source: "system",
          data: { error: error instanceof Error ? error.message : "unknown" }, orgSubdomain: headers['x-organization-domain'] });
        return { success: false, message: "Failed to fetch users" };
      }
    },
    {
      query: t.Object({
        limit: t.Optional(t.String()),
        offset: t.Optional(t.String()),
      }),
      response: t.Object({
        success: t.Boolean(),
        data: t.Optional(t.Any()),
        message: t.Optional(t.String()),
      }),
      detail: {
        summary: "List all users",
        description:
          "WEB_ADMIN only. Returns all users with pagination (limit max 100, default 20)",
        tags: ["Admin Operations"],
        security: [{ BearerAuth: [] }],
      },
    }
  )

  // GET /admin/users/search - Search users
  .get(
    "/users/search",
    async ({ headers,  set, query  }) => {
      try {
        if (!query.q || query.q.trim().length === 0) {
          set.status = 400;
          return {
            success: false,
            message: "Search query (q) is required and cannot be empty",
          };
        }

        const limit = Math.min(parseInt(query.limit || "20"), 100);
        const offset = Math.max(parseInt(query.offset || "0"), 0);

        const { users, total } = await adminService.searchUsers(
          query.q,
          limit,
          offset
        );

        return {
          success: true,
          data: { users, total },
          message: "Users found",
        };
      } catch (error) {
        if (error instanceof Error) {
          if (error.message.includes("empty")) {
            set.status = 400;
            return { success: false, message: error.message };
          }
        }
        set.status = 500;
        logEvent({
          event: "admin.db.error",
          level: "ERROR",
          source: "system",
          data: { error: error instanceof Error ? error.message : "unknown" }, orgSubdomain: headers['x-organization-domain'] });
        return { success: false, message: "Failed to search users" };
      }
    },
    {
      query: t.Object({
        q: t.String({ minLength: 1 }),
        limit: t.Optional(t.String()),
        offset: t.Optional(t.String()),
      }),
      response: t.Object({
        success: t.Boolean(),
        data: t.Optional(t.Any()),
        message: t.Optional(t.String()),
      }),
      detail: {
        summary: "Search users",
        description:
          "WEB_ADMIN only. Search users by username or email (partial, case-insensitive)",
        tags: ["Admin Operations"],
        security: [{ BearerAuth: [] }],
      },
    }
  )

  // PATCH /admin/users/:userId - Update user
  .patch(
    "/users/:userId",
    async ({ headers,  set, params, body  }) => {
      try {
        const updated = await adminService.updateUserAsAdmin(
          params.userId,
          body
        );

        return {
          success: true,
          data: { user: updated },
          message: "User updated successfully",
        };
      } catch (error) {
        if (error instanceof Error) {
          if (error.message === "User not found") {
            set.status = 404;
            return { success: false, message: error.message };
          }
          if (
            error.message.includes("Invalid role") ||
            error.message.includes("at least 3 characters") ||
            error.message.includes("empty")
          ) {
            set.status = 400;
            return { success: false, message: error.message };
          }
          if (
            error.message.includes("already exists") ||
            error.message.includes("Username already exists") ||
            error.message.includes("Email already exists")
          ) {
            set.status = 409;
            return { success: false, message: error.message };
          }
        }
        set.status = 500;
        logEvent({
          event: "admin.db.error",
          level: "ERROR",
          source: "system",
          data: { error: error instanceof Error ? error.message : "unknown" }, orgSubdomain: headers['x-organization-domain'] });
        return { success: false, message: "Failed to update user" };
      }
    },
    {
      params: t.Object({
        userId: t.String({ format: "uuid" }),
      }),
      body: t.Object({
        role: t.Optional(t.Union([t.Literal("USER"), t.Literal("WEB_ADMIN")])),
        username: t.Optional(t.String({ minLength: 3 })),
        email: t.Optional(t.String({ format: "email" })),
      }),
      response: t.Object({
        success: t.Boolean(),
        data: t.Optional(t.Any()),
        message: t.Optional(t.String()),
      }),
      detail: {
        summary: "Update user",
        description:
          "WEB_ADMIN only. Update user role (USER/WEB_ADMIN), username, or email.",
        tags: ["Admin Operations"],
        security: [{ BearerAuth: [] }],
      },
    }
  )

  // DELETE /admin/users/:userId - Delete user
  .delete(
    "/users/:userId",
    async ({ headers,  set, params  }) => {
      try {
        const deleted = await adminService.deleteUserAsAdmin(params.userId);

        return {
          success: true,
          data: { id: deleted.id },
          message: "User deleted successfully",
        };
      } catch (error) {
        if (error instanceof Error) {
          if (error.message === "User not found") {
            set.status = 404;
            return { success: false, message: error.message };
          }
        }
        set.status = 500;
        logEvent({
          event: "admin.db.error",
          level: "ERROR",
          source: "system",
          data: { error: error instanceof Error ? error.message : "unknown" }, orgSubdomain: headers['x-organization-domain'] });
        return { success: false, message: "Failed to delete user" };
      }
    },
    {
      params: t.Object({
        userId: t.String({ format: "uuid" }),
      }),
      response: t.Object({
        success: t.Boolean(),
        data: t.Optional(t.Any()),
        message: t.Optional(t.String()),
      }),
      detail: {
        summary: "Delete user",
        description:
          "WEB_ADMIN only. Delete user and all related data (cascade delete).",
        tags: ["Admin Operations"],
        security: [{ BearerAuth: [] }],
      },
    }
  );
