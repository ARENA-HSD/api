
// REDIS HELPER FUNCTIONS FOR GAME STATE


import Redis from 'ioredis';
import type {
    GameState,
    GameMode,
    GameStatus,
    GamePhase,
    PlayerInfo,
    LeaderboardEntry,
    QuestionData,
} from '../../../modules/games/games.types';

// Initialize Redis client
const REDIS_URL = process.env.REDIS_URL;
if (!REDIS_URL) {
    throw new Error('REDIS_URL is required');
}
export const redis = new Redis(REDIS_URL);

const GAME_TTL_SECONDS = 60 * 60 * 24; // 24 hours

const GAME_STATUS_VALUES: ReadonlySet<GameStatus> = new Set(['LOBBY', 'ACTIVE', 'FINISHED']);
const GAME_MODE_VALUES: ReadonlySet<GameMode> = new Set(['PERSONAL', 'STAGE']);
const GAME_PHASE_VALUES: ReadonlySet<GamePhase> = new Set([
    'LOBBY',
    'QUESTION_START',
    'QUESTION_END',
    'LEADERBOARD_RESULT',
    'GAME_OVER',
]);

function parseInteger(value: string | undefined, fallback: number): number {
    const parsed = Number.parseInt(value ?? '', 10);
    return Number.isNaN(parsed) ? fallback : parsed;
}

function toRedisHash(values: Record<string, unknown>): Record<string, string> {
    const result: Record<string, string> = {};

    for (const [key, value] of Object.entries(values)) {
        if (value === undefined || value === null) {
            continue;
        }
        result[key] = String(value);
    }

    return result;
}

function parseGameStatus(status: string | undefined): GameStatus {
    return GAME_STATUS_VALUES.has(status as GameStatus) ? (status as GameStatus) : 'LOBBY';
}

function parseGameMode(mode: string | undefined): GameMode {
    return GAME_MODE_VALUES.has(mode as GameMode) ? (mode as GameMode) : 'PERSONAL';
}

function parseGamePhase(phase: string | undefined): GamePhase {
    return GAME_PHASE_VALUES.has(phase as GamePhase) ? (phase as GamePhase) : 'LOBBY';
}

async function touchGameKeys(pin: string): Promise<void> {
    await redis.expire(getGameStateKey(pin), GAME_TTL_SECONDS);
    await redis.expire(getPlayersKey(pin), GAME_TTL_SECONDS);
    await redis.expire(getRecentPlayersKey(pin), GAME_TTL_SECONDS);
    await redis.expire(getAnswersKey(pin), GAME_TTL_SECONDS);
    await redis.expire(getLeaderboardKey(pin), GAME_TTL_SECONDS);
    await redis.expire(getBannedKey(pin), GAME_TTL_SECONDS);
    await redis.expire(getRankSnapshotKey(pin), GAME_TTL_SECONDS);
    await redis.expire(getQuestionTimerKey(pin), GAME_TTL_SECONDS);
}

async function touchPlayerKey(pin: string, socketId: string): Promise<void> {
    await redis.expire(getPlayerInfoKey(pin, socketId), GAME_TTL_SECONDS);
}

async function touchAnswerKey(pin: string, questionId: string, socketId: string): Promise<void> {
    await redis.expire(getPlayerAnswerKey(pin, questionId, socketId), GAME_TTL_SECONDS);
}


// UTILITY FUNCTIONS


/**
 * Generates a unique 6-digit PIN for a game
 * @returns 6-digit numeric string
 */
export function generatePin(): string {
    const pin = Math.floor(100000 + Math.random() * 900000).toString();
    return pin;
}

/**
 * Calculates score based on answer correctness, time, and streak
 * @param isCorrect - Whether the answer is correct
 * @param basePoints - Base points for the question
 * @param timeLimit - Total time limit in seconds
 * @param timeRemaining - Remaining time in seconds
 * @param currentStreak - Current correct answer streak
 * @returns Calculated score
 */
export function calculateScore(
    isCorrect: boolean,
    basePoints: number,
    timeLimit: number,
    timeRemaining: number,
    currentStreak: number
): number {
    if (!isCorrect) return 0;

    // Base score
    let score = basePoints;

    // Time bonus (faster = more points)
    const timeBonus = Math.floor((timeRemaining / timeLimit) * basePoints * 0.5);
    score += timeBonus;

    // Streak multiplier (3+ correct in a row = 1.5x)
    if (currentStreak >= 3) {
        score = Math.floor(score * 1.5);
    }

    return score;
}

/**
 * Handles nickname duplication by appending #1, #2, etc.
 * @param nickname - Original nickname
 * @param existingNicknames - Array of existing nicknames in the game
 * @returns Unique nickname
 */
export function handleNicknameDuplication(
    nickname: string,
    existingNicknames: string[]
): string {
    let uniqueNickname = nickname;
    let counter = 1;

    while (existingNicknames.includes(uniqueNickname)) {
        uniqueNickname = `${nickname}#${counter}`;
        counter++;
    }

    return uniqueNickname;
}

/**
 * Extracts client IP address from headers
 * @param headers - Request headers
 * @returns IP address
 */
export function getClientIP(headers: Record<string, string | undefined>): string {
    // Check common headers for IP (proxy, load balancer, etc.)
    const ip =
        headers['x-forwarded-for']?.split(',')[0].trim() ||
        headers['x-real-ip'] ||
        headers['cf-connecting-ip'] || // Cloudflare
        'unknown';

    return ip;
}



// KEY GENERATORS


const getGameStateKey = (pin: string) => `game:${pin}:state`;
const getPlayersKey = (pin: string) => `game:${pin}:players`;
const getRecentPlayersKey = (pin: string) => `game:${pin}:recent_players`; // NEW: For LTRIM
const getPlayerInfoKey = (pin: string, socketId: string) => `game:${pin}:player:${socketId}`;
const getPlayerAnswerKey = (pin: string, questionId: string, socketId: string) => `game:${pin}:answer:${questionId}:${socketId}`; // NEW: Track answers
const getAnswersKey = (pin: string) => `game:${pin}:answers`;
const getLeaderboardKey = (pin: string) => `game:${pin}:leaderboard`;
const getBannedKey = (pin: string) => `game:${pin}:banned`;
const getCalculationLockKeyGlobal = (pin: string, questionId: string) => `game:${pin}:calc_lock:${questionId}`; // NEW: Global calculation lock
const getSessionKey = (pin: string, sessionToken: string) => `game:${pin}:session:${sessionToken}`;
const getSocketSessionKey = (pin: string, socketId: string) => `game:${pin}:socket_session:${socketId}`;


// GAME STATE OPERATIONS


/**
 * Creates initial game state in Redis
 */
export async function createGameState(
    pin: string,
    quizId: string,
    mode: 'PERSONAL' | 'STAGE',
    hostSocketId: string,
    totalQuestions: number
): Promise<void> {
    const state: GameState = {
        status: 'LOBBY',
        currentQuestionIndex: 0,
        mode,
        hostSocketId,
        hostSessionToken: '',
        totalAnswers: 0,
        quizId,
        totalPlayers: 0,
        totalQuestions,
        currentPhase: 'LOBBY',
    };

    await redis.hset(getGameStateKey(pin), toRedisHash(state as unknown as Record<string, unknown>));
    await touchGameKeys(pin);
}

/**
 * Gets current game state
 */
export async function getGameState(pin: string): Promise<GameState | null> {
    const state = await redis.hgetall(getGameStateKey(pin));

    if (!state || Object.keys(state).length === 0) {
        return null;
    }

    return {
        status: parseGameStatus(state.status),
        currentQuestionIndex: parseInteger(state.currentQuestionIndex, 0),
        mode: parseGameMode(state.mode),
        hostSocketId: state.hostSocketId,
        hostSessionToken: state.hostSessionToken || '',
        totalAnswers: parseInteger(state.totalAnswers, 0),
        quizId: state.quizId,
        totalPlayers: parseInteger(state.totalPlayers, 0),
        totalQuestions: parseInteger(state.totalQuestions, 0),
        currentPhase: parseGamePhase(state.currentPhase),
    };
}

/**
 * Updates game state fields
 */
export async function updateGameState(
    pin: string,
    updates: Partial<GameState>
): Promise<void> {
    if (Object.keys(updates).length === 0) {
        return;
    }
    await redis.hset(getGameStateKey(pin), toRedisHash(updates as Record<string, unknown>));
    await touchGameKeys(pin);
}


// PLAYER OPERATIONS


/**
 * Adds a player to the game
 */
export async function addPlayer(
    pin: string,
    socketId: string,
    nickname: string,
    ip: string
): Promise<void> {
    // Add to players set
    await redis.sadd(getPlayersKey(pin), socketId);

    // Create player info
    const playerInfo: PlayerInfo = {
        nickname,
        score: 0,
        streak: 0,
        ip,
        hasAnswered: false,
    };

    await redis.hset(getPlayerInfoKey(pin, socketId), toRedisHash(playerInfo as unknown as Record<string, unknown>));

    // Add to leaderboard with score 0
    await redis.zadd(getLeaderboardKey(pin), 0, nickname);
    console.log(`[DEBUG] addPlayer: zadd ${getLeaderboardKey(pin)} score=0 nick=${nickname}`);

    // Increment total players
    await redis.hincrby(getGameStateKey(pin), 'totalPlayers', 1);
    await touchPlayerKey(pin, socketId);
    await touchGameKeys(pin);
}

/**
 * Removes a player from the game
 */
export async function removePlayer(pin: string, socketId: string): Promise<void> {
    // Get player info first to remove from leaderboard
    const playerInfo = await getPlayerInfo(pin, socketId);

    if (playerInfo) {
        await redis.zrem(getLeaderboardKey(pin), playerInfo.nickname);
        console.log(`[DEBUG] removePlayer: zrem ${getLeaderboardKey(pin)} nick=${playerInfo.nickname}`);
        // Remove from recent players list so LOBBY_UPDATE no longer includes them
        await redis.lrem(getRecentPlayersKey(pin), 0, playerInfo.nickname);
    }

    // Remove from players set
    await redis.srem(getPlayersKey(pin), socketId);

    // Remove player info
    await redis.del(getPlayerInfoKey(pin, socketId));

    // Decrement total players
    await redis.hincrby(getGameStateKey(pin), 'totalPlayers', -1);
}

/**
 * Handles player disconnect cleanup
 * - Removes player from Redis
 * - Returns game state and broadcast decision
 */
export async function handlePlayerDisconnect(
    pin: string,
    socketId: string
): Promise<{ success: boolean; shouldBroadcast: boolean; state: any | null; playerInfo: any | null }> {
    try {
        // 1. Get game state
        const state = await getGameState(pin);
        if (!state) {
            return { success: false, shouldBroadcast: false, state: null, playerInfo: null };
        }

        // 2. Get player info before removing
        const playerInfo = await getPlayerInfo(pin, socketId);
        if (!playerInfo) {
            return { success: false, shouldBroadcast: false, state, playerInfo: null };
        }

        // 3. Remove player from Redis
        await removePlayer(pin, socketId);

        // 4. Log disconnect
        console.log(`Player disconnected: ${playerInfo.nickname} (${socketId}) from game ${pin}`);

        // 5. Determine if should broadcast
        // Only broadcast in LOBBY or ACTIVE status
        const shouldBroadcast = ['LOBBY', 'ACTIVE'].includes(state.status);

        return { success: true, shouldBroadcast, state, playerInfo };
    } catch (error) {
        console.error('Disconnect cleanup error:', error);
        return { success: false, shouldBroadcast: false, state: null, playerInfo: null };
    }
}

/**
 * Gets player info
 */
export async function getPlayerInfo(
    pin: string,
    socketId: string
): Promise<PlayerInfo | null> {
    const info = await redis.hgetall(getPlayerInfoKey(pin, socketId));

    if (!info || Object.keys(info).length === 0) {
        return null;
    }

    return {
        nickname: info.nickname,
        score: parseInteger(info.score, 0),
        streak: parseInteger(info.streak, 0),
        ip: info.ip,
        hasAnswered: info.hasAnswered === 'true',
        lastPoints: info.lastPoints ? parseInteger(info.lastPoints, 0) : 0,
        sessionToken: info.sessionToken || undefined,
        disconnected: info.disconnected === 'true',
        disconnectedAt: info.disconnectedAt ? parseInteger(info.disconnectedAt, 0) : undefined,
    };
}

/**
 * Updates player score and adds to leaderboard
 */
export async function updatePlayerScore(
    pin: string,
    socketId: string,
    scoreToAdd: number,
    isCorrect: boolean
): Promise<{ newScore: number; newStreak: number }> {
    const playerKey = getPlayerInfoKey(pin, socketId);
    const playerInfo = await getPlayerInfo(pin, socketId);

    if (!playerInfo) {
        throw new Error('Player not found');
    }

    // Update score
    const newScore = playerInfo.score + scoreToAdd;
    await redis.hset(playerKey, 'score', newScore);

    // Update streak
    let newStreak = playerInfo.streak;
    if (isCorrect) {
        newStreak += 1;
    } else {
        newStreak = 0;
    }
    await redis.hset(playerKey, 'streak', newStreak);

    // Update leaderboard
    await redis.zadd(getLeaderboardKey(pin), newScore, playerInfo.nickname);
    console.log(`[DEBUG] updatePlayerScore: zadd ${getLeaderboardKey(pin)} score=${newScore} nick=${playerInfo.nickname}`);

    // Mark as answered
    await redis.hset(playerKey, 'hasAnswered', 'true', 'lastPoints', scoreToAdd.toString());
    await touchPlayerKey(pin, socketId);
    await touchGameKeys(pin);

    return { newScore, newStreak };
}

/**
 * Gets all nicknames in the game
 */
export async function getAllNicknames(pin: string): Promise<string[]> {
    const socketIds = await redis.smembers(getPlayersKey(pin));
    const nicknames: string[] = [];

    for (const socketId of socketIds) {
        const playerInfo = await getPlayerInfo(pin, socketId);
        if (playerInfo) {
            nicknames.push(playerInfo.nickname);
        }
    }

    return nicknames;
}

/**
 * Resets all players' hasAnswered flag for next question
 */
export async function resetAllAnswerFlags(pin: string): Promise<void> {
    const socketIds = await redis.smembers(getPlayersKey(pin));

    for (const socketId of socketIds) {
        await redis.hset(getPlayerInfoKey(pin, socketId), 'hasAnswered', 'false', 'lastPoints', '0');
    }

    // Reset total answers
    await redis.hset(getGameStateKey(pin), 'totalAnswers', 0);
    await touchGameKeys(pin);
}


// LEADERBOARD OPERATIONS


/**
 * Gets top N players from leaderboard
 */
export async function getLeaderboard(
    pin: string,
    limit: number = 5
): Promise<LeaderboardEntry[]> {
    // ZREVRANGE returns highest scores first
    const results = await redis.zrevrange(
        getLeaderboardKey(pin),
        0,
        limit - 1,
        'WITHSCORES'
    );
    //console.log(`[DEBUG] getLeaderboard: key=${getLeaderboardKey(pin)} results=`, JSON.stringify(results));

    const leaderboard: LeaderboardEntry[] = [];

    for (let i = 0; i < results.length; i += 2) {
        leaderboard.push({
            nickname: results[i],
            score: parseInt(results[i + 1]),
        });
    }

    return leaderboard;
}


// ANSWER KEY OPERATIONS


/**
 * Loads answer key to Redis (correct answers for all questions)
 * Stores as JSON strings to support arrays (MULTI_SELECT, ORDERING, RANGE)
 */
export async function loadAnswerKey(
    pin: string,
    questions: QuestionData[]
): Promise<void> {
    if (questions.length === 0) {
        return;
    }

    const answerKey: Record<string, string> = {};

    for (const question of questions) {
        answerKey[question.id] = JSON.stringify(question.correctAnswer);
    }

    await redis.hset(getAnswersKey(pin), answerKey);
    await touchGameKeys(pin);
}

/**
 * Gets the correct answer array from Redis
 */
export async function getCorrectAnswer(
    pin: string,
    questionId: string
): Promise<number[]> {
    const raw = await redis.hget(getAnswersKey(pin), questionId);
    if (raw === null) {
        throw new Error('Question not found in answer key');
    }
    return JSON.parse(raw);
}

/**
 * Checks if a single answer is correct (MULTIPLE_CHOICE, TRUE_FALSE)
 */
export async function checkAnswer(
    pin: string,
    questionId: string,
    answerIndex: number
): Promise<boolean> {
    const correctAnswer = await getCorrectAnswer(pin, questionId);
    return correctAnswer.length === 1 && correctAnswer[0] === answerIndex;
}

/**
 * Checks if multiple answers are all correct (MULTI_SELECT — ya hep ya hiç)
 */
export async function checkMultiAnswer(
    pin: string,
    questionId: string,
    answerIndices: number[]
): Promise<boolean> {
    const correctAnswer = await getCorrectAnswer(pin, questionId);
    if (answerIndices.length !== correctAnswer.length) return false;
    const sorted1 = [...answerIndices].sort((a, b) => a - b);
    const sorted2 = [...correctAnswer].sort((a, b) => a - b);
    return sorted1.every((v, i) => v === sorted2[i]);
}

/**
 * Checks if ordering is correct (ORDERING — exact order match)
 */
export async function checkOrderingAnswer(
    pin: string,
    questionId: string,
    orderedIndices: number[]
): Promise<boolean> {
    const correctAnswer = await getCorrectAnswer(pin, questionId);
    if (orderedIndices.length !== correctAnswer.length) return false;
    return orderedIndices.every((v, i) => v === correctAnswer[i]);
}

/**
 * Checks if a range value falls within the correct range (RANGE)
 * correctAnswer = [minVal, maxVal]
 */
export async function checkRangeAnswer(
    pin: string,
    questionId: string,
    rangeValue: number
): Promise<boolean> {
    const correctAnswer = await getCorrectAnswer(pin, questionId);
    if (correctAnswer.length !== 2) return false;
    return rangeValue >= correctAnswer[0] && rangeValue <= correctAnswer[1];
}


// BAN OPERATIONS


/**
 * Adds IP to ban list
 */
export async function addToBanList(pin: string, ip: string): Promise<void> {
    await redis.sadd(getBannedKey(pin), ip);
    await touchGameKeys(pin);
}

/**
 * Checks if IP is banned
 */
export async function isBanned(pin: string, ip: string): Promise<boolean> {
    const result = await redis.sismember(getBannedKey(pin), ip);
    return result === 1;
}


// CLEANUP OPERATIONS


/**
 * Deletes all game-related keys from Redis
 */
export async function cleanupGame(pin: string): Promise<void> {
    // Get all player socket IDs first
    const socketIds = await redis.smembers(getPlayersKey(pin));

    // Delete all player info keys
    for (const socketId of socketIds) {
        await redis.del(getPlayerInfoKey(pin, socketId));
    }

    // Delete main keys
    await redis.del(
        getGameStateKey(pin),
        getPlayersKey(pin),
        getAnswersKey(pin),
        getLeaderboardKey(pin),
        getBannedKey(pin)
    );
}

/**
 * Gets all socket IDs of players in the game
 */
export async function getAllPlayerSockets(pin: string): Promise<string[]> {
    return await redis.smembers(getPlayersKey(pin));
}

/**
 * Finds a player's socketId by their nickname
 */
export async function findSocketByNickname(pin: string, nickname: string): Promise<string | null> {
    const socketIds = await getAllPlayerSockets(pin);
    for (const sid of socketIds) {
        const info = await getPlayerInfo(pin, sid);
        if (info && info.nickname === nickname) return sid;
    }
    return null;
}

/**
 * Counts how many players have `hasAnswered` === true for current question
 */
export async function countAnsweredPlayers(pin: string): Promise<number> {
    const socketIds = await redis.smembers(getPlayersKey(pin));
    let count = 0;
    for (const sid of socketIds) {
        const info = await getPlayerInfo(pin, sid);
        if (info && info.hasAnswered) count++;
    }
    return count;
}

/**
 * Counts active (non-disconnected) players
 */
export async function countActivePlayers(pin: string): Promise<number> {
    const socketIds = await redis.smembers(getPlayersKey(pin));
    let count = 0;
    for (const sid of socketIds) {
        const info = await getPlayerInfo(pin, sid);
        if (info && !info.disconnected) count++;
    }
    return count;
}


// CALCULATION LOCK OPERATIONS


const getCalculationLockKey = (pin: string, questionId: string, socketId: string) =>
    `game:${pin}:lock:${questionId}:${socketId}`;

/**
 * Tries to acquire calculation lock for answer submission
 * Returns true if lock was acquired, false if already locked
 */
export async function acquireCalculationLock(
    pin: string,
    questionId: string,
    socketId: string
): Promise<boolean> {
    const lockKey = getCalculationLockKey(pin, questionId, socketId);
    // SET with NX (only if not exists) and EX (expiration in seconds)
    const result = await redis.set(lockKey, '1', 'EX', 60, 'NX');
    return result === 'OK';
}

/**
 * Atomik lock: showQuestionEnd ayni soru icin sadece bir kez calisir
 * Timer ve all-players-answered ayni anda tetiklerse ikincisi engellenir
 */
export async function acquireQuestionEndLock(
    pin: string,
    questionIndex: number
): Promise<boolean> {
    const lockKey = `game:${pin}:question_end_lock:${questionIndex}`;
    const result = await redis.set(lockKey, '1', 'EX', 120, 'NX');
    return result === 'OK';
}

/**
 * Releases calculation lock (optional, as they auto-expire)
 */
export async function releaseCalculationLock(
    pin: string,
    questionId: string,
    socketId: string
): Promise<void> {
    const lockKey = getCalculationLockKey(pin, questionId, socketId);
    await redis.del(lockKey);
}


// RANK TRACKING OPERATIONS


const getRankSnapshotKey = (pin: string) => `game:${pin}:rank_snapshot`;

/**
 * Saves current leaderboard ranks before question results
 */
export async function saveRankSnapshot(pin: string): Promise<void> {
    const leaderboard = await redis.zrevrange(
        getLeaderboardKey(pin),
        0,
        -1,
        'WITHSCORES'
    );

    if (leaderboard.length === 0) {
        return;
    }

    const snapshot: Record<string, number> = {};
    let rank = 1;

    for (let i = 0; i < leaderboard.length; i += 2) {
        const nickname = leaderboard[i];
        snapshot[nickname] = rank++;
    }

    await redis.hset(getRankSnapshotKey(pin), toRedisHash(snapshot));
    await touchGameKeys(pin);
}

/**
 * Gets previous rank for a player
 */
export async function getPreviousRank(pin: string, nickname: string): Promise<number> {
    const rank = await redis.hget(getRankSnapshotKey(pin), nickname);
    return rank ? parseInt(rank) : 0;
}

/**
 * Gets current rank for a player
 */
export async function getCurrentRank(pin: string, nickname: string): Promise<number> {
    const rank = await redis.zrevrank(getLeaderboardKey(pin), nickname);
    return rank !== null ? rank + 1 : 0; // ZREVRANK is 0-indexed
}

/**
 * Clears rank snapshot (call before taking new snapshot)
 */
export async function clearRankSnapshot(pin: string): Promise<void> {
    await redis.del(getRankSnapshotKey(pin));
}


// TIME SYNCHRONIZATION


const getQuestionTimerKey = (pin: string) => `game:${pin}:question_timer`;

/**
 * Stores when the current question started
 */
export async function setQuestionStartTime(pin: string, timestamp: number): Promise<void> {
    await redis.set(getQuestionTimerKey(pin), timestamp.toString());
    await touchGameKeys(pin);
}

/**
 * Gets when the current question started
 */
export async function getQuestionStartTime(pin: string): Promise<number | null> {
    const time = await redis.get(getQuestionTimerKey(pin));
    return time ? parseInt(time) : null;
}

/**
 * Clears question timer
 */
export async function clearQuestionTimer(pin: string): Promise<void> {
    await redis.del(getQuestionTimerKey(pin));
}


//  RECENT PLAYERS (LTRIM FOR LAST 28)


/**
 * Gets recent N players (default 28) using LRANGE
 */
export async function getRecentPlayers(pin: string, limit: number = 28): Promise<string[]> {
    return await redis.lrange(getRecentPlayersKey(pin), 0, limit - 1);
}

/**
 * Adds player to recent list (LPUSH + LTRIM to keep only last 28)
 */
export async function addRecentPlayer(pin: string, nickname: string): Promise<void> {
    const key = getRecentPlayersKey(pin);
    await redis.lpush(key, nickname);
    await redis.ltrim(key, 0, 27); // Keep only last 28
    await touchGameKeys(pin);
}


// PLAYER ANSWER TRACKING


/**
 * Stores a player's answer (supports single index, array, or range value)
 */
export async function storePlayerAnswer(
    pin: string,
    questionId: string,
    socketId: string,
    answer: number | number[]
): Promise<void> {
    const value = Array.isArray(answer) ? JSON.stringify(answer) : answer.toString();
    await redis.set(getPlayerAnswerKey(pin, questionId, socketId), value);
    await touchAnswerKey(pin, questionId, socketId);
    await touchGameKeys(pin);
}

/**
 * Gets a player's answer (returns number for single, array for multi/ordering, or null)
 */
export async function getPlayerAnswer(
    pin: string,
    questionId: string,
    socketId: string
): Promise<number | number[] | null> {
    const answer = await redis.get(getPlayerAnswerKey(pin, questionId, socketId));
    if (answer === null) return null;
    try {
        const parsed = JSON.parse(answer);
        return parsed;
    } catch {
        return parseInt(answer);
    }
}

/**
 * PDF SPEC: Get statistics for question (how many chose each option)
 * Returns: { "0": 15, "1": 5, "2": 40, "3": 0 }
 * For MULTI_SELECT: each selected index is counted separately
 */
export async function getAnswerStats(pin: string, questionId: string): Promise<Record<string, number>> {
    const socketIds = await redis.smembers(getPlayersKey(pin));
    const stats: Record<string, number> = {};

    for (const socketId of socketIds) {
        const answer = await getPlayerAnswer(pin, questionId, socketId);
        if (answer !== null) {
            if (Array.isArray(answer)) {
                // MULTI_SELECT or ORDERING: count each selected index
                for (const idx of answer) {
                    const key = idx.toString();
                    stats[key] = (stats[key] || 0) + 1;
                }
            } else {
                const key = answer.toString();
                stats[key] = (stats[key] || 0) + 1;
            }
        }
    }

    return stats;
}


// PDF SPEC: STREAK LEADERS


/**
 * Gets players with highest streaks
 */
export async function getStreakLeaders(pin: string, limit: number = 5): Promise<Array<{ nickname: string; streak: number }>> {
    const socketIds = await redis.smembers(getPlayersKey(pin));
    const streaks: Array<{ nickname: string; streak: number }> = [];

    for (const socketId of socketIds) {
        const playerInfo = await getPlayerInfo(pin, socketId);
        if (playerInfo && playerInfo.streak > 0) {
            streaks.push({
                nickname: playerInfo.nickname,
                streak: playerInfo.streak,
            });
        }
    }

    // Sort by streak descending
    streaks.sort((a, b) => b.streak - a.streak);

    return streaks.slice(0, limit);
}


// PDF SPEC: GLOBAL CALCULATION LOCK


/**
 * Acquires global calculation lock for a question
 * Used to prevent SHOW_LEADERBOARD from being called before calculations finish
 */
export async function acquireGlobalCalculationLock(pin: string, questionId: string): Promise<boolean> {
    const lockKey = getCalculationLockKeyGlobal(pin, questionId);
    const result = await redis.set(lockKey, '1', 'EX', 60, 'NX');
    return result === 'OK';
}

/**
 * Releases global calculation lock
 */
export async function releaseGlobalCalculationLock(pin: string, questionId: string): Promise<void> {
    await redis.del(getCalculationLockKeyGlobal(pin, questionId));
}

/**
 * Waits for global calculation lock to be released (with timeout)
 */
export async function waitForCalculationLock(pin: string, questionId: string, timeoutMs: number = 5000): Promise<void> {
    const lockKey = getCalculationLockKeyGlobal(pin, questionId);
    const startTime = Date.now();

    while (true) {
        const exists = await redis.exists(lockKey);
        if (!exists) {
            return; // Lock released
        }

        if (Date.now() - startTime > timeoutMs) {
            throw new Error('Calculation lock timeout');
        }

        // Wait 100ms before checking again
        await new Promise(resolve => setTimeout(resolve, 100));
    }
}


// SESSION TOKEN OPERATIONS (RECONNECT SYSTEM)


const SESSION_TTL = 3000; // 50 minutes

/**
 * Creates a session mapping: sessionToken <-> socketId
 */
export async function createSession(pin: string, socketId: string, sessionToken: string): Promise<void> {
    await redis.set(getSessionKey(pin, sessionToken), socketId, 'EX', SESSION_TTL);
    await redis.set(getSocketSessionKey(pin, socketId), sessionToken, 'EX', SESSION_TTL);
}

/**
 * Gets the socketId associated with a sessionToken
 */
export async function getSocketBySession(pin: string, sessionToken: string): Promise<string | null> {
    return await redis.get(getSessionKey(pin, sessionToken));
}

/**
 * Gets the sessionToken associated with a socketId
 */
export async function getSessionBySocket(pin: string, socketId: string): Promise<string | null> {
    return await redis.get(getSocketSessionKey(pin, socketId));
}

/**
 * Updates session mapping to point to a new socketId (on reconnect)
 */
export async function updateSessionSocket(pin: string, sessionToken: string, oldSocketId: string, newSocketId: string): Promise<void> {
    // Update session -> socketId
    await redis.set(getSessionKey(pin, sessionToken), newSocketId, 'EX', SESSION_TTL);
    // Remove old reverse mapping
    await redis.del(getSocketSessionKey(pin, oldSocketId));
    // Create new reverse mapping
    await redis.set(getSocketSessionKey(pin, newSocketId), sessionToken, 'EX', SESSION_TTL);
}

/**
 * Refreshes session TTL (call on reconnect)
 */
export async function refreshSessionTTL(pin: string, sessionToken: string, socketId: string): Promise<void> {
    await redis.expire(getSessionKey(pin, sessionToken), SESSION_TTL);
    await redis.expire(getSocketSessionKey(pin, socketId), SESSION_TTL);
}

/**
 * Removes session mapping (on full cleanup)
 */
export async function removeSession(pin: string, sessionToken: string, socketId: string): Promise<void> {
    await redis.del(getSessionKey(pin, sessionToken));
    await redis.del(getSocketSessionKey(pin, socketId));
}


// PLAYER DATA MIGRATION (RECONNECT SYSTEM)


/**
 * Migrates player data from old socketId to new socketId.
 * - Renames player info hash key
 * - Updates players set (SREM old, SADD new)
 * - Migrates answer tracking keys for all answered questions
 */
export async function migratePlayerSocket(
    pin: string,
    oldSocketId: string,
    newSocketId: string,
    totalQuestions: number,
    quizId: string
): Promise<void> {
    const oldKey = getPlayerInfoKey(pin, oldSocketId);
    const newKey = getPlayerInfoKey(pin, newSocketId);

    // 1. Copy player info from old key to new key (RENAME would fail if old doesn't exist)
    const playerData = await redis.hgetall(oldKey);
    if (playerData && Object.keys(playerData).length > 0) {
        await redis.hset(newKey, playerData);
        await redis.del(oldKey);
    }

    // 2. Update players set
    await redis.srem(getPlayersKey(pin), oldSocketId);
    await redis.sadd(getPlayersKey(pin), newSocketId);

    // 3. Migrate answer tracking keys
    // We need to check all possible question IDs — scan for pattern
    const pattern = `game:${pin}:answer:*:${oldSocketId}`;
    let cursor = '0';
    do {
        const [nextCursor, keys] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
        cursor = nextCursor;
        for (const key of keys) {
            const value = await redis.get(key);
            // Extract questionId from key: game:PIN:answer:QUESTION_ID:SOCKET_ID
            const parts = key.split(':');
            const questionId = parts[3];
            if (value !== null) {
                await redis.set(getPlayerAnswerKey(pin, questionId, newSocketId), value);
                await redis.del(key);
            }
        }
    } while (cursor !== '0');

    // 4. Migrate calculation lock keys
    const lockPattern = `game:${pin}:lock:*:${oldSocketId}`;
    cursor = '0';
    do {
        const [nextCursor, keys] = await redis.scan(cursor, 'MATCH', lockPattern, 'COUNT', 100);
        cursor = nextCursor;
        for (const key of keys) {
            const ttl = await redis.ttl(key);
            if (ttl > 0) {
                const parts = key.split(':');
                const questionId = parts[3];
                const newLockKey = `game:${pin}:lock:${questionId}:${newSocketId}`;
                await redis.set(newLockKey, '1', 'EX', ttl);
            }
            await redis.del(key);
        }
    } while (cursor !== '0');
}


// DISCONNECT GRACE PERIOD (RECONNECT SYSTEM)


/**
 * Marks a player as disconnected (instead of removing them immediately)
 */
export async function markPlayerDisconnected(pin: string, socketId: string): Promise<void> {
    const playerKey = getPlayerInfoKey(pin, socketId);
    await redis.hset(playerKey, 'disconnected', 'true', 'disconnectedAt', Date.now().toString());
}

/**
 * Marks a player as reconnected (clears disconnected flag)
 */
export async function markPlayerReconnected(pin: string, socketId: string): Promise<void> {
    const playerKey = getPlayerInfoKey(pin, socketId);
    await redis.hset(playerKey, 'disconnected', 'false');
    await redis.hdel(playerKey, 'disconnectedAt');
}


// QUESTION TYPE TRACKING


const getQuestionTypesKey = (pin: string) => `game:${pin}:question_types`;

/**
 * Loads question types into Redis for quick lookup during answer evaluation
 */
export async function loadQuestionTypes(
    pin: string,
    questions: QuestionData[]
): Promise<void> {
    if (questions.length === 0) return;
    const types: Record<string, string> = {};
    for (const q of questions) {
        types[q.id] = q.questionType;
    }
    await redis.hset(getQuestionTypesKey(pin), types);
    await redis.expire(getQuestionTypesKey(pin), GAME_TTL_SECONDS);
}

/**
 * Gets the question type for a specific question
 */
export async function getQuestionType(
    pin: string,
    questionId: string
): Promise<string> {
    const type = await redis.hget(getQuestionTypesKey(pin), questionId);
    return type || 'MULTIPLE_CHOICE';
}
