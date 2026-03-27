import { eq, and, inArray } from "drizzle-orm";
import { db, schema } from "../../core/database/client";
import { deleteR2ObjectByUrl, deleteR2ObjectsByUrls, uploadBase64ImageToR2 } from "../../shared/helpers/r2-upload.helper";

export type CreateOrganizationData = {
    name: string;
    subdomain: string;
    branding?: Record<string, string>;
};

export type UpdateOrganizationData = {
    name?: string;
    subdomain?: string;
    branding?: Record<string, string>;
};

/**
 * Create a new organization and automatically add the owner as SUPER_ADMIN member
 */
export async function createOrganization(
    data: CreateOrganizationData,
    ownerId: string
) {

    // Check if user is already owner of an organization (optional, can own multiple orgs but maybe we want to limit to 2 or something)
    const existingOrg = await db
        .select()
        .from(schema.organizations)
        .where(eq(schema.organizations.ownerId, ownerId))
        .limit(1);

    if (existingOrg.length >= 3) { // Limit to 3 organizations per user
        throw new Error("You have reached the maximum number of organizations you can own");
    }

    // Check if subdomain includes words that are not allowed (e.g. "www", "admin", "support")
    const forbiddenSubdomains = ["www", "admin", "support", "api", "mail", "ftp", "dashboard", "app", "blog", "shop", "help", "status", "dev", "test", "staging", "beta", "alpha", "demo", "portal", "secure", "server", "static", "cdn", "sys", "system", "root", "manager", "manage", "administrator", "moderator", "mod", "owner", "team", "teams", "users", "user", "member", "members", "account", "accounts", "billing", "finance", "pay", "payment", "invoices", "invoice", "subscribe", "subscription", "subscriptions", "auth", "login", "signin", "signup", "register", "oauth", "sso", "support", "helpdesk", "contact", "contacts", "feedback", "forum", "forums", "community", "communities", "news", "press", "media", "legal", "privacy", "terms", "conditions", "policy", "policies", "about", "team", "careers", "jobs", "blog", "blogs", "events", "event", "webinar", "webinars", "docs", "documentation", "apis", "v1", "v2", "v3", "v4", "v5", "tardis"];
    if (forbiddenSubdomains.includes(data.subdomain.toLowerCase())) {
        throw new Error("Subdomain is not allowed");
    }

    // Check if subdomain already exists
    const [existing] = await db
        .select()
        .from(schema.organizations)
        .where(eq(schema.organizations.subdomain, data.subdomain.toLocaleLowerCase()))
        .limit(1);

    if (existing) {
        throw new Error("Subdomain already exists");
    }

    const normalizedSubdomain = data.subdomain.toLocaleLowerCase();
    const brandingPayload = { ...(data.branding || {}) };
    const logoBase64 = brandingPayload.logoBase64;
    if (logoBase64) {
        delete brandingPayload.logoBase64;
    }

    // Create organization
    const [organization] = await db
        .insert(schema.organizations)
        .values({
            name: data.name,
            subdomain: normalizedSubdomain,
            branding: brandingPayload,
            ownerId,
        })
        .returning();

    // Automatically add owner as SUPER_ADMIN member
    await db.insert(schema.members).values({
        orgId: organization.id,
        userId: ownerId,
        role: "SUPER_ADMIN",
    });

    if (logoBase64) {
        const logoUrl = await uploadBase64ImageToR2(
            logoBase64,
            `organizations/${organization.id}/branding`
        );

        const [updatedOrganization] = await db
            .update(schema.organizations)
            .set({
                branding: {
                    ...brandingPayload,
                    logoUrl,
                },
            })
            .where(eq(schema.organizations.id, organization.id))
            .returning();

        return updatedOrganization;
    }

    return organization;
}

/**
 * Get organization by subdomain (public endpoint)
 */
export async function getOrganizationByDomain(subdomain: string) {
    const [organization] = await db
        .select()
        .from(schema.organizations)
        .where(eq(schema.organizations.subdomain, subdomain.toLocaleLowerCase()))
        .limit(1);

    return organization || null;
}

/**
 * Get all organizations where the user is a member
 */
export async function getOrganizationsByUser(userId: string) {
    const organizations = await db
        .select({
            id: schema.organizations.id,
            name: schema.organizations.name,
            subdomain: schema.organizations.subdomain,
            branding: schema.organizations.branding,
            ownerId: schema.organizations.ownerId,
            createdAt: schema.organizations.createdAt,
            role: schema.members.role,
        })
        .from(schema.organizations)
        .innerJoin(
            schema.members,
            eq(schema.organizations.id, schema.members.orgId)
        )
        .where(eq(schema.members.userId, userId));

    return organizations;
}

/**
 * Update organization
 * name/subdomain → SUPER_ADMIN only
 * branding → SUPER_ADMIN + ADMIN
 */
export async function updateOrganization(
    subdomain: string,
    data: UpdateOrganizationData,
    userId: string,
    userRole: 'SUPER_ADMIN' | 'ADMIN' | 'MANAGER' | null
) {
    // Get organization
    const organization = await getOrganizationByDomain(subdomain);
    if (!organization) {
        throw new Error("Organization not found");
    }

    // Must be a member
    if (!userRole) {
        throw new Error("Not a member of this organization");
    }

    // name/subdomain → only SUPER_ADMIN
    if ((data.name || data.subdomain) && userRole !== 'SUPER_ADMIN') {
        throw new Error("Only Super Admin can change organization name or subdomain");
    }

    // branding → SUPER_ADMIN + ADMIN
    if (data.branding && userRole !== 'SUPER_ADMIN' && userRole !== 'ADMIN') {
        throw new Error("Only Super Admin or Admin can update branding");
    }

    // Check if subdomain includes words that are not allowed (e.g. "www", "admin", "support")
    const forbiddenSubdomains = ["www", "admin", "support", "api", "mail", "ftp", "dashboard", "app", "blog", "shop", "help", "status", "dev", "test", "staging", "beta", "alpha", "demo", "portal", "secure", "server", "static", "cdn", "sys", "system", "root", "manager", "manage", "administrator", "moderator", "mod", "owner", "team", "teams", "users", "user", "member", "members", "account", "accounts", "billing", "finance", "pay", "payment", "invoices", "invoice", "subscribe", "subscription", "subscriptions", "auth", "login", "signin", "signup", "register", "oauth", "sso", "support", "helpdesk", "contact", "contacts", "feedback", "forum", "forums", "community", "communities", "news", "press", "media", "legal", "privacy", "terms", "conditions", "policy", "policies", "about", "team", "careers", "jobs", "blog", "blogs", "events", "event", "webinar", "webinars", "docs", "documentation", "apis", "v1", "v2", "v3", "v4", "v5", "tardis"];
    if (data.subdomain && forbiddenSubdomains.includes(data.subdomain.toLowerCase())) {
        throw new Error("Subdomain is not allowed");
    }

    // If subdomain is being changed, check if new subdomain is available
    if (data.subdomain && data.subdomain !== subdomain) {
        const [existing] = await db
            .select()
            .from(schema.organizations)
            .where(eq(schema.organizations.subdomain, data.subdomain.toLocaleLowerCase()))
            .limit(1);

        if (existing) {
            throw new Error("New subdomain already exists");
        }
    }

    // Update organization
    const updates: Partial<typeof schema.organizations.$inferInsert> = {};
    const currentBranding = organization.branding as Record<string, unknown> | null;
    const currentLogoUrl = currentBranding && typeof currentBranding.logoUrl === "string"
        ? currentBranding.logoUrl
        : null;
    let logoUrlToDelete: string | null = null;

    if (data.name) updates.name = data.name;
    if (data.subdomain) updates.subdomain = data.subdomain.toLocaleLowerCase();
    if (data.branding) {
        const brandingPayload = { ...data.branding };
        const logoBase64 = brandingPayload.logoBase64;

        if (logoBase64) {
            const newLogoUrl = await uploadBase64ImageToR2(
                logoBase64,
                `organizations/${organization.id}/branding`
            );
            brandingPayload.logoUrl = newLogoUrl;
            delete brandingPayload.logoBase64;
            if (currentLogoUrl && currentLogoUrl !== newLogoUrl) {
                logoUrlToDelete = currentLogoUrl;
            }
        } else if (Object.prototype.hasOwnProperty.call(brandingPayload, "logoUrl")) {
            const nextLogoUrl = brandingPayload.logoUrl;
            if (currentLogoUrl && currentLogoUrl !== nextLogoUrl) {
                logoUrlToDelete = currentLogoUrl;
            }
        }

        updates.branding = brandingPayload;
    }

    const [updated] = await db
        .update(schema.organizations)
        .set(updates)
        .where(eq(schema.organizations.id, organization.id))
        .returning();

    if (logoUrlToDelete) {
        try {
            await deleteR2ObjectByUrl(logoUrlToDelete);
        } catch {
            // Best effort cleanup: keep successful DB update even if storage cleanup fails.
        }
    }

    return updated;
}

/**
 * Delete organization (only owner can delete, cascade delete will handle members)
 */
export async function deleteOrganization(subdomain: string, userId: string) {
    // Get organization
    const organization = await getOrganizationByDomain(subdomain);
    if (!organization) {
        throw new Error("Organization not found");
    }

    // Check if user is the owner
    if (organization.ownerId !== userId) {
        throw new Error("Only the organization owner can delete it");
    }

    const quizzes = await db
        .select({ id: schema.quizzes.id })
        .from(schema.quizzes)
        .where(eq(schema.quizzes.orgId, organization.id));

    const quizIds = quizzes.map((quiz) => quiz.id);
    const questionMediaRows = quizIds.length > 0
        ? await db
            .select({ mediaUrl: schema.questions.mediaUrl })
            .from(schema.questions)
            .where(inArray(schema.questions.quizId, quizIds))
        : [];

    const branding = organization.branding as Record<string, unknown> | null;
    const logoUrl = branding && typeof branding.logoUrl === "string"
        ? branding.logoUrl
        : null;

    const urlsToDelete = questionMediaRows
        .map((row) => row.mediaUrl)
        .filter((url): url is string => typeof url === "string" && url.length > 0);

    if (logoUrl) {
        urlsToDelete.push(logoUrl);
    }

    await deleteR2ObjectsByUrls(urlsToDelete);

    // Delete organization (cascade will delete members, quizzes, etc.)
    const [deleted] = await db
        .delete(schema.organizations)
        .where(eq(schema.organizations.id, organization.id))
        .returning({ id: schema.organizations.id });

    return deleted;
}

// ─── MEMBER MANAGEMENT ──────────────────────────────

/**
 * Get all members of an organization with user details
 */
export async function getOrgMembers(orgId: string) {
    const memberList = await db
        .select({
            userId: schema.members.userId,
            username: schema.users.username,
            email: schema.users.email,
            role: schema.members.role,
            joinedAt: schema.members.joinedAt,
        })
        .from(schema.members)
        .innerJoin(schema.users, eq(schema.members.userId, schema.users.id))
        .where(eq(schema.members.orgId, orgId));

    return memberList;
}

/**
 * Update a member's role (SUPER_ADMIN only)
 * Cannot change own role, cannot assign SUPER_ADMIN
 */
export async function updateMemberRole(
    orgId: string,
    targetUserId: string,
    newRole: 'ADMIN' | 'MANAGER',
    requesterId: string
) {
    // Cannot change own role
    if (targetUserId === requesterId) {
        throw new Error("Cannot change your own role");
    }

    // Find the target member
    const [targetMember] = await db
        .select()
        .from(schema.members)
        .where(
            and(
                eq(schema.members.orgId, orgId),
                eq(schema.members.userId, targetUserId)
            )
        )
        .limit(1);

    if (!targetMember) {
        throw new Error("User is not a member of this organization");
    }

    // Cannot change SUPER_ADMIN's role
    if (targetMember.role === 'SUPER_ADMIN') {
        throw new Error("Cannot change Super Admin's role");
    }

    // Update role
    const [updated] = await db
        .update(schema.members)
        .set({ role: newRole })
        .where(eq(schema.members.id, targetMember.id))
        .returning();

    return updated;
}

/**
 * Remove a member from an organization (SUPER_ADMIN only)
 * Cannot remove yourself
 */
export async function removeMember(
    orgId: string,
    targetUserId: string,
    requesterId: string
) {
    // Cannot remove yourself
    if (targetUserId === requesterId) {
        throw new Error("Cannot remove yourself from the organization");
    }

    // Find the target member
    const [targetMember] = await db
        .select()
        .from(schema.members)
        .where(
            and(
                eq(schema.members.orgId, orgId),
                eq(schema.members.userId, targetUserId)
            )
        )
        .limit(1);

    if (!targetMember) {
        throw new Error("User is not a member of this organization");
    }

    // Delete member
    await db
        .delete(schema.members)
        .where(eq(schema.members.id, targetMember.id));

    return { userId: targetUserId };
}
