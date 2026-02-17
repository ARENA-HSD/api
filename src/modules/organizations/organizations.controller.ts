import { Elysia, t } from "elysia";
import bearer from "@elysiajs/bearer";
import jwtPlugin from "@elysiajs/jwt";
import { jwtConfig } from "../../middleware/auth.middleware";
import { requireAuth } from "../../shared/helpers/crypto.helper";
import * as orgService from "./organizations.service";

export const orgRoutes = new Elysia({ prefix: "/org" })
  .use(bearer())
  .use(jwtPlugin({ name: "jwt", secret: jwtConfig.secret }))

  // POST /org - Create organization
  .post(
    "/",
    async ({ set, body, bearer, cookie, jwt }) => {
      const auth = await requireAuth(jwt, bearer, cookie, set);
      if (!auth) {
        return { success: false, message: "Unauthorized" };
      }

      try {
        const organization = await orgService.createOrganization(
          body,
          auth.sub
        );

        return {
          success: true,
          data: { organization },
          message: "Organization created successfully",
        };
      } catch (error) {
        if (error instanceof Error && error.message === "Subdomain already exists") {
          set.status = 409;
          return { success: false, message: error.message };
        }
        set.status = 500;
        return { success: false, message: "Failed to create organization" };
      }
    },
    {
      body: t.Object({
        name: t.String(),
        subdomain: t.String({ minLength: 3 }),
        branding: t.Optional(
          t.Object({
            logoUrl: t.Optional(t.String()),
            css: t.Optional(t.String()),
          })
        ),
      }),
      response: t.Object({
        success: t.Boolean(),
        data: t.Optional(t.Any()),
        message: t.Optional(t.String()),
      }),
      detail: {
        summary: "Create a new organization",
        description: "Creates a new organization with the authenticated user as the owner (SUPER_ADMIN)",
        tags: ["Organization Operations"],
        security: [{ BearerAuth: [] }],
      },
    }
  )

  // GET /org - Get all organizations for authenticated user
  .get(
    "/",
    async ({ set, bearer, cookie, jwt }) => {
      const auth = await requireAuth(jwt, bearer, cookie, set);
      if (!auth) {
        return { success: false, message: "Unauthorized" };
      }

      try {
        const organizations = await orgService.getOrganizationsByUser(auth.sub);
        return {
          success: true,
          data: { organizations },
        };
      } catch (error) {
        set.status = 500;
        return { success: false, message: "Failed to fetch organizations" };
      }
    },
    {
      response: t.Object({
        success: t.Boolean(),
        data: t.Optional(t.Any()),
        message: t.Optional(t.String()),
      }),
      detail: {
        summary: "Get all organizations for the authenticated user",
        description: "Returns all organizations where the user is a member",
        tags: ["Organization Operations"],
        security: [{ BearerAuth: [] }],
      },
    }
  )

  // GET /org/:orgDomain - Get organization by subdomain (PUBLIC)
  .get(
    "/:orgDomain",
    async ({ set, params }) => {
      try {
        const organization = await orgService.getOrganizationByDomain(
          params.orgDomain
        );

        if (!organization) {
          set.status = 404;
          return { success: false, message: "Organization not found" };
        }

        return {
          success: true,
          data: { organization },
        };
      } catch (error) {
        set.status = 500;
        return { success: false, message: "Failed to fetch organization" };
      }
    },
    {
      params: t.Object({
        orgDomain: t.String(),
      }),
      response: t.Object({
        success: t.Boolean(),
        data: t.Optional(t.Any()),
        message: t.Optional(t.String()),
      }),
      detail: {
        summary: "Get organization by subdomain",
        description: "Public endpoint to fetch organization details by subdomain (for routing)",
        tags: ["Organization Operations"],
      },
    }
  )

  // PATCH /org/:orgDomain - Update organization
  .patch(
    "/:orgDomain",
    async ({ set, params, body, bearer, cookie, jwt }) => {
      const auth = await requireAuth(jwt, bearer, cookie, set);
      if (!auth) {
        return { success: false, message: "Unauthorized" };
      }

      try {
        const updated = await orgService.updateOrganization(
          params.orgDomain,
          body,
          auth.sub
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
          if (error.message === "Only the organization owner can update it") {
            set.status = 403;
            return { success: false, message: error.message };
          }
          if (error.message === "New subdomain already exists") {
            set.status = 409;
            return { success: false, message: error.message };
          }
        }
        set.status = 500;
        return { success: false, message: "Failed to update organization" };
      }
    },
    {
      params: t.Object({
        orgDomain: t.String(),
      }),
      body: t.Object({
        name: t.Optional(t.String()),
        subdomain: t.Optional(t.String({ minLength: 3 })),
        branding: t.Optional(
          t.Object({
            logoUrl: t.Optional(t.String()),
            css: t.Optional(t.String()),
          })
        ),
      }),
      response: t.Object({
        success: t.Boolean(),
        data: t.Optional(t.Any()),
        message: t.Optional(t.String()),
      }),
      detail: {
        summary: "Update organization",
        description: "Update organization details (owner only)",
        tags: ["Organization Operations"],
        security: [{ BearerAuth: [] }],
      },
    }
  )

  // DELETE /org/:orgDomain - Delete organization
  .delete(
    "/:orgDomain",
    async ({ set, params, bearer, cookie, jwt }) => {
      const auth = await requireAuth(jwt, bearer, cookie, set);
      if (!auth) {
        return { success: false, message: "Unauthorized" };
      }

      try {
        const deleted = await orgService.deleteOrganization(
          params.orgDomain,
          auth.sub
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
          if (error.message === "Only the organization owner can delete it") {
            set.status = 403;
            return { success: false, message: error.message };
          }
        }
        set.status = 500;
        return { success: false, message: "Failed to delete organization" };
      }
    },
    {
      params: t.Object({
        orgDomain: t.String(),
      }),
      response: t.Object({
        success: t.Boolean(),
        data: t.Optional(t.Any()),
        message: t.Optional(t.String()),
      }),
      detail: {
        summary: "Delete organization",
        description: "Delete organization and all related data (owner only, cascade delete)",
        tags: ["Organization Operations"],
        security: [{ BearerAuth: [] }],
      },
    }
  );
