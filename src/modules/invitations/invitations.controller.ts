import { Elysia, t } from "elysia";
import bearer from "@elysiajs/bearer";
import jwtPlugin from "@elysiajs/jwt";
import { jwtConfig } from "../../middleware/auth.middleware";
import { requireAuth } from "../../shared/helpers/crypto.helper";
import { getOrgIdBySubdomain, getUserRoleInOrg } from "../../middleware/rbac.middleware";
import * as invitationService from "./invitations.service";
import { logEvent } from "../../shared/helpers/log.helper";

export const invitationsRoutes = new Elysia({ prefix: "/org/:orgDomain/invitations" })
  .use(bearer())
  .use(jwtPlugin({ name: "jwt", secret: jwtConfig.secret }))

  //  POST — Create invitation -
  .post(
    "/",
    async ({ headers,  set, params, body, bearer: bearerToken, cookie, jwt  }) => {
      // 1. Auth
      const auth = await requireAuth(jwt, bearerToken, cookie, set);
      if (!auth) return { success: false, message: "Unauthorized" };

      // 2. Resolve org
      const orgId = await getOrgIdBySubdomain(params.orgDomain);
      if (!orgId) {
        set.status = 404;
        return { success: false, message: "Organization not found" };
      }

      // 3. Only SUPER_ADMIN can invite
      const role = await getUserRoleInOrg(auth.sub, orgId);
      if (role !== "SUPER_ADMIN") {
        set.status = 403;
        logEvent({ event: 'invitation.access.denied', level: 'WARNING', source: 'code', data: { userId: auth.sub, orgDomain: params.orgDomain } , orgSubdomain: headers['x-organization-domain'] });
        return { success: false, message: "Only Super Admin can send invitations" };
      }

      // 4. Create invitation
      try {
        const result = await invitationService.createInvitation(
          orgId,
          auth.sub,
          body.inviteeUsername
        );

        if (!result.success) {
          set.status = result.status;
          return { success: false, message: result.message };
        }

        return { success: true, data: result.data };
      } catch (error) {
        set.status = 500;
        return { success: false, message: "Failed to create invitation" };
      }
    },
    {
      body: t.Object({
        inviteeUsername: t.String({ minLength: 1 }),
      }),
      response: t.Object({
        success: t.Boolean(),
        data: t.Optional(t.Any()),
        message: t.Optional(t.String()),
      }),
      detail: {
        summary: "Create an invitation",
        description: "Super Admin invites a user by username. The invited user gets a PENDING invitation.",
        tags: ["Invitation Operations"],
        security: [{ BearerAuth: [] }],
      },
    }
  )

  //  DELETE  — Cancel ─
  .delete(
    "/:invitationId",
    async ({ headers,  set, params, bearer: bearerToken, cookie, jwt  }) => {
      // 1. Auth
      const auth = await requireAuth(jwt, bearerToken, cookie, set);
      if (!auth) return { success: false, message: "Unauthorized" };

      // 2. Cancel invitation
      try {
        const result = await invitationService.cancelInvitation(
          params.invitationId,
          auth.sub
        );

        if (!result.success) {
          set.status = result.status;
          return { success: false, message: result.message };
        }

        return { success: true, data: result.data };
      } catch (error) {
        set.status = 500;
        return { success: false, message: "Failed to cancel invitation" };
      }
    },
    {
      params: t.Object({
        orgDomain: t.String(),
        invitationId: t.String({ format: "uuid" }),
      }),
      response: t.Object({
        success: t.Boolean(),
        data: t.Optional(t.Any()),
        message: t.Optional(t.String()),
      }),
      detail: {
        summary: "Cancel a pending invitation",
        description: "Only the inviter (Super Admin) can cancel a pending invitation.",
        tags: ["Invitation Operations"],
        security: [{ BearerAuth: [] }],
      },
    }
  )

  //  GET  — Get by ID ─
  .get(
    "/:invitationId",
    async ({ headers,  set, params, bearer: bearerToken, cookie, jwt  }) => {
      // 1. Auth
      const auth = await requireAuth(jwt, bearerToken, cookie, set);
      if (!auth) return { success: false, message: "Unauthorized" };

      // 2. Get invitation
      try {
        const result = await invitationService.getInvitationById(
          params.invitationId,
          auth.sub
        );

        if (!result.success) {
          set.status = result.status;
          return { success: false, message: result.message };
        }

        return { success: true, data: result.data };
      } catch (error) {
        set.status = 500;
        return { success: false, message: "Failed to get invitation" };
      }
    },
    {
      params: t.Object({
        orgDomain: t.String(),
        invitationId: t.String({ format: "uuid" }),
      }),
      response: t.Object({
        success: t.Boolean(),
        data: t.Optional(t.Any()),
        message: t.Optional(t.String()),
      }),
      detail: {
        summary: "Get invitation by ID",
        description: "Accessible by the inviter or the invitee only.",
        tags: ["Invitation Operations"],
        security: [{ BearerAuth: [] }],
      },
    }
  )

  //  GET  — List all ─
  .get(
    "/",
    async ({ headers,  set, params, bearer: bearerToken, cookie, jwt  }) => {
      // 1. Auth
      const auth = await requireAuth(jwt, bearerToken, cookie, set);
      if (!auth) return { success: false, message: "Unauthorized" };

      // 2. Resolve org
      const orgId = await getOrgIdBySubdomain(params.orgDomain);
      if (!orgId) {
        set.status = 404;
        return { success: false, message: "Organization not found" };
      }

      // 3. Get user's role (may be null if not a member)
      const role = await getUserRoleInOrg(auth.sub, orgId);

      // 4. List invitations (role determines what they see)
      try {
        const result = await invitationService.getInvitationsByOrg(
          orgId,
          auth.sub,
          role
        );

        if (!result.success) {
          set.status = result.status;
          return { success: false, message: result.message };
        }

        return { success: true, data: result.data };
      } catch (error) {
        set.status = 500;
        return { success: false, message: "Failed to list invitations" };
      }
    },
    {
      response: t.Object({
        success: t.Boolean(),
        data: t.Optional(t.Any()),
        message: t.Optional(t.String()),
      }),
      detail: {
        summary: "List invitations for the organization",
        description: "Super Admin sees all invitations. Others see only invitations addressed to them.",
        tags: ["Invitation Operations"],
        security: [{ BearerAuth: [] }],
      },
    }
  );
