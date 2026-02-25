
// ORGANIZATION & RBAC HELPERS


import { db, schema } from '../core/database/client';
import { eq, and } from 'drizzle-orm';

/**
 * Resolves organization ID from subdomain
 * Internal use only - use validateOrgAccessAndGetOrgId for public access
 */
export async function getOrgIdBySubdomain(subdomain: string): Promise<string | null> {
    const org = await db.query.organizations.findFirst({
        where: eq(schema.organizations.subdomain, subdomain),
        columns: {
            id: true,
        },
    });

    return org?.id || null;
}

/**
 * Gets user's role in an organization
 * Returns null if user is not a member
 */
export async function getUserRoleInOrg(
    userId: string,
    orgId: string
): Promise<'SUPER_ADMIN' | 'ADMIN' | 'MANAGER' | null> {
    const membership = await db.query.members.findFirst({
        where: and(
            eq(schema.members.userId, userId),
            eq(schema.members.orgId, orgId)
        ),
        columns: {
            role: true,
        },
    });

    return membership?.role || null;
}

/**
 * Checks if user has permission for an operation
 * All roles (SUPER_ADMIN, ADMIN, MANAGER) can manage quizzes/questions
 */
export function hasQuizPermission(
    role: 'SUPER_ADMIN' | 'ADMIN' | 'MANAGER' | null
): boolean {
    // All three roles can manage quizzes
    return role !== null;
}

/**
 * CONSOLIDATED: Validates organization access and returns orgId
 * Combines: org existence check → user role check → permission check
 * Returns error response or orgId in single operation
 */
export async function validateOrgAccessAndGetOrgId(
    orgDomain: string,
    userId: string
): Promise<
    | { success: true; orgId: string }
    | { status: 404; success: false; message: string }
    | { status: 403; success: false; message: string }
> {
    // 1. Resolve orgId from subdomain
    const orgId = await getOrgIdBySubdomain(orgDomain);
    if (!orgId) {
        return { status: 404, success: false, message: 'Organization not found' };
    }

    // 2. Check user's role in org
    const userRole = await getUserRoleInOrg(userId, orgId);

    // 3. Check permissions
    if (!hasQuizPermission(userRole)) {
        return { status: 403, success: false, message: 'Insufficient permissions' };
    }

    return { success: true, orgId };
}

/**
 * Verifies that a quiz belongs to a specific organization
 */
export async function verifyQuizBelongsToOrg(
    quizId: string,
    orgId: string
): Promise<boolean> {
    const quiz = await db.query.quizzes.findFirst({
        where: and(
            eq(schema.quizzes.id, quizId),
            eq(schema.quizzes.orgId, orgId),
            eq(schema.quizzes.isDeleted, false)
        ),
        columns: {
            id: true,
        },
    });

    return !!quiz;
}
