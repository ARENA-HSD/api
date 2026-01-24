import { Elysia, t } from "elysia";

export const orgRoutes = new Elysia({ prefix: "/org" })
  .post("/",  async ({ set, params, headers, cookie }) => {
      return {
        success: true
      };
    },
    {
      body: t.Object({
        name: t.String(),
        subdomain: t.String({ minLength: 3 }),
        branding: t.Optional(t.Object({
          logoUrl: t.Optional(t.String()),
          css: t.Optional(t.String()),
        })),
      }),
      response: t.Object({
        success: t.Boolean(),
        data: t.Optional(t.Any()),
        message: t.Optional(t.String()),
      }),
      detail: { 
	        summary: 'Create the organization', 
	        tags: ['Organization Operations'] 
	  } 
    })
  .delete("/:orgDomain",  async ({ set, params, headers, cookie }) => {
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
	        summary: 'Delete the organization', 
	        tags: ['Organization Operations'] 
	  } 
    })
  .patch("/:orgDomain",  async ({ set, params, headers, cookie }) => {
      return {
        success: true
      };
    },
    {
      body: t.Object({
        name: t.Optional(t.String()),
        subdomain: t.Optional(t.String({ minLength: 3 })),
        branding: t.Optional(t.Object({
          logoUrl: t.Optional(t.String()),
          css: t.Optional(t.String()),
        })),
      }),
      response: t.Object({
        success: t.Boolean(),
        data: t.Optional(t.Any()),
        message: t.Optional(t.String()),
      }),
      detail: { 
	        summary: 'Update the organization', 
	        tags: ['Organization Operations'] 
	  } 
    })
  .get("/:orgDomain",  async ({ set, params, headers, cookie }) => {
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
	        summary: 'Get organization by subdomain', 
	        tags: ['Organization Operations'] 
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
	        summary: 'Get all organizations', 
	        tags: ['Organization Operations'] 
	  } 
    });
