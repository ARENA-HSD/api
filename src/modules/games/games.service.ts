
// GAMES SERVICE LAYER
// Business Logic & WebSocket Event Handlers


import { db, schema } from '../../core/database/client';
import { eq } from 'drizzle-orm';
import * as GamesHelper from '../../core/cache/repositories/game.repository';
import { logEvent } from '../../shared/helpers/log.helper';
import { isSocketAlive } from '../../core/pubsub/broadcaster';
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
    ReconnectEvent,
} from './games.types';


// Local in-memory timers for question end scheduling per game pin
const questionTimers = new Map<string, ReturnType<typeof setTimeout>>();

// Grace period timers: keyed by "pin:sessionToken" — if player doesn't reconnect within GRACE_PERIOD_MS, remove them
const disconnectTimers = new Map<string, ReturnType<typeof setTimeout>>();
const GRACE_PERIOD_MS = parseInt(process.env.RECONNECT_GRACE_PERIOD_MS || '30000', 10); // 30 seconds default

function clearLocalQuestionTimer(pin: string) {
    const t = questionTimers.get(pin);
    if (t) {
        clearTimeout(t);
        questionTimers.delete(pin);
    }
}


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
        logEvent({ event: 'game.join.invalid_pin', level: 'WARNING', source: 'code', data: { pin } });
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

    // Refresh state after adding player
    const updatedState = await GamesHelper.getGameState(pin);

    // Guard: If this socket is already the host, don't re-process
    if (updatedState && updatedState.hostSocketId === ws.id) {
        ws.send(JSON.stringify({
            type: 'JOIN_SUCCESS',
            data: { status: 'WAITING', myNick: nickname, sessionToken: updatedState.hostSessionToken || undefined },
        }));
        (ws.data as any).pin = pin;
        (ws.data as any).socketId = ws.id;
        return;
    }

    // Guard: If this socket is already a registered player, don't add again
    const existingPlayerInfo = await GamesHelper.getPlayerInfo(pin, ws.id);
    if (existingPlayerInfo) {
        ws.send(JSON.stringify({
            type: 'JOIN_SUCCESS',
            data: { status: 'WAITING', myNick: existingPlayerInfo.nickname, sessionToken: existingPlayerInfo.sessionToken || undefined },
        }));
        (ws.data as any).pin = pin;
        (ws.data as any).socketId = ws.id;
        return;
    }

    // Host reconnection: hostSocketId is set but old socket is dead (page navigation)
    if (updatedState && updatedState.hostSocketId) {
        if (!isSocketAlive(updatedState.hostSocketId)) {
            console.log(`Host reconnected via JOIN_ROOM: old=${updatedState.hostSocketId} new=${ws.id} pin=${pin}`);
            // Generate new sessionToken for host if they don't have one
            const hostSessionToken = updatedState.hostSessionToken || crypto.randomUUID();
            await GamesHelper.updateGameState(pin, { hostSocketId: ws.id, hostSessionToken });
            await GamesHelper.createSession(pin, ws.id, hostSessionToken);
            ws.subscribe(`game:${pin}:host`);
            ws.send(JSON.stringify({
                type: 'JOIN_SUCCESS',
                data: { status: 'WAITING', myNick: nickname, sessionToken: hostSessionToken },
            }));
            (ws.data as any).pin = pin;
            (ws.data as any).socketId = ws.id;
            return;
        }
    }

    // If no host assigned yet, set this socket as host and subscribe to host channel
    if (updatedState && !updatedState.hostSocketId) {
        const hostSessionToken = crypto.randomUUID();
        await GamesHelper.updateGameState(pin, { hostSocketId: ws.id, hostSessionToken });
        await GamesHelper.createSession(pin, ws.id, hostSessionToken);
        ws.subscribe(`game:${pin}:host`);

        ws.send(JSON.stringify({
            type: 'JOIN_SUCCESS',
            data: { status: 'WAITING', myNick: uniqueNickname, sessionToken: hostSessionToken },
        }));
    } else {
        // 4. Add player to game
        await GamesHelper.addPlayer(pin, ws.id, uniqueNickname, ip);

        // Generate sessionToken for player
        const playerSessionToken = crypto.randomUUID();
        await GamesHelper.createSession(pin, ws.id, playerSessionToken);
        // Store sessionToken in player info hash
        const playerInfoKey = `game:${pin}:player:${ws.id}`;
        await GamesHelper.redis.hset(playerInfoKey, 'sessionToken', playerSessionToken);

        // PDF SPEC: Add to recent players list (LTRIM to 28)
        await GamesHelper.addRecentPlayer(pin, uniqueNickname);
        // 5. Subscribe to game room
        ws.subscribe(`game:${pin}`);
        ws.subscribe(`game:${pin}:player:${ws.id}`);

        ws.send(JSON.stringify({
            type: 'JOIN_SUCCESS',
            data: { status: 'WAITING', myNick: uniqueNickname, sessionToken: playerSessionToken },
        }));
    }

    // 7. Notify all players in room (PLAYER_JOINED)
    try {

        const { publish } = await import('../../core/pubsub/broadcaster');

        // Also broadcast LOBBY_UPDATE after join so clients refresh lobby immediately
        const players = await GamesHelper.getAllPlayerSockets(pin);
        const playerList: { socketId: string; nickname: string }[] = [];
        for (const sid of players) {
            const info = await GamesHelper.getPlayerInfo(pin, sid);
            if (info) {
                playerList.push({ socketId: sid, nickname: info.nickname });
            }
        }

        const recentPlayers = await GamesHelper.getRecentPlayers(pin, 28);

        await publish(`game:${pin}:host`, JSON.stringify({
            type: 'LOBBY_UPDATE',
            data: {
                count: playerList.length,
                recentPlayers
            }
        }));
    } catch (err) {
        console.error('Failed to broadcast lobby update on join', err);
        logEvent({ event: 'ws.broadcast.error', level: 'ERROR', source: 'system', data: { error: err instanceof Error ? err.message : 'unknown', context: 'lobby_update_join' } });
    }

    // Store pin in ws.data for cleanup
    (ws.data as any).pin = pin;
    (ws.data as any).socketId = ws.id;
}


/**
 * Handle RECONNECT event — restores player/host session after connection drop
 */
export async function handleReconnect(ws: any, data: ReconnectEvent['data']) {
    const { pin, sessionToken } = data;

    // 1. Validate game exists
    const state = await GamesHelper.getGameState(pin);
    if (!state) {
        ws.send(JSON.stringify({ type: 'ERROR', data: { message: 'Game not found' } }));
        return;
    }

    // 2. Look up old socketId from session token
    const oldSocketId = await GamesHelper.getSocketBySession(pin, sessionToken);
    if (!oldSocketId) {
        ws.send(JSON.stringify({ type: 'ERROR', data: { message: 'Session expired or invalid' } }));
        return;
    }

    const newSocketId = ws.id;
    const isHost = state.hostSessionToken === sessionToken;

    // 3. Cancel grace period timer if active
    const timerKey = `${pin}:${sessionToken}`;
    const existingTimer = disconnectTimers.get(timerKey);
    if (existingTimer) {
        clearTimeout(existingTimer);
        disconnectTimers.delete(timerKey);
    }

    // 4. Get player info from old socket (before migration)
    const playerInfo = await GamesHelper.getPlayerInfo(pin, oldSocketId);

    if (isHost) {
        // HOST RECONNECT
        await GamesHelper.updateGameState(pin, { hostSocketId: newSocketId });
        await GamesHelper.updateSessionSocket(pin, sessionToken, oldSocketId, newSocketId);

        // If host was also a player (shouldn't be, but defensive)
        if (playerInfo) {
            await GamesHelper.migratePlayerSocket(pin, oldSocketId, newSocketId, state.totalQuestions, state.quizId);
            await GamesHelper.markPlayerReconnected(pin, newSocketId);
        }

        // Re-subscribe to host channel
        ws.subscribe(`game:${pin}:host`);

        (ws.data as any).pin = pin;
        (ws.data as any).socketId = newSocketId;

        console.log(`Host reconnected: session=${sessionToken} old=${oldSocketId} new=${newSocketId} pin=${pin}`);
        logEvent({ event: 'game.host.reconnected', level: 'INFO', source: 'code', data: { pin, sessionToken, oldSocketId, newSocketId } });

        ws.send(JSON.stringify({
            type: 'RECONNECT_SUCCESS',
            data: {
                nickname: 'HOST',
                gameStatus: state.status,
                currentQuestionIndex: state.currentQuestionIndex,
                score: 0,
                streak: 0,
                hasAnswered: false,
                totalQuestions: state.totalQuestions,
                isHost: true,
                mode: state.mode,
            },
        }));
        return;
    }

    // PLAYER RECONNECT
    if (!playerInfo) {
        ws.send(JSON.stringify({ type: 'ERROR', data: { message: 'Player session not found' } }));
        return;
    }

    // 5. Migrate player data from old socket to new socket
    if (oldSocketId !== newSocketId) {
        await GamesHelper.migratePlayerSocket(pin, oldSocketId, newSocketId, state.totalQuestions, state.quizId);
        await GamesHelper.updateSessionSocket(pin, sessionToken, oldSocketId, newSocketId);
    }

    // 6. Mark player as reconnected
    await GamesHelper.markPlayerReconnected(pin, newSocketId);

    // 7. Re-subscribe to channels
    ws.subscribe(`game:${pin}`);
    ws.subscribe(`game:${pin}:player:${newSocketId}`);

    (ws.data as any).pin = pin;
    (ws.data as any).socketId = newSocketId;

    // 8. Calculate remaining time if a question is active
    let remainingTime: number | undefined;
    if (state.status === 'ACTIVE') {
        const questionStartTime = await GamesHelper.getQuestionStartTime(pin);
        if (questionStartTime) {
            const quiz = await db.query.quizzes.findFirst({
                where: eq(schema.quizzes.id, state.quizId),
                with: {
                    questions: {
                        orderBy: (questions, { asc }) => [asc(questions.orderIndex)],
                    },
                },
            });
            if (quiz && quiz.questions[state.currentQuestionIndex]) {
                const timeLimit = quiz.questions[state.currentQuestionIndex].timeLimit;
                const elapsed = (Date.now() - questionStartTime) / 1000;
                remainingTime = Math.max(0, timeLimit - elapsed);
            }
        }
    }

    console.log(`Player reconnected: ${playerInfo.nickname} session=${sessionToken} old=${oldSocketId} new=${newSocketId} pin=${pin}`);
    logEvent({ event: 'game.player.reconnected', level: 'INFO', source: 'code', data: { pin, nickname: playerInfo.nickname, sessionToken, oldSocketId, newSocketId } });

    // 9. Send RECONNECT_SUCCESS with current game state
    ws.send(JSON.stringify({
        type: 'RECONNECT_SUCCESS',
        data: {
            nickname: playerInfo.nickname,
            gameStatus: state.status,
            currentQuestionIndex: state.currentQuestionIndex,
            score: playerInfo.score,
            streak: playerInfo.streak,
            hasAnswered: playerInfo.hasAnswered,
            totalQuestions: state.totalQuestions,
            isHost: false,
            mode: state.mode,
            remainingTime,
        },
    }));

    // 10. Notify host of player reconnection
    try {
        const { publish } = await import('../../core/pubsub/broadcaster');
        await publish(`game:${pin}:host`, JSON.stringify({
            type: 'PLAYER_RECONNECTED',
            data: { nickname: playerInfo.nickname },
        }));
    } catch (err) {
        console.error('Failed to publish PLAYER_RECONNECTED', err);
    }
}

/**
 * Starts a grace period timer for a disconnected player.
 * If the player doesn't reconnect within GRACE_PERIOD_MS, they are fully removed.
 */
export function startDisconnectGracePeriod(pin: string, socketId: string, sessionToken: string) {
    const timerKey = `${pin}:${sessionToken}`;

    // Clear any existing timer for this session
    const existing = disconnectTimers.get(timerKey);
    if (existing) clearTimeout(existing);

    const timer = setTimeout(async () => {
        disconnectTimers.delete(timerKey);
        try {
            // Check if player is still disconnected (they may have reconnected with same old socketId somehow)
            const playerInfo = await GamesHelper.getPlayerInfo(pin, socketId);
            if (playerInfo && playerInfo.disconnected) {
                console.log(`Grace period expired for ${playerInfo.nickname} in game ${pin}, removing player`);
                logEvent({ event: 'game.player.grace_expired', level: 'INFO', source: 'code', data: { pin, nickname: playerInfo.nickname, sessionToken } });

                await GamesHelper.removePlayer(pin, socketId);
                await GamesHelper.removeSession(pin, sessionToken, socketId);

                // Broadcast updated player count if LOBBY
                const state = await GamesHelper.getGameState(pin);
                if (state && state.status === 'LOBBY') {
                    const { publish } = await import('../../core/pubsub/broadcaster');
                    const recentPlayers = await GamesHelper.getRecentPlayers(pin, 28);
                    await publish(`game:${pin}:host`, JSON.stringify({
                        type: 'LOBBY_UPDATE',
                        data: { count: state.totalPlayers - 1, recentPlayers },
                    }));
                }
            }
        } catch (err) {
            console.error('Grace period cleanup error:', err);
        }
    }, GRACE_PERIOD_MS);

    disconnectTimers.set(timerKey, timer);
}


/**
 * Handle KICK_PLAYER event
 */
export async function handleKickPlayer(ws: any, data: KickPlayerEvent['data']) {
    const { nickname, ban } = data;
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

    // 2. Find socketId by nickname
    const socketId = await GamesHelper.findSocketByNickname(pin, nickname);
    if (!socketId) {
        ws.send(JSON.stringify({
            type: 'ERROR',
            data: { message: 'Player not found' },
        }));
        return;
    }

    // 3. Get player info to ban IP
    const playerInfo = await GamesHelper.getPlayerInfo(pin, socketId);
    if (!playerInfo) return;

    if (ban) {
        // 4. Ban IP
        await GamesHelper.addToBanList(pin, playerInfo.ip);
    }

    // 5. Send FORCE_DISCONNECT to the kicked player before removing
    try {
        const { publish } = await import('../../core/pubsub/broadcaster');
        await publish(`game:${pin}:player:${socketId}`, JSON.stringify({
            type: 'FORCE_DISCONNECT',
            data: { reason: ban ? 'You have been banned from this game' : 'You have been kicked from this game' },
        }));
    } catch (err) {
        console.error('Failed to publish FORCE_DISCONNECT', err);
    }

    // 6. Remove player
    await GamesHelper.removePlayer(pin, socketId);

    // 7. Notify host
    try {
        const { publish } = await import('../../core/pubsub/broadcaster');
        await publish(`game:${pin}:host`, JSON.stringify({
            type: 'PLAYER_KICKED',
            data: { nickname: playerInfo.nickname },
        }));

        // 8. Send LOBBY_UPDATE so host's player list no longer shows the kicked player
        const updatedState = await GamesHelper.getGameState(pin);
        const recentPlayers = await GamesHelper.getRecentPlayers(pin, 28);
        await publish(`game:${pin}:host`, JSON.stringify({
            type: 'LOBBY_UPDATE',
            data: {
                count: updatedState ? updatedState.totalPlayers : 0,
                recentPlayers,
            },
        }));
    } catch (err) {
        console.error('Failed to publish PLAYER_KICKED', err);
    }
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
        logEvent({ event: 'game.start.denied', level: 'WARNING', source: 'code', data: { pin, socketId: ws.id } });
        return;
    }

    // 2. Notify players that game is starting (countdown)
    const countDown = 3; // seconds
    try {
        // To all players
        const { publish } = await import('../../core/pubsub/broadcaster');
        await publish(`game:${pin}`, JSON.stringify({
            type: 'GAME_STARTING',
            data: { countDown, serverTime: Date.now() },
        }));

        // To host channel as well
        await publish(`game:${pin}:host`, JSON.stringify({
            type: 'GAME_STARTING',
            data: { countDown, serverTime: Date.now() },
        }));
    } catch (err) {
        console.error('Failed to broadcast GAME_STARTING', err);
    }

    // 3. Wait countdown and then start
    await new Promise(resolve => setTimeout(resolve, countDown * 1000));

    // 4. Update game status to ACTIVE
    await GamesHelper.updateGameState(pin, { status: 'ACTIVE' });

    // 5. Send first question
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

    // Clear any existing local timer for this pin (prevent duplicate scheduling)
    clearLocalQuestionTimer(pin);

    // 6. Send QUESTION_START (differentiated by mode)
    const filteredQuestion = filterQuestionByMode(questionData, state.mode);

    // 7. Send QUESTION_START (differentiated by mode)
    const filteredPersonalQuestion = filterQuestionByMode(questionData, "PERSONAL"); // send full data to host for PERSONAL mode

    // PDF SPEC: To host (PERSONAL mode)
    const { publish } = await import('../../core/pubsub/broadcaster');

    const answeredCount = await GamesHelper.countAnsweredPlayers(pin);
    const currentState = await GamesHelper.getGameState(pin);
    await publish(`game:${pin}:host`, JSON.stringify({
        type: 'ANSWER_STAT_UPDATE',
        data: {
            answeredCount,
            totalPlayers: currentState ? currentState.totalPlayers : 0,
        },
    }));

    await publish(`game:${pin}:host`, JSON.stringify({
        type: 'QUESTION_START',
        data: { ...filteredPersonalQuestion, mode: 'PERSONAL' },
    }));

    // PDF SPEC: To players (use game mode)
    await publish(`game:${pin}`, JSON.stringify({
        type: 'QUESTION_START',
        data: { ...filteredQuestion, mode: state.mode },
    }));

    // Schedule QUESTION_END when question time expires (add small buffer)
    try {
        const timeoutMs = (question.timeLimit * 1000) + 200;
        const timer = setTimeout(async () => {
            try {
                const currentState = await GamesHelper.getGameState(pin);
                // only trigger if still on the same question index
                if (currentState && currentState.currentQuestionIndex === questionIndex) {

                    await showQuestionEnd(pin, questionIndex, question.id, question.correctIndex);
                }
            } catch (err) {
                console.error('Error in scheduled question end', err);
            }
        }, timeoutMs);

        questionTimers.set(pin, timer);
    } catch (err) {
        console.error('Failed to schedule question end', err);
    }
}

/**
 * PDF SPEC: Handle SUBMIT_ANSWER event
 */
export async function handleSubmitAnswer(ws: any, data: SubmitAnswerEvent['data']) {
    const { answerIndex } = data;
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
    /*
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
    */
    // 10. Check if all players answered — use actual answered count to avoid races
    try {
        const answeredCount = await GamesHelper.countAnsweredPlayers(pin);
        const currentState = await GamesHelper.getGameState(pin);
        ws.publish(`game:${pin}:host`, JSON.stringify({
            type: 'ANSWER_STAT_UPDATE',
            data: {
                answeredCount,
                totalPlayers: currentState ? currentState.totalPlayers : 0,
            },
        }));
        if (currentState && answeredCount >= currentState.totalPlayers) {
            // Automatically show QUESTION_END after all players answered
            setTimeout(() => showQuestionEnd(pin, questionIndex, question.id, question.correctIndex), 1000);
        }
    } catch (err) {
        console.error('Error checking answered players', err);
    }
}

/**
 * PDF SPEC: Helper - Show QUESTION_END with differentiated data
 */
export async function showQuestionEnd(pin: string, questionIndex: number, questionId: string, correctIndex: number) {
    // Atomik lock: ayni soru icin showQuestionEnd sadece bir kez calisir
    const lockAcquired = await GamesHelper.acquireQuestionEndLock(pin, questionIndex);
    if (!lockAcquired) {
        // Baska bir tetikleyici (timer veya all-players-answered) zaten calistirdi
        return;
    }

    const state = await GamesHelper.getGameState(pin);
    if (!state) return;

    // Clear any scheduled timer for this question since we're ending it now
    try {
        clearLocalQuestionTimer(pin);
    } catch (err) {
        // ignore
    }

    // PDF SPEC: Get answer statistics
    const answerStats = await GamesHelper.getAnswerStats(pin, questionId);

    // Get top 5 for this question (streak leaders)
    const streakLeaders = await GamesHelper.getStreakLeaders(pin, 5);

    // PDF SPEC: Differentiated payloads
    // To host: full stats
    const { publish } = await import('../../core/pubsub/broadcaster');
    await publish(`game:${pin}:host`, JSON.stringify({
        type: 'QUESTION_END',
        data: {
            correctIndex, // only correct answer index for host
            answerStats, // { "0": 15, "1": 5, "2": 40, "3": 0 }
            streakLeaders,
        },
    }));

    // To players: send individualized data to each player's personal channel
    try {
        const playerSockets = await GamesHelper.getAllPlayerSockets(pin);
        for (const sid of playerSockets) {
            const pInfo = await GamesHelper.getPlayerInfo(pin, sid);
            if (!pInfo) continue;

            const playerAnswer = await GamesHelper.getPlayerAnswer(pin, questionId, sid);
            const playerIsCorrect = playerAnswer !== null ? (playerAnswer === correctIndex) : false;
            const playerPoints = pInfo.lastPoints || 0;
            const playerNewScore = pInfo.score || 0;

            await publish(`game:${pin}:player:${sid}`, JSON.stringify({
                type: 'QUESTION_END',
                data: {
                    qIndex: questionIndex,
                    streakLeaders,
                    correctIndex,
                    correct: playerIsCorrect,
                    points: playerPoints,
                    newScore: playerNewScore,
                },
            }));
        }
    } catch (err) {
        console.error('Failed to publish individualized QUESTION_END', err);
    }
}

/**
 * PDF SPEC: Handle SHOW_LEADERBOARD event (manual trigger)
 */
export async function handleShowLeaderboard(ws: any, data: ShowLeaderboardEvent['data']) {
    const pin = (ws.data as any)?.pin; // Use stored PIN, not data.gameId (frontend sends quiz ID)

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
    const { publish } = await import('../../core/pubsub/broadcaster');
    await publish(`game:${pin}:host`, JSON.stringify({
        type: 'LEADERBOARD_RESULT',
        data: {
            top5,
            recentPlayers,
        },
    }));

    // To players: send via individual channels (reliable delivery)
    try {
        const playerSockets = await GamesHelper.getAllPlayerSockets(pin);
        for (const sid of playerSockets) {
            await publish(`game:${pin}:player:${sid}`, JSON.stringify({
                type: 'LEADERBOARD_RESULT',
                data: {
                    top5,
                },
            }));
        }
    } catch (err) {
        console.error('Failed to publish individualized LEADERBOARD_RESULT', err);
    }
}

/**
 * Handle NEXT_QUESTION event
 */
export async function handleNextQuestion(ws: any, data: NextQuestionEvent['data']) {
    const pin = (ws.data as any)?.pin; // Use stored PIN, not data.gameId (frontend sends quiz ID)

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

        const { publish } = await import('../../core/pubsub/broadcaster');
        await publish(`game:${pin}`, JSON.stringify({
            type: 'GAME_OVER',
            data: { finalScores },
        }));

        await publish(`game:${pin}:host`, JSON.stringify({
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
