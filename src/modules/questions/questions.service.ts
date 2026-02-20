import { eq, and, asc, desc } from "drizzle-orm";
import { db, schema } from "../../core/database/client";
import { verifyQuizBelongsToOrg, validateOrgAccessAndGetOrgId } from "../../middleware/rbac.middleware";

export type CreateQuestionData = {
    text: string;
    mediaUrl?: string;
    timeLimit: number;
    points: number;
    options: string[];
    correctIndex: number;
    orderIndex: number;
};

export type UpdateQuestionData = {
    text?: string;
    mediaUrl?: string;
    timeLimit?: number;
    points?: number;
    options?: QuestionOption[];
    correctIndex?: number;
    orderIndex?: number;
};

export interface ReorderQuestionsRequest {
    questionIds: string[];
}

interface QuestionOption {
    text: string;
    color: 'blue' | 'red' | 'green' | 'yellow' | 'orange' | 'purple' | 'pink' | 'brown' | 'black' | 'white' | 'gray';
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

/**
 * Create a new question with org access validation
 */
export async function createQuestion(
    orgDomain: string,
    quizId: string,
    questionData: CreateQuestionRequest,
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
            text: questionData.text,
            mediaUrl: questionData.mediaUrl,
            timeLimit: questionData.timeLimit,
            points: questionData.points || 1000,
            correctIndex: questionData.correctIndex,
            orderIndex: nextOrderIndex,
            options: questionData.options,
        })
        .returning();

    return {
        status: 201,
        success: true,
        data: newQuestion,
    };
}

/**
 * List all questions for a quiz, sorted by orderIndex ASC
 * Sorting is CRITICAL for game flow
 */
export async function listQuestions(orgDomain: string, quizId: string, userId: string) {
    // Validate org access and get orgId
    const accessResult = await validateOrgAccessAndGetOrgId(orgDomain, userId);
    if (!accessResult.success) {
        throw new Error(accessResult.message);
    }
    const orgId = accessResult.orgId;

    // Verify quiz belongs to org
    const quizExists = await verifyQuizBelongsToOrg(quizId, orgId);
    if (!quizExists) {
        throw new Error("Quiz not found");
    }

    // Get questions sorted by orderIndex
    const questions = await db
        .select()
        .from(schema.questions)
        .where(eq(schema.questions.quizId, quizId))
        .orderBy(asc(schema.questions.orderIndex));

    return questions;
}

/**
 * Get a single question by ID with org access validation
 */
export async function getQuestionById(
    orgDomain: string,
    quizId: string,
    questionId: string,
    userId: string
) {
    // Validate org access and get orgId
    const accessResult = await validateOrgAccessAndGetOrgId(orgDomain, userId);
    if (!accessResult.success) {
        throw new Error(accessResult.message);
    }
    const orgId = accessResult.orgId;

    // Verify quiz belongs to org
    const quizExists = await verifyQuizBelongsToOrg(quizId, orgId);
    if (!quizExists) {
        throw new Error("Quiz not found");
    }

    // Get question
    const [question] = await db
        .select()
        .from(schema.questions)
        .where(
            and(
                eq(schema.questions.id, questionId),
                eq(schema.questions.quizId, quizId)
            )
        )
        .limit(1);

    if (!question) {
        throw new Error("Question not found");
    }

    return question;
}

/**
 * Update a question with validation
 */
export async function updateQuestion(
    orgDomain: string,
    quizId: string,
    questionId: string,
    data: UpdateQuestionData,
    userId: string
) {
    // Validate org access and get orgId
    const accessResult = await validateOrgAccessAndGetOrgId(orgDomain, userId);
    if (!accessResult.success) {
        throw new Error(accessResult.message);
    }
    const orgId = accessResult.orgId;

    // Verify quiz belongs to org
    const quizExists = await verifyQuizBelongsToOrg(quizId, orgId);
    if (!quizExists) {
        throw new Error("Quiz not found");
    }

    const [existingQuestion] = await db
        .select()
        .from(schema.questions)
        .where(
            and(
                eq(schema.questions.id, questionId),
                eq(schema.questions.quizId, quizId)
            )
        )
        .limit(1);

    if (!existingQuestion) {
        throw new Error("Question not found");
    }

    // Build update object
    const updates: Partial<typeof schema.questions.$inferInsert> = {};
    if (data.text !== undefined) updates.text = data.text;
    if (data.mediaUrl !== undefined) updates.mediaUrl = data.mediaUrl;
    if (data.timeLimit !== undefined) updates.timeLimit = data.timeLimit;
    if (data.points !== undefined) updates.points = data.points;
    if (data.options !== undefined) updates.options = data.options;
    if (data.correctIndex !== undefined) updates.correctIndex = data.correctIndex;
    if (data.orderIndex !== undefined) updates.orderIndex = data.orderIndex;

    // Update question
    const [updated] = await db
        .update(schema.questions)
        .set(updates)
        .where(eq(schema.questions.id, questionId))
        .returning();

    return updated;
}

/**
 * Delete a question with org access validation
 */
export async function deleteQuestion(
    orgDomain: string,
    quizId: string,
    questionId: string,
    userId: string
) {
    // Validate org access and get orgId
    const accessResult = await validateOrgAccessAndGetOrgId(orgDomain, userId);
    if (!accessResult.success) {
        throw new Error(accessResult.message);
    }
    const orgId = accessResult.orgId;

    // Verify quiz belongs to org
    const quizExists = await verifyQuizBelongsToOrg(quizId, orgId);
    if (!quizExists) {
        throw new Error("Quiz not found");
    }

    // Check if question exists
    const [existingQuestion] = await db
        .select()
        .from(schema.questions)
        .where(
            and(
                eq(schema.questions.id, questionId),
                eq(schema.questions.quizId, quizId)
            )
        )
        .limit(1);

    if (!existingQuestion) {
        throw new Error("Question not found");
    }

    // Delete question
    const [deleted] = await db
        .delete(schema.questions)
        .where(eq(schema.questions.id, questionId))
        .returning({ id: schema.questions.id });

    return deleted;
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
    // 1. Validate org access and get orgId
    const accessResult = await validateOrgAccessAndGetOrgId(orgDomain, userId);
    if (!accessResult.success) {
        return accessResult;
    }
    const orgId = accessResult.orgId;

    // 2. Verify quiz belongs to org
    const quizExists = await verifyQuizBelongsToOrg(quizId, orgId);
    if (!quizExists) {
        return { status: 404, success: false, message: 'Quiz not found' };
    }

    // 3. Fetch all questions in quiz
    const allQuestions = await db.query.questions.findMany({
        where: eq(schema.questions.quizId, quizId),
        columns: { id: true },
    });

    // 4. Validate: must provide ALL question IDs
    if (body.questionIds.length !== allQuestions.length) {
        return {
            status: 400,
            success: false,
            message: `Must provide all ${allQuestions.length} question IDs`,
        };
    }

    // 4. Validate: all IDs must belong to quiz
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

    // 5. Update orderIndex for each question (in transaction)
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
