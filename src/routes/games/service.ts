
// GAMES SERVICE LAYER
// Business Logic & WebSocket Event Handlers


import { db, schema } from '../../db';
import { eq } from 'drizzle-orm';
import * as GamesHelper from '../../utils/games.helper';
import type {
    CreateGameRequest,
    CreateGameResponse,
    QuestionData,
    JoinRoomEvent,
    KickPlayerEvent,
    StartGameEvent,
    SubmitAnswerEvent,
    ShowLeaderboardEvent,
    NextQuestionEvent,
} from './types';


// UTILITY FUNCTIONS


/**
 * Generates a unique 6-digit PIN
 */
export async function generateUniquePIN(): Promise<string> {
    let pin: string;
    let attempts = 0;
    const maxAttempts = 10;

    do {
        pin = Math.floor(100000 + Math.random() * 900000).toString();
        const exists = await GamesHelper.getGameState(pin);
        if (!exists) return pin;
        attempts++;
    } while (attempts < maxAttempts);

    throw new Error('Failed to generate unique PIN');
}

/**
 * Calculates points earned for a correct answer
 */
export function calculatePoints(
    basePoints: number,
    timeLimit: number,
    timeRemaining: number,
    streak: number
): number {
    let points = basePoints;

    // Time bonus: more points for faster answers
    const timeBonus = Math.floor((timeRemaining / timeLimit) * (basePoints * 0.5));
    points += timeBonus;

    // Streak multiplier: 3+ correct answers gives 1.5x
    if (streak >= 2) { // 2 previous correct + this one = 3 total
        points = Math.floor(points * 1.5);
    }

    return points;
}

/**
 * PDF SPEC: Filters question options based on game mode
 */
export function filterQuestionByMode(
    question: QuestionData,
    mode: 'PERSONAL' | 'STAGE'
): any {
    if (mode === 'STAGE') {
        // STAGE mode: Hide option texts (only colors)
        return {
            qIndex: question.orderIndex,
            time: question.timeLimit,
            serverTime: Date.now(),
            // No text, no mediaUrl, only options without text
            options: question.options.map(opt => ({ text: '', color: opt.color })),
        };
    } else {
        // PERSONAL mode: Show everything
        return {
            qIndex: question.orderIndex,
            text: question.text,
            mediaUrl: question.mediaUrl,
            time: question.timeLimit,
            serverTime: Date.now(),
            options: question.options,
        };
    }
}


// GAME CREATION


/**
 * Creates a new game session
 */
export async function createGame(
    quizId: string
): Promise<{
    status: number;
    success: boolean;
    gameId: string;
    pin: string;
    mode: 'PERSONAL' | 'STAGE';
}> {
    // 1. Fetch quiz and questions from database
    const quiz = await db.query.quizzes.findFirst({
        where: eq(schema.quizzes.id, quizId),
        with: {
            questions: {
                orderBy: (questions, { asc }) => [asc(questions.orderIndex)],
            },
        },
    });

    if (!quiz || quiz.isDeleted) {
        return {
            status: 404,
            success: false,
            gameId: '',
            pin: '',
            mode: 'PERSONAL',
        };
    }

    if (!quiz.questions || quiz.questions.length === 0) {
        return {
            status: 400,
            success: false,
            gameId: '',
            pin: '',
            mode: 'PERSONAL',
        };
    }

    // 2. Generate unique PIN
    const pin = await generateUniquePIN();

    // 3. Load answer key to Redis
    const questionData: QuestionData[] = quiz.questions.map(q => ({
        id: q.id,
        text: q.text,
        mediaUrl: q.mediaUrl || undefined,
        timeLimit: q.timeLimit,
        points: q.points || 1000,
        correctIndex: q.correctIndex,
        orderIndex: q.orderIndex,
        options: q.options as any,
    }));

    await GamesHelper.loadAnswerKey(pin, questionData);

    // 4. Create game state in Redis
    await GamesHelper.createGameState(
        pin,
        quizId,
        quiz.defaultMode,
        '', // hostSocketId will be set when host connects
        questionData.length
    );

    return {
        status: 200,
        success: true,
        gameId: pin,
        pin,
        mode: quiz.defaultMode,
    };
}


// WEBSOCKET EVENT HANDLERS


/**
 * PDF SPEC: Handle JOIN_ROOM event
 */
export async function handleJoinRoom(ws: any, data: JoinRoomEvent['data']) {
    const { pin, nickname } = data;
    const ip = GamesHelper.getClientIP(ws.raw?.headers || {});

    // 1. Check if game exists
    const state = await GamesHelper.getGameState(pin);
    if (!state) {
        ws.send(JSON.stringify({
            type: 'ERROR',
            data: { message: 'Game not found' },
        }));
        return;
    }

    // 2. Check if IP is banned
    const banned = await GamesHelper.isBanned(pin, ip);
    if (banned) {
        ws.send(JSON.stringify({
            type: 'ERROR',
            data: { message: 'You have been banned from this game' },
        }));
        return;
    }

    // 3. Handle nickname duplication (PDF spec: add #1, #2, etc.)
    const existingNicknames = await GamesHelper.getAllNicknames(pin);
    const uniqueNickname = GamesHelper.handleNicknameDuplication(nickname, existingNicknames);

    // 4. Add player to game
    await GamesHelper.addPlayer(pin, ws.id, uniqueNickname, ip);

    // PDF SPEC: Add to recent players list (LTRIM to 28)
    await GamesHelper.addRecentPlayer(pin, uniqueNickname);

    // 5. Subscribe to game room
    ws.subscribe(`game:${pin}`);

    // 6. Notify player of successful join
    ws.send(JSON.stringify({
        type: 'ROOM_JOINED',
        data: {
            pin,
            nickname: uniqueNickname,
            playerCount: state.totalPlayers + 1,
        },
    }));

    // 7. Notify all players in room
    ws.publish(`game:${pin}`, JSON.stringify({
        type: 'PLAYER_JOINED',
        data: {
            nickname: uniqueNickname,
            playerCount: state.totalPlayers + 1,
        },
    }));

    // Store pin in ws.data for cleanup
    (ws.data as any).pin = pin;
    (ws.data as any).socketId = ws.id;
}

/**
 * Handle KICK_PLAYER event
 */
export async function handleKickPlayer(ws: any, data: KickPlayerEvent['data']) {
    const { socketId, ban } = data;
    const pin = (ws.data as any)?.pin;
    if (!pin) return;

    // 1. Verify sender is host
    const state = await GamesHelper.getGameState(pin);
    if (!state || state.hostSocketId !== ws.id) {
        ws.send(JSON.stringify({
            type: 'ERROR',
            data: { message: 'Only host can kick players' },
        }));
        return;
    }

    // 2. Get player info to ban IP
    const playerInfo = await GamesHelper.getPlayerInfo(pin, socketId);
    if (!playerInfo) return;

    if (ban) {
        // 3. Ban IP
        await GamesHelper.addToBanList(pin, playerInfo.ip);

    }

    // 4. Remove player
    await GamesHelper.removePlayer(pin, socketId);

    // 5. Notify everyone
    ws.publish(`game:${pin}`, JSON.stringify({
        type: 'PLAYER_KICKED',
        data: { nickname: playerInfo.nickname },
    }));
}

/**
 * PDF SPEC: Handle START_GAME event
 */
export async function handleStartGame(ws: any, data: StartGameEvent['data']) {
    const pin = data.gameId; // types.ts uses gameId

    // 1. Verify sender is host
    const state = await GamesHelper.getGameState(pin);
    if (!state || state.hostSocketId !== ws.id) {
        ws.send(JSON.stringify({
            type: 'ERROR',
            data: { message: 'Only host can start game' },
        }));
        return;
    }

    // 2. Update game status to ACTIVE
    await GamesHelper.updateGameState(pin, { status: 'ACTIVE' });

    // 3. Send first question
    await sendQuestionStart(pin, 0);
}

/**
 * PDF SPEC: Helper - Send QUESTION_START event
 */
export async function sendQuestionStart(pin: string, questionIndex: number) {
    const state = await GamesHelper.getGameState(pin);
    if (!state) return;

    // 1. Fetch quiz with questions
    const quiz = await db.query.quizzes.findFirst({
        where: eq(schema.quizzes.id, state.quizId),
        with: {
            questions: {
                orderBy: (questions, { asc }) => [asc(questions.orderIndex)],
            },
        },
    });

    if (!quiz || !quiz.questions[questionIndex]) return;

    const question = quiz.questions[questionIndex];
    const questionData = {
        id: question.id,
        text: question.text,
        mediaUrl: question.mediaUrl || undefined,
        timeLimit: question.timeLimit,
        points: question.points || 1000,
        correctIndex: question.correctIndex,
        orderIndex: question.orderIndex,
        options: question.options as any,
    };

    // 2. Update current question index
    await GamesHelper.updateGameState(pin, { currentQuestionIndex: questionIndex });

    // 3. Reset answer flags
    await GamesHelper.resetAllAnswerFlags(pin);

    // 4. Save current leaderboard snapshot (for rank changes)
    await GamesHelper.saveRankSnapshot(pin);

    // 5. Set question start time
    await GamesHelper.setQuestionStartTime(pin, Date.now());

    // 6. Send QUESTION_START (differentiated by mode)
    const filteredQuestion = filterQuestionByMode(questionData, state.mode);

    // PDF SPEC: To host (PERSONAL mode)
    (global as any).server?.publish(`game:${pin}:host`, JSON.stringify({
        type: 'QUESTION_START',
        data: { ...filteredQuestion, mode: 'PERSONAL' },
    }));

    // PDF SPEC: To players (use game mode)
    (global as any).server?.publish(`game:${pin}`, JSON.stringify({
        type: 'QUESTION_START',
        data: { ...filteredQuestion, mode: state.mode },
    }));
}

/**
 * PDF SPEC: Handle SUBMIT_ANSWER event
 */
export async function handleSubmitAnswer(ws: any, data: SubmitAnswerEvent['data']) {
    const { questionId, answerIndex } = data;
    const pin = (ws.data as any)?.pin;
    if (!pin) return;

    // 1. Acquire calculation lock (prevent double submissions)
    const state = await GamesHelper.getGameState(pin);
    if (!state) return;

    const questionIndex = state.currentQuestionIndex;
    const quiz = await db.query.quizzes.findFirst({
        where: eq(schema.quizzes.id, state.quizId),
        with: {
            questions: {
                orderBy: (questions, { asc }) => [asc(questions.orderIndex)],
            },
        },
    });

    if (!quiz || !quiz.questions[questionIndex]) return;
    const question = quiz.questions[questionIndex];

    const lockAcquired = await GamesHelper.acquireCalculationLock(pin, question.id, ws.id);
    if (!lockAcquired) {
        ws.send(JSON.stringify({
            type: 'ERROR',
            data: { message: 'Answer already submitted' },
        }));
        return;
    }

    // 2. Get player info
    const playerInfo = await GamesHelper.getPlayerInfo(pin, ws.id);
    if (!playerInfo) return;

    // 3. Check if answer is correct
    const isCorrect = await GamesHelper.checkAnswer(pin, question.id, answerIndex);

    // 4. Calculate time remaining
    const startTime = await GamesHelper.getQuestionStartTime(pin);
    const now = Date.now();
    const elapsed = startTime ? (now - startTime) / 1000 : 0;
    const timeRemaining = Math.max(0, question.timeLimit - elapsed);

    // 5. Calculate points
    const points = isCorrect
        ? calculatePoints(question.points || 1000, question.timeLimit, timeRemaining, playerInfo.streak)
        : 0;

    // 6. Update player score
    const { newScore, newStreak } = await GamesHelper.updatePlayerScore(
        pin,
        ws.id,
        points,
        isCorrect
    );

    // PDF SPEC: Store answer for statistics
    await GamesHelper.storePlayerAnswer(pin, question.id, ws.id, answerIndex);

    // 7. Increment total answers
    await GamesHelper.updateGameState(pin, {
        totalAnswers: state.totalAnswers + 1,
    });

    // 8. Get rank change
    const currentRank = await GamesHelper.getCurrentRank(pin, playerInfo.nickname);
    const previousRank = await GamesHelper.getPreviousRank(pin, playerInfo.nickname);

    // 9. Send personal result to player
    ws.send(JSON.stringify({
        type: 'ANSWER_RESULT',
        data: {
            correct: isCorrect,
            points,
            newScore,
            rank: currentRank,
            rankChange: previousRank - currentRank, // Positive = rank up
            streak: newStreak,
        },
    }));

    // 10. Check if all players answered
    const updatedState = await GamesHelper.getGameState(pin);
    if (updatedState && updatedState.totalAnswers >= updatedState.totalPlayers) {
        // Automatically show QUESTION_END after all players answered
        setTimeout(() => showQuestionEnd(pin, questionIndex, question.id), 1000);
    }
}

/**
 * PDF SPEC: Helper - Show QUESTION_END with differentiated data
 */
export async function showQuestionEnd(pin: string, questionIndex: number, questionId: string) {
    const state = await GamesHelper.getGameState(pin);
    if (!state) return;

    // PDF SPEC: Get answer statistics
    const answerStats = await GamesHelper.getAnswerStats(pin, questionId);

    // Get top 5 for this question (streak leaders)
    const streakLeaders = await GamesHelper.getStreakLeaders(pin, 5);

    // PDF SPEC: Differentiated payloads
    // To host: full stats
    (global as any).server?.publish(`game:${pin}:host`, JSON.stringify({
        type: 'QUESTION_END',
        data: {
            qIndex: questionIndex,
            answerStats, // { "0": 15, "1": 5, "2": 40, "3": 0 }
            streakLeaders,
        },
    }));

    // To players: only streak leaders
    (global as any).server?.publish(`game:${pin}`, JSON.stringify({
        type: 'QUESTION_END',
        data: {
            qIndex: questionIndex,
            streakLeaders,
        },
    }));
}

/**
 * PDF SPEC: Handle SHOW_LEADERBOARD event (manual trigger)
 */
export async function handleShowLeaderboard(ws: any, data: ShowLeaderboardEvent['data']) {
    const pin = data.gameId; // types.ts uses gameId

    // 1. Verify sender is host
    const state = await GamesHelper.getGameState(pin);
    if (!state || state.hostSocketId !== ws.id) {
        ws.send(JSON.stringify({
            type: 'ERROR',
            data: { message: 'Only host can show leaderboard' },
        }));
        return;
    }

    // 2. Show leaderboard
    await showLeaderboard(pin);
}

/**
 * PDF SPEC: Helper - Show LEADERBOARD_RESULT with differentiated data
 */
export async function showLeaderboard(pin: string) {
    const state = await GamesHelper.getGameState(pin);
    if (!state) return;

    // Get top 5 leaderboard
    const top5 = await GamesHelper.getLeaderboard(pin, 5);

    // PDF SPEC: Recent 28 players
    const recentPlayers = await GamesHelper.getRecentPlayers(pin, 28);

    // PDF SPEC: Differentiated payloads
    // To host: full top 5 + recent 28
    (global as any).server?.publish(`game:${pin}:host`, JSON.stringify({
        type: 'LEADERBOARD_RESULT',
        data: {
            top5,
            recentPlayers,
        },
    }));

    // To players: only top 5
    (global as any).server?.publish(`game:${pin}`, JSON.stringify({
        type: 'LEADERBOARD_RESULT',
        data: {
            top5,
        },
    }));
}

/**
 * Handle NEXT_QUESTION event
 */
export async function handleNextQuestion(ws: any, data: NextQuestionEvent['data']) {
    const pin = data.gameId; // types.ts uses gameId

    // 1. Verify sender is host
    const state = await GamesHelper.getGameState(pin);
    if (!state || state.hostSocketId !== ws.id) {
        ws.send(JSON.stringify({
            type: 'ERROR',
            data: { message: 'Only host can go to next question' },
        }));
        return;
    }

    // 2. Check if there are more questions
    const nextIndex = state.currentQuestionIndex + 1;
    if (nextIndex >= state.totalQuestions) {
        // Game over
        await GamesHelper.updateGameState(pin, { status: 'FINISHED' });
        const finalScores = await GamesHelper.getLeaderboard(pin, 10);

        (global as any).server?.publish(`game:${pin}`, JSON.stringify({
            type: 'GAME_OVER',
            data: { finalScores },
        }));

        // Cleanup game after 5 minutes
        setTimeout(() => GamesHelper.cleanupGame(pin), 5 * 60 * 1000);
    } else {
        // Send next question
        await sendQuestionStart(pin, nextIndex);
    }
}
