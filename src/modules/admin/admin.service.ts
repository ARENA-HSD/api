import { eq, or, ilike } from "drizzle-orm";
import { db, schema } from "../../core/database/client";

// ─── ADMIN VALIDATION ──────────────────────────────

/**
 * Validate that a user has WEB_ADMIN role
 * Throws error if user not found or not WEB_ADMIN
 */
export async function validateWEBAdminRole(userId: string) {
  const [user] = await db
    .select({ id: schema.users.id, role: schema.users.role })
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .limit(1);

  if (!user) {
    throw new Error("User not found");
  }

  if (user.role !== "WEB_ADMIN") {
    throw new Error("Access denied: WEB_ADMIN role required");
  }

  return user;
}

/**
 * Get admin dashboard summary info
 */
export async function getAdminInfo() {
  const users = await db.select({ id: schema.users.id }).from(schema.users);
  const organizations = await db
    .select({ id: schema.organizations.id })
    .from(schema.organizations);
  const quizzes = await db.select({ id: schema.quizzes.id }).from(schema.quizzes);

  return {
    userCount: users.length,
    organizationCount: organizations.length,
    quizCount: quizzes.length,
  };
}

// ─── ORGANIZATION MANAGEMENT ──────────────────────────────

/**
 * Get all organizations with pagination
 */
export async function getAllOrganizations(limit: number, offset: number) {
  // Get total count
  const countResult = await db.select().from(schema.organizations);
  const total = countResult.length;

  // Get paginated results with owner info
  const organizations = await db
    .select({
      id: schema.organizations.id,
      name: schema.organizations.name,
      subdomain: schema.organizations.subdomain,
      branding: schema.organizations.branding,
      ownerId: schema.organizations.ownerId,
      ownerUsername: schema.users.username,
      ownerEmail: schema.users.email,
      createdAt: schema.organizations.createdAt,
    })
    .from(schema.organizations)
    .innerJoin(
      schema.users,
      eq(schema.organizations.ownerId, schema.users.id)
    )
    .limit(limit)
    .offset(offset);

  return { organizations, total };
}

/**
 * Update an organization as admin
 * Can update name, subdomain, branding
 */
export async function updateOrganizationAsAdmin(
  orgId: string,
  data: {
    name?: string;
    subdomain?: string;
    branding?: Record<string, any>;
  }
) {
  // Get organization
  const [organization] = await db
    .select()
    .from(schema.organizations)
    .where(eq(schema.organizations.id, orgId))
    .limit(1);

  if (!organization) {
    throw new Error("Organization not found");
  }

  // Validate subdomain if being changed
  const forbiddenSubdomains = [
    "www", "admin", "support", "api", "mail", "ftp", "dashboard", "app",
    "blog", "shop", "help", "status", "dev", "test", "staging", "beta",
    "alpha", "demo", "portal", "secure", "server", "static", "cdn", "sys",
    "system", "root", "manager", "manage", "administrator", "moderator",
    "mod", "owner", "team", "teams", "users", "user", "member", "members",
    "account", "accounts", "billing", "finance", "pay", "payment",
    "invoices", "invoice", "subscribe", "subscription", "subscriptions",
    "auth", "login", "signin", "signup", "register", "oauth", "sso",
    "helpdesk", "contact", "contacts", "feedback", "forum", "forums",
    "community", "communities", "news", "press", "media", "legal",
    "privacy", "terms", "conditions", "policy", "policies", "about",
    "careers", "jobs", "events", "event", "webinar", "webinars",
    "docs", "documentation", "apis", "v1", "v2", "v3", "v4", "v5", "tardis"
  ];

  if (data.subdomain && forbiddenSubdomains.includes(data.subdomain.toLowerCase())) {
    throw new Error("Subdomain is not allowed");
  }

  // Check subdomain uniqueness if being changed
  if (data.subdomain && data.subdomain !== organization.subdomain) {
    const [existing] = await db
      .select()
      .from(schema.organizations)
      .where(eq(schema.organizations.subdomain, data.subdomain.toLowerCase()))
      .limit(1);

    if (existing) {
      throw new Error("Subdomain already exists");
    }
  }

  // Build update object
  const updates: Partial<typeof schema.organizations.$inferInsert> = {};
  if (data.name) updates.name = data.name;
  if (data.subdomain) updates.subdomain = data.subdomain.toLowerCase();
  if (data.branding) updates.branding = data.branding;

  // Update and return
  const [updated] = await db
    .update(schema.organizations)
    .set(updates)
    .where(eq(schema.organizations.id, orgId))
    .returning();

  return updated;
}

/**
 * Delete an organization (cascade deletes members, quizzes, questions)
 */
export async function deleteOrganizationAsAdmin(orgId: string) {
  // Check if org exists
  const [organization] = await db
    .select()
    .from(schema.organizations)
    .where(eq(schema.organizations.id, orgId))
    .limit(1);

  if (!organization) {
    throw new Error("Organization not found");
  }

  // Delete organization (cascade will handle members, quizzes, questions)
  const [deleted] = await db
    .delete(schema.organizations)
    .where(eq(schema.organizations.id, orgId))
    .returning({ id: schema.organizations.id });

  return deleted;
}

// ─── USER MANAGEMENT ──────────────────────────────

/**
 * Get all users with pagination
 */
export async function getAllUsers(limit: number, offset: number) {
  // Get total count
  const countResult = await db.select().from(schema.users);
  const total = countResult.length;

  // Get paginated results
  const users = await db
    .select({
      id: schema.users.id,
      username: schema.users.username,
      email: schema.users.email,
      role: schema.users.role,
      createdAt: schema.users.createdAt,
    })
    .from(schema.users)
    .limit(limit)
    .offset(offset);

  return { users, total };
}

/**
 * Search users by username or email (partial, case-insensitive)
 */
export async function searchUsers(
  query: string,
  limit: number,
  offset: number
) {
  if (!query || query.trim().length === 0) {
    throw new Error("Search query cannot be empty");
  }

  // Get total count for matching query
  const countResult = await db
    .select()
    .from(schema.users)
    .where(
      or(
        ilike(schema.users.username, `%${query}%`),
        ilike(schema.users.email, `%${query}%`)
      )
    );
  const total = countResult.length;

  // Get paginated results
  const users = await db
    .select({
      id: schema.users.id,
      username: schema.users.username,
      email: schema.users.email,
      role: schema.users.role,
      createdAt: schema.users.createdAt,
    })
    .from(schema.users)
    .where(
      or(
        ilike(schema.users.username, `%${query}%`),
        ilike(schema.users.email, `%${query}%`)
      )
    )
    .limit(limit)
    .offset(offset);

  return { users, total };
}

/**
 * Update a user as admin
 * Can update role, username, email
 */
export async function updateUserAsAdmin(
  userId: string,
  data: {
    role?: "USER" | "WEB_ADMIN";
    username?: string;
    email?: string;
  }
) {
  // Get user
  const [user] = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .limit(1);

  if (!user) {
    throw new Error("User not found");
  }

  // Validate role if provided
  if (data.role && data.role !== "USER" && data.role !== "WEB_ADMIN") {
    throw new Error("Invalid role. Must be USER or WEB_ADMIN");
  }

  // Validate username if provided
  if (data.username) {
    if (data.username.length < 3) {
      throw new Error("Username must be at least 3 characters");
    }
    // Check uniqueness (case-insensitive, but different from current)
    if (data.username.toLowerCase() !== user.username.toLowerCase()) {
      const [existing] = await db
        .select()
        .from(schema.users)
        .where(ilike(schema.users.username, data.username))
        .limit(1);

      if (existing) {
        throw new Error("Username already exists");
      }
    }
  }

  // Validate email if provided
  if (data.email) {
    // Check uniqueness (case-insensitive, but different from current)
    if (data.email.toLowerCase() !== user.email.toLowerCase()) {
      const [existing] = await db
        .select()
        .from(schema.users)
        .where(ilike(schema.users.email, data.email))
        .limit(1);

      if (existing) {
        throw new Error("Email already exists");
      }
    }
  }

  // Build update object
  const updates: Partial<typeof schema.users.$inferInsert> = {};
  if (data.role) updates.role = data.role;
  if (data.username) updates.username = data.username.toLocaleLowerCase();
  if (data.email) updates.email = data.email.toLocaleLowerCase();

  // Update and return
  const [updated] = await db
    .update(schema.users)
    .set(updates)
    .where(eq(schema.users.id, userId))
    .returning({
      id: schema.users.id,
      username: schema.users.username,
      email: schema.users.email,
      role: schema.users.role,
      createdAt: schema.users.createdAt,
    });

  return updated;
}

/**
 * Delete a user (hard delete with cascade)
 * Cascade: members rows deleted, owned orgs deleted (which cascade delete their members/quizzes/questions)
 */
export async function deleteUserAsAdmin(userId: string) {
  // Check if user exists
  const [user] = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .limit(1);

  if (!user) {
    throw new Error("User not found");
  }

  // Delete user (cascade will handle members, owned orgs, etc.)
  const [deleted] = await db
    .delete(schema.users)
    .where(eq(schema.users.id, userId))
    .returning({ id: schema.users.id });

  return deleted;
}
