
// QUIZZES SERVICE LAYER
// Business Logic & Database Operations


import { db, schema } from '../../core/database/client';
import { eq, and, desc, asc } from 'drizzle-orm';
import {
    validateOrgAccessAndGetOrgId,
    verifyQuizBelongsToOrg
} from '../../middleware/rbac.middleware';
import { deleteR2ObjectsByUrls } from '../../shared/helpers/r2-upload.helper';

// TYPE DEFINITIONS


interface QuestionOption {
    text: string;
    color: string;
}

export interface CreateQuizRequest {
    title: string;
    defaultMode: 'PERSONAL' | 'STAGE';
}

export interface UpdateQuizRequest {
    title?: string;
    defaultMode?: 'PERSONAL' | 'STAGE';
}

export interface CreateQuestionRequest {
    text: string;
    mediaUrl?: string;
    timeLimit: number;
    points?: number;
    correctIndex: number;
    options: QuestionOption[];
}

export interface UpdateQuestionRequest {
    text?: string;
    mediaUrl?: string;
    timeLimit?: number;
    points?: number;
    correctIndex?: number;
    options?: QuestionOption[];
}

// Service response types
export type ServiceResponse<T = any> =
    | { status: number; success: true; data: T; message?: string }
    | { status: number; success: false; message: string };

// QUIZ SERVICES


/**
 * Create a new quiz
 */
export async function createQuiz(
    orgDomain: string,
    body: CreateQuizRequest,
    userId: string
) {
    // 1. Validate org access and get orgId
    const accessResult = await validateOrgAccessAndGetOrgId(orgDomain, userId);
    if (!accessResult.success) {
        return accessResult;
    }
    const orgId = accessResult.orgId;

    // 5. Create quiz
    const [newQuiz] = await db
        .insert(schema.quizzes)
        .values({
            orgId,
            creatorId: userId,
            title: body.title,
            defaultMode: body.defaultMode,
        })
        .returning();

    return {
        status: 201,
        success: true,
        data: newQuiz,
        message: 'Quiz created successfully',
    };
}

/**
 * List all quizzes in organization
 */
export async function listQuizzes(
    orgDomain: string,
    userId: string
): Promise<
    | { status: 404; success: false; message: string }
    | { status: 403; success: false; message: string }
    | { status: 200; success: true; data: Array<{id: string; title: string; defaultMode: 'PERSONAL' | 'STAGE'; questionCount: number; createdAt: Date}> }
> {
    // 1. Validate org access and get orgId
    const accessResult = await validateOrgAccessAndGetOrgId(orgDomain, userId);
    if (!accessResult.success) {
        return accessResult as any;
    }
    const orgId = accessResult.orgId;

    // 3. Fetch quizzes with question count
    const quizzes = await db.query.quizzes.findMany({
        where: and(
            eq(schema.quizzes.orgId, orgId),
            eq(schema.quizzes.isDeleted, false)
        ),
        with: {
            questions: {
                columns: {
                    id: true,
                },
            },
        },
        orderBy: desc(schema.quizzes.createdAt),
    });

    // 4. Map to include question count
    const response = quizzes.map((quiz) => ({
        id: quiz.id,
        title: quiz.title,
        defaultMode: quiz.defaultMode,
        questionCount: quiz.questions.length,
        createdAt: quiz.createdAt,
    }));

    return {
        status: 200,
        success: true,
        data: response,
    };
}

/**
 * Get quiz by ID with questions
 */
export async function getQuizById(
    orgDomain: string,
    quizId: string,
    userId: string
) {
    // 1. Validate org access and get orgId
    const accessResult = await validateOrgAccessAndGetOrgId(orgDomain, userId);
    if (!accessResult.success) {
        return accessResult;
    }
    const orgId = accessResult.orgId;

    // 3. Fetch quiz with questions (ordered by orderIndex)
    const quiz = await db.query.quizzes.findFirst({
        where: and(
            eq(schema.quizzes.id, quizId),
            eq(schema.quizzes.orgId, orgId),
            eq(schema.quizzes.isDeleted, false)
        ),
        with: {
            questions: {
                orderBy: asc(schema.questions.orderIndex),
            },
        },
    });

    if (!quiz) {
        return { status: 404, success: false, message: 'Quiz not found' };
    }

    return {
        status: 200,
        success: true,
        data: quiz,
    };
}

/**
 * Update quiz
 */
export async function updateQuiz(
    orgDomain: string,
    quizId: string,
    updates: UpdateQuizRequest,
    userId: string
) {
    // 1. Validate org access and get orgId
    const accessResult = await validateOrgAccessAndGetOrgId(orgDomain, userId);
    if (!accessResult.success) {
        return accessResult;
    }
    const orgId = accessResult.orgId;

    // 3. Verify quiz belongs to org
    const belongs = await verifyQuizBelongsToOrg(quizId, orgId);
    if (!belongs) {
        return { status: 404, success: false, message: 'Quiz not found' };
    }
    // 5. Build update object (only include provided fields)
    const updateData: any = {};
    if (updates.defaultMode !== undefined) updateData.defaultMode = updates.defaultMode;

    if (Object.keys(updateData).length === 0) {
        return { status: 400, success: false, message: 'No fields to update' };
    }

    // 6. Update quiz
    const [updatedQuiz] = await db
        .update(schema.quizzes)
        .set(updateData)
        .where(eq(schema.quizzes.id, quizId))
        .returning();

    return {
        status: 200,
        success: true,
        data: updatedQuiz,
    };
}

/**
 * Delete quiz (soft delete)
 */
export async function deleteQuiz(
    orgDomain: string,
    quizId: string,
    userId: string
) {
    // 1. Validate org access and get orgId
    const accessResult = await validateOrgAccessAndGetOrgId(orgDomain, userId);
    if (!accessResult.success) {
        return accessResult;
    }
    const orgId = accessResult.orgId;

    // 3. Verify quiz belongs to org
    const belongs = await verifyQuizBelongsToOrg(quizId, orgId);
    if (!belongs) {
        return { status: 404, success: false, message: 'Quiz not found' };
    }

    const questionMediaRows = await db
        .select({ mediaUrl: schema.questions.mediaUrl })
        .from(schema.questions)
        .where(eq(schema.questions.quizId, quizId));

    const mediaUrls = questionMediaRows
        .map((row) => row.mediaUrl)
        .filter((url): url is string => typeof url === 'string' && url.length > 0);

    await deleteR2ObjectsByUrls(mediaUrls);

    // 4. Soft delete (set isDeleted = true)
    await db
        .update(schema.quizzes)
        .set({ isDeleted: true })
        .where(eq(schema.quizzes.id, quizId));

    return {
        status: 200,
        success: true,
        message: 'Quiz deleted successfully',
    };
}