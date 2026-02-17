import { eq, and } from "drizzle-orm";
import { db, schema } from "../../core/database/client";

export type CreateOrganizationData = {
    name: string;
    subdomain: string;
    branding?: {
        logoUrl?: string;
        css?: string;
    };
};

export type UpdateOrganizationData = {
    name?: string;
    subdomain?: string;
    branding?: {
        logoUrl?: string;
        css?: string;
    };
};

/**
 * Create a new organization and automatically add the owner as SUPER_ADMIN member
 */
export async function createOrganization(
    data: CreateOrganizationData,
    ownerId: string
) {
    // Check if subdomain already exists
    const [existing] = await db
        .select()
        .from(schema.organizations)
        .where(eq(schema.organizations.subdomain, data.subdomain))
        .limit(1);

    if (existing) {
        throw new Error("Subdomain already exists");
    }

    // Create organization
    const [organization] = await db
        .insert(schema.organizations)
        .values({
            name: data.name,
            subdomain: data.subdomain,
            branding: data.branding || {},
            ownerId,
        })
        .returning();

    // Automatically add owner as SUPER_ADMIN member
    await db.insert(schema.members).values({
        orgId: organization.id,
        userId: ownerId,
        role: "SUPER_ADMIN",
    });

    return organization;
}

/**
 * Get organization by subdomain (public endpoint)
 */
export async function getOrganizationByDomain(subdomain: string) {
    const [organization] = await db
        .select()
        .from(schema.organizations)
        .where(eq(schema.organizations.subdomain, subdomain))
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
 * Update organization (only owner can update)
 */
export async function updateOrganization(
    subdomain: string,
    data: UpdateOrganizationData,
    userId: string
) {
    // Get organization
    const organization = await getOrganizationByDomain(subdomain);
    if (!organization) {
        throw new Error("Organization not found");
    }

    // Check if user is the owner
    if (organization.ownerId !== userId) {
        throw new Error("Only the organization owner can update it");
    }

    // If subdomain is being changed, check if new subdomain is available
    if (data.subdomain && data.subdomain !== subdomain) {
        const [existing] = await db
            .select()
            .from(schema.organizations)
            .where(eq(schema.organizations.subdomain, data.subdomain))
            .limit(1);

        if (existing) {
            throw new Error("New subdomain already exists");
        }
    }

    // Update organization
    const updates: Partial<typeof schema.organizations.$inferInsert> = {};
    if (data.name) updates.name = data.name;
    if (data.subdomain) updates.subdomain = data.subdomain;
    if (data.branding) updates.branding = data.branding;

    const [updated] = await db
        .update(schema.organizations)
        .set(updates)
        .where(eq(schema.organizations.id, organization.id))
        .returning();

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

    // Delete organization (cascade will delete members, quizzes, etc.)
    const [deleted] = await db
        .delete(schema.organizations)
        .where(eq(schema.organizations.id, organization.id))
        .returning({ id: schema.organizations.id });

    return deleted;
}
