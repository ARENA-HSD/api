// ============================================
// UTILITY FUNCTIONS FOR GAMES
// ============================================

import crypto from 'crypto';

/**
 * Generates a unique 6-digit PIN for a game
 * @returns 6-digit numeric string
 */
export function generatePin(): string {
    const pin = Math.floor(100000 + Math.random() * 900000).toString();
    return pin;
}

/**
 * Generates QR code URL for joining a game
 * @param pin - Game PIN
 * @returns QR code URL
 */
export function generateQRUrl(pin: string): string {
    const baseUrl = process.env.FRONTEND_URL || 'http://localhost:3001';
    const joinUrl = `${baseUrl}/join/${pin}`;

    // Using QR code API service
    return `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(joinUrl)}`;
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

/**
 * Generates a unique game ID
 * @returns UUID-like game ID
 */
export function generateGameId(): string {
    return crypto.randomUUID();
}

/**
 * Validates PIN format (6 digits)
 * @param pin - PIN to validate
 * @returns true if valid
 */
export function isValidPin(pin: string): boolean {
    return /^\d{6}$/.test(pin);
}

/**
 * Gets color for option by index
 * @param index - Option index (0-3)
 * @returns Color name
 */
export function getOptionColor(index: number): string {
    const colors = ['teal', 'pink', 'purple', 'orange'];
    return colors[index] || 'gray';
}
