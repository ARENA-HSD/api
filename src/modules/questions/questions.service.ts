import { eq, and, asc } from "drizzle-orm";
import { db, schema } from "../../core/database/client";

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
    options?: string[];
    correctIndex?: number;
    orderIndex?: number;
};

/**
 * Validation helper for question data
 * Enforces strict rules: 4 options, correctIndex 0-3, timeLimit 10-120, points ≥100
 */
export function validateQuestionData(data: {
    options?: string[];
    correctIndex?: number;
    timeLimit?: number;
    points?: number;
    text?: string;
}): { valid: boolean; error?: string } {
    // Text validation (minimum 5 characters)
    if (data.text !== undefined && data.text.length < 5) {
        return { valid: false, error: "Text must be at least 5 characters" };
    }

    // Options validation - MUST be exactly 4 items
    if (data.options !== undefined && data.options.length !== 4) {
        return { valid: false, error: "Options must have exactly 4 items" };
    }

    // CorrectIndex validation - MUST be 0-3
    if (
        data.correctIndex !== undefined &&
        (data.correctIndex < 0 || data.correctIndex > 3)
    ) {
        return { valid: false, error: "correctIndex must be between 0 and 3" };
    }

    // TimeLimit validation - MUST be 10-120 seconds
    if (
        data.timeLimit !== undefined &&
        (data.timeLimit < 10 || data.timeLimit > 120)
    ) {
        return { valid: false, error: "timeLimit must be between 10 and 120" };
    }

    // Points validation - MUST be at least 100
    if (data.points !== undefined && data.points < 100) {
        return { valid: false, error: "points must be at least 100" };
    }

    return { valid: true };
}

/**
 * Validate hierarchy: Organization exists → Quiz exists → Quiz belongs to Organization
 * This "triple check" prevents orphaned data
 */
async function validateHierarchy(orgDomain: string, quizId: string) {
    // 1. Check if organization exists
    const [organization] = await db
        .select()
        .from(schema.organizations)
        .where(eq(schema.organizations.subdomain, orgDomain))
        .limit(1);

    if (!organization) {
        throw new Error("Organization not found");
    }

    // 2. Check if quiz exists and belongs to organization
    const [quiz] = await db
        .select()
        .from(schema.quizzes)
        .where(
            and(
                eq(schema.quizzes.id, quizId),
                eq(schema.quizzes.orgId, organization.id)
            )
        )
        .limit(1);

    if (!quiz) {
        throw new Error("Quiz not found in organization");
    }

    return { organization, quiz };
}

/**
 * Create a new question with hierarchy validation
 */
export async function createQuestion(
    orgDomain: string,
    quizId: string,
    data: CreateQuestionData
) {
    // Validate question data
    const validation = validateQuestionData(data);
    if (!validation.valid) {
        throw new Error(validation.error);
    }

    // Validate hierarchy (org > quiz)
    await validateHierarchy(orgDomain, quizId);

    // Create question
    const [question] = await db
        .insert(schema.questions)
        .values({
            quizId,
            text: data.text,
            mediaUrl: data.mediaUrl,
            timeLimit: data.timeLimit,
            points: data.points,
            options: data.options,
            correctIndex: data.correctIndex,
            orderIndex: data.orderIndex,
        })
        .returning();

    return question;
}

/**
 * List all questions for a quiz, sorted by orderIndex ASC
 * Sorting is CRITICAL for game flow
 */
export async function listQuestions(orgDomain: string, quizId: string) {
    // Validate hierarchy
    await validateHierarchy(orgDomain, quizId);

    // Get questions sorted by orderIndex
    const questions = await db
        .select()
        .from(schema.questions)
        .where(eq(schema.questions.quizId, quizId))
        .orderBy(asc(schema.questions.orderIndex));

    return questions;
}

/**
 * Get a single question by ID with hierarchy validation
 */
export async function getQuestionById(
    orgDomain: string,
    quizId: string,
    questionId: string
) {
    // Validate hierarchy
    await validateHierarchy(orgDomain, quizId);

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
    data: UpdateQuestionData
) {
    // Validate question data
    const validation = validateQuestionData(data);
    if (!validation.valid) {
        throw new Error(validation.error);
    }

    // Validate hierarchy and get question
    await validateHierarchy(orgDomain, quizId);

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
 * Delete a question with hierarchy validation
 */
export async function deleteQuestion(
    orgDomain: string,
    quizId: string,
    questionId: string
) {
    // Validate hierarchy
    await validateHierarchy(orgDomain, quizId);

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
