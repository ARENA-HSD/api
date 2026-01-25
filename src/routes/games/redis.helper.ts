// ============================================
// REDIS HELPER FUNCTIONS FOR GAME STATE
// ============================================

import Redis from 'ioredis';
import type {
    GameState,
    PlayerInfo,
    LeaderboardEntry,
    QuestionData,
} from './types';

// Initialize Redis client
const REDIS_URL = process.env.REDIS_URL || 'redis://redis:6379';
export const redis = new Redis(REDIS_URL);

// ============================================
// KEY GENERATORS
// ============================================

const getGameStateKey = (pin: string) => `game:${pin}:state`;
const getPlayersKey = (pin: string) => `game:${pin}:players`;
const getPlayerInfoKey = (pin: string, socketId: string) => `game:${pin}:player:${socketId}`;
const getAnswersKey = (pin: string) => `game:${pin}:answers`;
const getLeaderboardKey = (pin: string) => `game:${pin}:leaderboard`;
const getBannedKey = (pin: string) => `game:${pin}:banned`;

// ============================================
// GAME STATE OPERATIONS
// ============================================

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
        totalAnswers: 0,
        quizId,
        totalPlayers: 0,
        totalQuestions,
    };

    await redis.hset(getGameStateKey(pin), state as any);
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
        status: state.status as any,
        currentQuestionIndex: parseInt(state.currentQuestionIndex),
        mode: state.mode as any,
        hostSocketId: state.hostSocketId,
        totalAnswers: parseInt(state.totalAnswers),
        quizId: state.quizId,
        totalPlayers: parseInt(state.totalPlayers),
        totalQuestions: parseInt(state.totalQuestions),
    };
}

/**
 * Updates game state fields
 */
export async function updateGameState(
    pin: string,
    updates: Partial<GameState>
): Promise<void> {
    await redis.hset(getGameStateKey(pin), updates as any);
}

// ============================================
// PLAYER OPERATIONS
// ============================================

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

    await redis.hset(getPlayerInfoKey(pin, socketId), playerInfo as any);

    // Add to leaderboard with score 0
    await redis.zadd(getLeaderboardKey(pin), 0, nickname);

    // Increment total players
    await redis.hincrby(getGameStateKey(pin), 'totalPlayers', 1);
}

/**
 * Removes a player from the game
 */
export async function removePlayer(pin: string, socketId: string): Promise<void> {
    // Get player info first to remove from leaderboard
    const playerInfo = await getPlayerInfo(pin, socketId);

    if (playerInfo) {
        await redis.zrem(getLeaderboardKey(pin), playerInfo.nickname);
    }

    // Remove from players set
    await redis.srem(getPlayersKey(pin), socketId);

    // Remove player info
    await redis.del(getPlayerInfoKey(pin, socketId));

    // Decrement total players
    await redis.hincrby(getGameStateKey(pin), 'totalPlayers', -1);
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
        score: parseInt(info.score),
        streak: parseInt(info.streak),
        ip: info.ip,
        hasAnswered: info.hasAnswered === 'true',
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

    // Mark as answered
    await redis.hset(playerKey, 'hasAnswered', 'true');

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
        await redis.hset(getPlayerInfoKey(pin, socketId), 'hasAnswered', 'false');
    }

    // Reset total answers
    await redis.hset(getGameStateKey(pin), 'totalAnswers', 0);
}

// ============================================
// LEADERBOARD OPERATIONS
// ============================================

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

    const leaderboard: LeaderboardEntry[] = [];

    for (let i = 0; i < results.length; i += 2) {
        leaderboard.push({
            nickname: results[i],
            score: parseInt(results[i + 1]),
        });
    }

    return leaderboard;
}

// ============================================
// ANSWER KEY OPERATIONS
// ============================================

/**
 * Loads answer key to Redis (correct answers for all questions)
 */
export async function loadAnswerKey(
    pin: string,
    questions: QuestionData[]
): Promise<void> {
    const answerKey: Record<string, number> = {};

    for (const question of questions) {
        answerKey[question.id] = question.correctIndex;
    }

    await redis.hset(getAnswersKey(pin), answerKey as any);
}

/**
 * Checks if answer is correct (zero-latency, from Redis)
 */
export async function checkAnswer(
    pin: string,
    questionId: string,
    answerIndex: number
): Promise<boolean> {
    const correctIndex = await redis.hget(getAnswersKey(pin), questionId);

    if (correctIndex === null) {
        throw new Error('Question not found in answer key');
    }

    return parseInt(correctIndex) === answerIndex;
}

// ============================================
// BAN OPERATIONS
// ============================================

/**
 * Adds IP to ban list
 */
export async function addToBanList(pin: string, ip: string): Promise<void> {
    await redis.sadd(getBannedKey(pin), ip);
}

/**
 * Checks if IP is banned
 */
export async function isBanned(pin: string, ip: string): Promise<boolean> {
    const result = await redis.sismember(getBannedKey(pin), ip);
    return result === 1;
}

// ============================================
// CLEANUP OPERATIONS
// ============================================

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
