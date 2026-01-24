import { Elysia, t } from "elysia";

export const invitationsRoutes = new Elysia({ prefix: "/org/:orgDomain/invitations" })
  .post("/",  async ({ set, params, headers, cookie }) => {
      return {
        success: true
      };
    },
    {
      body: t.Object({
        inviteeUsername: t.String(),
      }),
      response: t.Object({
        success: t.Boolean(),
        data: t.Optional(t.Any()),
        message: t.Optional(t.String()),
      }),
      detail: { 
	        summary: 'Create the invitation', 
            description: 'Cookieden inviterId alırsınız. orgDomain parametreden gelir. usernamdende inviteeId bulunur ve davet oluşturulur.',
	        tags: ['Invitation Operations'] 
	  } 
    })
  .delete("/:invitationId",  async ({ set, params, headers, cookie }) => {
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
	        summary: 'Delete the invitation', 
	        tags: ['Invitation Operations'] 
	  } 
    })
  .patch("/:invitationId",  async ({ set, params, headers, cookie }) => {
      return {
        success: true
      };
    },
    {
      body: t.Object({
        status: t.Optional(t.String()),
      }),
      response: t.Object({
        success: t.Boolean(),
        data: t.Optional(t.Any()),
        message: t.Optional(t.String()),
      }),
      detail: { 
	        summary: 'Update the invitation', 
	        tags: ['Invitation Operations'] 
	  } 
    })
  .get("/:invitationId",  async ({ set, params, headers, cookie }) => {
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
	        summary: 'Get invitation by ID', 
	        tags: ['Invitation Operations'] 
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
	        summary: 'Get all invitations for the organization', 
	        tags: ['Invitation Operations'] 
	  } 
    });
