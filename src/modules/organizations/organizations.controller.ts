import { Elysia, t } from "elysia";
import bearer from "@elysiajs/bearer";
import jwtPlugin from "@elysiajs/jwt";
import { jwtConfig } from "../../middleware/auth.middleware";
import { requireAuth } from "../../shared/helpers/crypto.helper";
import { getOrgIdBySubdomain, getUserRoleInOrg } from "../../middleware/rbac.middleware";
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
        subdomain: t.String({
          minLength: 3,
          maxLength: 20,
          pattern: '^[a-zA-Z0-9]+$',
        }),
        // Esnek key-value branding yapisi (key max 50, value max 500 karakter)
        branding: t.Optional(t.Record(
          t.String({ maxLength: 50 }),
          t.String({ maxLength: 500 }),
          { default: { primary: "#97abf5", secondary: "#ffffff", logoUrl: "https://example.com/logo.png" } }
        )),
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

      // Resolve org and get user's role
      const orgId = await getOrgIdBySubdomain(params.orgDomain);
      if (!orgId) {
        set.status = 404;
        return { success: false, message: "Organization not found" };
      }
      const role = await getUserRoleInOrg(auth.sub, orgId);

      try {
        const updated = await orgService.updateOrganization(
          params.orgDomain,
          body,
          auth.sub,
          role
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
          if (error.message === "Not a member of this organization" ||
            error.message.startsWith("Only Super Admin") ||
            error.message.startsWith("Only Super Admin or Admin")) {
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
        // Esnek key-value branding yapisi (key max 50, value max 500 karakter)
        branding: t.Optional(t.Record(
          t.String({ maxLength: 50 }),
          t.String({ maxLength: 500 }),
          { default: { primary: "#97abf5", secondary: "#ffffff", logoUrl: "https://example.com/logo.png" } }
        )),
      }),
      response: t.Object({
        success: t.Boolean(),
        data: t.Optional(t.Any()),
        message: t.Optional(t.String()),
      }),
      detail: {
        summary: "Update organization",
        description: "name/subdomain: Super Admin only. branding: Super Admin + Admin.",
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
  )

  // ─── MEMBER MANAGEMENT ENDPOINTS ─────────────────────

  // GET /org/:orgDomain/members - List members
  .get(
    "/:orgDomain/members",
    async ({ set, params, bearer, cookie, jwt }) => {
      const auth = await requireAuth(jwt, bearer, cookie, set);
      if (!auth) {
        return { success: false, message: "Unauthorized" };
      }

      const orgId = await getOrgIdBySubdomain(params.orgDomain);
      if (!orgId) {
        set.status = 404;
        return { success: false, message: "Organization not found" };
      }

      // Only SUPER_ADMIN and ADMIN can list members
      const role = await getUserRoleInOrg(auth.sub, orgId);
      if (role !== "SUPER_ADMIN" && role !== "ADMIN") {
        set.status = 403;
        return { success: false, message: "Only Super Admin or Admin can view members" };
      }

      try {
        const members = await orgService.getOrgMembers(orgId);
        return { success: true, data: { members } };
      } catch (error) {
        set.status = 500;
        return { success: false, message: "Failed to fetch members" };
      }
    },
    {
      params: t.Object({ orgDomain: t.String() }),
      response: t.Object({
        success: t.Boolean(),
        data: t.Optional(t.Any()),
        message: t.Optional(t.String()),
      }),
      detail: {
        summary: "List organization members",
        description: "Super Admin and Admin can view all members with their roles.",
        tags: ["Organization Operations"],
        security: [{ BearerAuth: [] }],
      },
    }
  )

  // PATCH /org/:orgDomain/members/:userId - Change member role
  .patch(
    "/:orgDomain/members/:userId",
    async ({ set, params, body, bearer, cookie, jwt }) => {
      const auth = await requireAuth(jwt, bearer, cookie, set);
      if (!auth) {
        return { success: false, message: "Unauthorized" };
      }

      const orgId = await getOrgIdBySubdomain(params.orgDomain);
      if (!orgId) {
        set.status = 404;
        return { success: false, message: "Organization not found" };
      }

      // Only SUPER_ADMIN can change roles
      const role = await getUserRoleInOrg(auth.sub, orgId);
      if (role !== "SUPER_ADMIN") {
        set.status = 403;
        return { success: false, message: "Only Super Admin can change member roles" };
      }

      // Validate new role
      if (body.role !== "ADMIN" && body.role !== "MANAGER") {
        set.status = 400;
        return { success: false, message: "Role must be ADMIN or MANAGER" };
      }

      try {
        const updated = await orgService.updateMemberRole(
          orgId,
          params.userId,
          body.role,
          auth.sub
        );
        return {
          success: true,
          data: { member: updated },
          message: "Member role updated successfully",
        };
      } catch (error) {
        if (error instanceof Error) {
          if (error.message === "User is not a member of this organization") {
            set.status = 404;
            return { success: false, message: error.message };
          }
          if (error.message === "Cannot change your own role" ||
            error.message === "Cannot change Super Admin's role") {
            set.status = 400;
            return { success: false, message: error.message };
          }
        }
        set.status = 500;
        return { success: false, message: "Failed to update member role" };
      }
    },
    {
      params: t.Object({
        orgDomain: t.String(),
        userId: t.String({ format: "uuid" }),
      }),
      body: t.Object({
        role: t.String(),
      }),
      response: t.Object({
        success: t.Boolean(),
        data: t.Optional(t.Any()),
        message: t.Optional(t.String()),
      }),
      detail: {
        summary: "Change member role",
        description: "Super Admin can change a member's role to ADMIN or MANAGER.",
        tags: ["Organization Operations"],
        security: [{ BearerAuth: [] }],
      },
    }
  )

  // DELETE /org/:orgDomain/members/:userId - Remove member
  .delete(
    "/:orgDomain/members/:userId",
    async ({ set, params, bearer, cookie, jwt }) => {
      const auth = await requireAuth(jwt, bearer, cookie, set);
      if (!auth) {
        return { success: false, message: "Unauthorized" };
      }

      const orgId = await getOrgIdBySubdomain(params.orgDomain);
      if (!orgId) {
        set.status = 404;
        return { success: false, message: "Organization not found" };
      }

      // Only SUPER_ADMIN can remove members
      const role = await getUserRoleInOrg(auth.sub, orgId);
      if (role !== "SUPER_ADMIN") {
        set.status = 403;
        return { success: false, message: "Only Super Admin can remove members" };
      }

      try {
        const removed = await orgService.removeMember(
          orgId,
          params.userId,
          auth.sub
        );
        return {
          success: true,
          data: removed,
          message: "Member removed successfully",
        };
      } catch (error) {
        if (error instanceof Error) {
          if (error.message === "User is not a member of this organization") {
            set.status = 404;
            return { success: false, message: error.message };
          }
          if (error.message === "Cannot remove yourself from the organization") {
            set.status = 400;
            return { success: false, message: error.message };
          }
        }
        set.status = 500;
        return { success: false, message: "Failed to remove member" };
      }
    },
    {
      params: t.Object({
        orgDomain: t.String(),
        userId: t.String({ format: "uuid" }),
      }),
      response: t.Object({
        success: t.Boolean(),
        data: t.Optional(t.Any()),
        message: t.Optional(t.String()),
      }),
      detail: {
        summary: "Remove member from organization",
        description: "Super Admin can remove any member except themselves.",
        tags: ["Organization Operations"],
        security: [{ BearerAuth: [] }],
      },
    }
  );
