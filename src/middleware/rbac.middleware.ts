
// ORGANIZATION & RBAC HELPERS


import { db, schema } from '../core/database/client';
import { eq, and } from 'drizzle-orm';

/**
 * Resolves organization ID from subdomain
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
 * Checks if user can delete organization (only SUPER_ADMIN)
 */
export function canDeleteOrganization(
    role: 'SUPER_ADMIN' | 'ADMIN' | 'MANAGER' | null
): boolean {
    return role === 'SUPER_ADMIN';
}

/**
 * Checks if user can invite admins (only SUPER_ADMIN)
 */
export function canInviteAdmins(
    role: 'SUPER_ADMIN' | 'ADMIN' | 'MANAGER' | null
): boolean {
    return role === 'SUPER_ADMIN';
}

/**
 * Checks if user can manage white-label settings (SUPER_ADMIN or ADMIN)
 */
export function canManageWhiteLabel(
    role: 'SUPER_ADMIN' | 'ADMIN' | 'MANAGER' | null
): boolean {
    return role === 'SUPER_ADMIN' || role === 'ADMIN';
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

/**
 * Verifies that a question belongs to a quiz in a specific org
 */
export async function verifyQuestionBelongsToQuiz(
    questionId: string,
    quizId: string,
    orgId: string
): Promise<boolean> {
    const question = await db.query.questions.findFirst({
        where: eq(schema.questions.id, questionId),
        with: {
            quiz: {
                columns: {
                    id: true,
                    orgId: true,
                    isDeleted: true,
                },
            },
        },
    });

    if (!question) return false;
    if (!question.quiz) return false;
    if (question.quiz.isDeleted) return false;
    if (question.quiz.id !== quizId) return false;
    if (question.quiz.orgId !== orgId) return false;

    return true;
}
