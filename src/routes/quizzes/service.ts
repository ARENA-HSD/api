
// QUIZZES SERVICE LAYER
// Business Logic & Database Operations


import { db, schema } from '../../db';
import { eq, and, desc, asc } from 'drizzle-orm';
import {
    getOrgIdBySubdomain,
    getUserRoleInOrg,
    hasQuizPermission,
    verifyQuizBelongsToOrg,
    verifyQuestionBelongsToQuiz,
} from '../../utils/rbac.helper';
import {
    sanitizeQuizTitle,
    sanitizeQuestionText,
    sanitizeUrl,
    sanitizeTimeLimit,
    sanitizePoints,
    sanitizeQuestionOptions,
} from '../../utils/sanitize.helper';


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

export interface ReorderQuestionsRequest {
    questionIds: string[];
}

// Service response types
export type ServiceResponse<T = any> =
    | { status: number; success: true; data: T; message?: string }
    | { status: number; success: false; message: string };



// VALIDATION HELPERS


function validateQuestionOptions(
    options: QuestionOption[],
    correctIndex: number
): { valid: boolean; error?: string } {
    if (!options || !Array.isArray(options)) {
        return { valid: false, error: 'Options must be an array' };
    }

    if (options.length < 2 || options.length > 6) {
        return { valid: false, error: 'Must have 2-6 options' };
    }

    for (const opt of options) {
        if (!opt.text || typeof opt.text !== 'string') {
            return { valid: false, error: 'Each option must have text' };
        }
        if (!opt.color || typeof opt.color !== 'string') {
            return { valid: false, error: 'Each option must have color' };
        }
    }

    if (correctIndex < 0 || correctIndex >= options.length) {
        return { valid: false, error: `correctIndex must be 0-${options.length - 1}` };
    }

    return { valid: true };
}


// QUIZ SERVICES


/**
 * Create a new quiz
 */
export async function createQuiz(
    orgDomain: string,
    body: CreateQuizRequest,
    userId: string
) {
    // 1. Resolve orgId from subdomain
    const orgId = await getOrgIdBySubdomain(orgDomain);
    if (!orgId) {
        return { status: 404, success: false, message: 'Organization not found' };
    }

    // 2. Check user's role in org (RBAC)
    const userRole = await getUserRoleInOrg(userId, orgId);
    if (!hasQuizPermission(userRole)) {
        return { status: 403, success: false, message: 'Insufficient permissions' };
    }

    // 3. Validate body
    if (!body.title || !body.defaultMode) {
        return { status: 400, success: false, message: 'title and defaultMode are required' };
    }

    if (body.defaultMode !== 'PERSONAL' && body.defaultMode !== 'STAGE') {
        return { status: 400, success: false, message: 'defaultMode must be PERSONAL or STAGE' };
    }

    // 4. Sanitize input
    const sanitizedTitle = sanitizeQuizTitle(body.title);

    if (sanitizedTitle.length < 3) {
        return { status: 400, success: false, message: 'Title must be at least 3 characters' };
    }

    // 5. Create quiz
    const [newQuiz] = await db
        .insert(schema.quizzes)
        .values({
            orgId,
            creatorId: userId,
            title: sanitizedTitle,
            defaultMode: body.defaultMode,
        })
        .returning();

    return {
        status: 201,
        success: true,
        data: newQuiz,
    };
}

/**
 * List all quizzes in organization
 */
export async function listQuizzes(orgDomain: string, userId: string) {
    // 1. Resolve orgId
    const orgId = await getOrgIdBySubdomain(orgDomain);
    if (!orgId) {
        return { status: 404, success: false, message: 'Organization not found' };
    }

    // 2. Check membership
    const userRole = await getUserRoleInOrg(userId, orgId);
    if (!hasQuizPermission(userRole)) {
        return { status: 403, success: false, message: 'Insufficient permissions' };
    }

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
    // 1. Resolve orgId
    const orgId = await getOrgIdBySubdomain(orgDomain);
    if (!orgId) {
        return { status: 404, success: false, message: 'Organization not found' };
    }

    // 2. Check membership
    const userRole = await getUserRoleInOrg(userId, orgId);
    if (!hasQuizPermission(userRole)) {
        return { status: 403, success: false, message: 'Insufficient permissions' };
    }

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
    // 1. Resolve orgId
    const orgId = await getOrgIdBySubdomain(orgDomain);
    if (!orgId) {
        return { status: 404, success: false, message: 'Organization not found' };
    }

    // 2. Check membership
    const userRole = await getUserRoleInOrg(userId, orgId);
    if (!hasQuizPermission(userRole)) {
        return { status: 403, success: false, message: 'Insufficient permissions' };
    }

    // 3. Verify quiz belongs to org
    const belongs = await verifyQuizBelongsToOrg(quizId, orgId);
    if (!belongs) {
        return { status: 404, success: false, message: 'Quiz not found' };
    }

    // 4. Validate updates
    if (updates.defaultMode && updates.defaultMode !== 'PERSONAL' && updates.defaultMode !== 'STAGE') {
        return { status: 400, success: false, message: 'defaultMode must be PERSONAL or STAGE' };
    }

    // 5. Build update object (only include provided fields)
    const updateData: any = {};
    if (updates.title !== undefined) {
        const sanitizedTitle = sanitizeQuizTitle(updates.title);
        if (sanitizedTitle.length < 3) {
            return { status: 400, success: false, message: 'Title must be at least 3 characters' };
        }
        updateData.title = sanitizedTitle;
    }
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
    // 1. Resolve orgId
    const orgId = await getOrgIdBySubdomain(orgDomain);
    if (!orgId) {
        return { status: 404, success: false, message: 'Organization not found' };
    }

    // 2. Check membership
    const userRole = await getUserRoleInOrg(userId, orgId);
    if (!hasQuizPermission(userRole)) {
        return { status: 403, success: false, message: 'Insufficient permissions' };
    }

    // 3. Verify quiz belongs to org
    const belongs = await verifyQuizBelongsToOrg(quizId, orgId);
    if (!belongs) {
        return { status: 404, success: false, message: 'Quiz not found' };
    }

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


// QUESTION SERVICES


/**
 * Create a new question
 */
export async function createQuestion(
    orgDomain: string,
    quizId: string,
    questionData: CreateQuestionRequest,
    userId: string
) {
    // 1. Resolve orgId
    const orgId = await getOrgIdBySubdomain(orgDomain);
    if (!orgId) {
        return { status: 404, success: false, message: 'Organization not found' };
    }

    // 2. Check membership
    const userRole = await getUserRoleInOrg(userId, orgId);
    if (!hasQuizPermission(userRole)) {
        return { status: 403, success: false, message: 'Insufficient permissions' };
    }

    // 3. Verify quiz belongs to org
    const belongs = await verifyQuizBelongsToOrg(quizId, orgId);
    if (!belongs) {
        return { status: 404, success: false, message: 'Quiz not found' };
    }

    // 4. Sanitize inputs
    const sanitizedText = sanitizeQuestionText(questionData.text);
    const sanitizedUrl = sanitizeUrl(questionData.mediaUrl);
    const sanitizedTimeLimit = sanitizeTimeLimit(questionData.timeLimit);
    const sanitizedPoints = sanitizePoints(questionData.points || 1000);
    const sanitizedOptions = sanitizeQuestionOptions(questionData.options);

    // 5. Validate sanitized options
    const validation = validateQuestionOptions(sanitizedOptions, questionData.correctIndex);
    if (!validation.valid) {
        return { status: 400, success: false, message: validation.error };
    }

    // 6. Get max orderIndex for auto-increment
    const existingQuestions = await db.query.questions.findMany({
        where: eq(schema.questions.quizId, quizId),
        columns: { orderIndex: true },
        orderBy: desc(schema.questions.orderIndex),
        limit: 1,
    });

    const nextOrderIndex = existingQuestions.length > 0
        ? existingQuestions[0].orderIndex + 1
        : 0;

    // 7. Create question
    const [newQuestion] = await db
        .insert(schema.questions)
        .values({
            quizId,
            text: sanitizedText,
            mediaUrl: sanitizedUrl,
            timeLimit: sanitizedTimeLimit,
            points: sanitizedPoints,
            correctIndex: questionData.correctIndex,
            orderIndex: nextOrderIndex,
            options: sanitizedOptions as any,
        })
        .returning();

    return {
        status: 201,
        success: true,
        data: newQuestion,
    };
}

/**
 * Update question
 */
export async function updateQuestion(
    orgDomain: string,
    quizId: string,
    questionId: string,
    updates: UpdateQuestionRequest,
    userId: string
) {
    // 1. Resolve orgId
    const orgId = await getOrgIdBySubdomain(orgDomain);
    if (!orgId) {
        return { status: 404, success: false, message: 'Organization not found' };
    }

    // 2. Check membership
    const userRole = await getUserRoleInOrg(userId, orgId);
    if (!hasQuizPermission(userRole)) {
        return { status: 403, success: false, message: 'Insufficient permissions' };
    }

    // 3. Verify question belongs to quiz in org
    const belongs = await verifyQuestionBelongsToQuiz(questionId, quizId, orgId);
    if (!belongs) {
        return { status: 404, success: false, message: 'Question not found' };
    }

    // 4. Sanitize inputs and Validate options if updating
    let sanitizedOptions = updates.options ? sanitizeQuestionOptions(updates.options) : undefined;

    if (sanitizedOptions && updates.correctIndex !== undefined) {
        // Case 1: Updating both options and correctIndex
        const validation = validateQuestionOptions(sanitizedOptions, updates.correctIndex);
        if (!validation.valid) {
            return { status: 400, success: false, message: validation.error };
        }
    } else if (sanitizedOptions) {
        // Case 2: Updating only options (must be valid with existing correctIndex)
        const existing = await db.query.questions.findFirst({
            where: eq(schema.questions.id, questionId),
            columns: { correctIndex: true },
        });

        if (existing) {
            const validation = validateQuestionOptions(sanitizedOptions, existing.correctIndex);
            if (!validation.valid) {
                return {
                    status: 400,
                    success: false,
                    message: 'New options incompatible with existing correctIndex',
                };
            }
        }
    }

    // 5. Build update object
    const updateData: any = {};
    if (updates.text !== undefined) updateData.text = sanitizeQuestionText(updates.text);
    if (updates.mediaUrl !== undefined) updateData.mediaUrl = sanitizeUrl(updates.mediaUrl);
    if (updates.timeLimit !== undefined) updateData.timeLimit = sanitizeTimeLimit(updates.timeLimit);
    if (updates.points !== undefined) updateData.points = sanitizePoints(updates.points);
    if (updates.correctIndex !== undefined) updateData.correctIndex = updates.correctIndex;
    // Use the already sanitized options
    if (sanitizedOptions !== undefined) updateData.options = sanitizedOptions as any;

    if (Object.keys(updateData).length === 0) {
        return { status: 400, success: false, message: 'No fields to update' };
    }

    // 6. Update question
    const [updatedQuestion] = await db
        .update(schema.questions)
        .set(updateData)
        .where(eq(schema.questions.id, questionId))
        .returning();

    return {
        status: 200,
        success: true,
        data: updatedQuestion,
    };
}

/**
 * Delete question (hard delete)
 */
export async function deleteQuestion(
    orgDomain: string,
    quizId: string,
    questionId: string,
    userId: string
) {
    // 1. Resolve orgId
    const orgId = await getOrgIdBySubdomain(orgDomain);
    if (!orgId) {
        return { status: 404, success: false, message: 'Organization not found' };
    }

    // 2. Check membership
    const userRole = await getUserRoleInOrg(userId, orgId);
    if (!hasQuizPermission(userRole)) {
        return { status: 403, success: false, message: 'Insufficient permissions' };
    }

    // 3. Verify question belongs to quiz in org
    const belongs = await verifyQuestionBelongsToQuiz(questionId, quizId, orgId);
    if (!belongs) {
        return { status: 404, success: false, message: 'Question not found' };
    }

    // 4. Hard delete question
    await db.delete(schema.questions).where(eq(schema.questions.id, questionId));

    return {
        status: 200,
        success: true,
        message: 'Question deleted successfully',
    };
}

/**
 * Reorder questions
 */
export async function reorderQuestions(
    orgDomain: string,
    quizId: string,
    body: ReorderQuestionsRequest,
    userId: string
) {
    // 1. Resolve orgId
    const orgId = await getOrgIdBySubdomain(orgDomain);
    if (!orgId) {
        return { status: 404, success: false, message: 'Organization not found' };
    }

    // 2. Check membership
    const userRole = await getUserRoleInOrg(userId, orgId);
    if (!hasQuizPermission(userRole)) {
        return { status: 403, success: false, message: 'Insufficient permissions' };
    }

    // 3. Verify quiz belongs to org
    const belongs = await verifyQuizBelongsToOrg(quizId, orgId);
    if (!belongs) {
        return { status: 404, success: false, message: 'Quiz not found' };
    }

    // 4. Fetch all questions in quiz
    const allQuestions = await db.query.questions.findMany({
        where: eq(schema.questions.quizId, quizId),
        columns: { id: true },
    });

    // 5. Validate: must provide ALL question IDs
    if (body.questionIds.length !== allQuestions.length) {
        return {
            status: 400,
            success: false,
            message: `Must provide all ${allQuestions.length} question IDs`,
        };
    }

    // 6. Validate: all IDs must belong to quiz
    const questionIdSet = new Set(allQuestions.map((q) => q.id));
    for (const id of body.questionIds) {
        if (!questionIdSet.has(id)) {
            return {
                status: 400,
                success: false,
                message: `Question ${id} does not belong to this quiz`,
            };
        }
    }

    // 7. Update orderIndex for each question (in transaction)
    await db.transaction(async (tx) => {
        for (let i = 0; i < body.questionIds.length; i++) {
            await tx
                .update(schema.questions)
                .set({ orderIndex: i })
                .where(eq(schema.questions.id, body.questionIds[i]));
        }
    });

    return {
        status: 200,
        success: true,
        message: 'Questions reordered successfully',
    };
}
