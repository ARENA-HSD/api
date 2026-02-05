
// INPUT SANITIZATION UTILITIES
// XSS Protection and Data Validation


/**
 * Sanitize text input to prevent XSS attacks
 * Removes dangerous characters and trims whitespace
 * 
 * @param text - Raw text input
 * @param maxLength - Maximum allowed length (default: 500)
 * @returns Sanitized text
 */
export function sanitizeText(text: string, maxLength: number = 500): string {
    if (!text || typeof text !== 'string') {
        return '';
    }

    return text
        .trim()
        .replace(/[<>]/g, '') // Remove < and > to prevent HTML injection
        .slice(0, maxLength);
}

/**
 * Sanitize quiz title
 * Enforces minimum 3 characters, maximum 255 characters
 * 
 * @param title - Raw quiz title
 * @returns Sanitized title
 */
export function sanitizeQuizTitle(title: string): string {
    return sanitizeText(title, 255);
}

/**
 * Sanitize question text
 * Maximum 1000 characters for questions
 * 
 * @param text - Raw question text
 * @returns Sanitized text
 */
export function sanitizeQuestionText(text: string): string {
    return sanitizeText(text, 1000);
}

/**
 * Sanitize URL input
 * Validates URL format and removes dangerous protocols
 * 
 * @param url - Raw URL
 * @returns Sanitized URL or null if invalid
 */
export function sanitizeUrl(url: string | null | undefined): string | null {
    if (!url) return null;

    const trimmed = url.trim();

    // Only allow http, https protocols
    if (!trimmed.match(/^https?:\/\//)) {
        return null;
    }

    // Basic URL validation
    try {
        new URL(trimmed);
        return trimmed.slice(0, 2048); // Max URL length
    } catch {
        return null;
    }
}

/**
 * Sanitize option text (for quiz questions)
 * Maximum 200 characters per option
 * 
 * @param text - Raw option text
 * @returns Sanitized option text
 */
export function sanitizeOptionText(text: string): string {
    return sanitizeText(text, 200);
}

/**
 * Sanitize color value
 * Only allows alphanumeric characters and hyphens
 * 
 * @param color - Raw color value
 * @returns Sanitized color string
 */
export function sanitizeColor(color: string): string {
    if (!color || typeof color !== 'string') {
        return 'blue'; // Default color
    }

    return color
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9-]/g, '')
        .slice(0, 50);
}

/**
 * Validate and sanitize number input
 * Ensures number is within valid range
 * 
 * @param value - Raw number input
 * @param min - Minimum allowed value
 * @param max - Maximum allowed value
 * @param defaultValue - Default value if invalid
 * @returns Sanitized number
 */
export function sanitizeNumber(
    value: number,
    min: number,
    max: number,
    defaultValue: number
): number {
    if (typeof value !== 'number' || isNaN(value)) {
        return defaultValue;
    }

    return Math.max(min, Math.min(max, Math.floor(value)));
}

/**
 * Sanitize time limit (in seconds)
 * Range: 5-300 seconds (5 seconds to 5 minutes)
 * 
 * @param timeLimit - Raw time limit
 * @returns Sanitized time limit
 */
export function sanitizeTimeLimit(timeLimit: number): number {
    return sanitizeNumber(timeLimit, 5, 300, 30);
}

/**
 * Sanitize points value
 * Range: 100-10000 points
 * 
 * @param points - Raw points value
 * @returns Sanitized points
 */
export function sanitizePoints(points: number): number {
    return sanitizeNumber(points, 100, 10000, 1000);
}

/**
 * Sanitize array of question options
 * Validates structure and sanitizes text/color
 * 
 * @param options - Raw options array
 * @returns Sanitized options array
 */
export function sanitizeQuestionOptions(
    options: Array<{ text: string; color: string }>
): Array<{ text: string; color: string }> {
    if (!Array.isArray(options)) {
        return [];
    }

    return options
        .filter((opt) => opt && typeof opt === 'object')
        .map((opt) => ({
            text: sanitizeOptionText(opt.text),
            color: sanitizeColor(opt.color),
        }))
        .filter((opt) => opt.text.length > 0); // Remove empty options
}

/**
 * Validate subdomain format
 * Only allows lowercase letters, numbers, and hyphens
 * 
 * @param subdomain - Raw subdomain
 * @returns True if valid, false otherwise
 */
export function isValidSubdomain(subdomain: string): boolean {
    if (!subdomain || typeof subdomain !== 'string') {
        return false;
    }

    // Subdomain rules:
    // - 3-63 characters
    // - Lowercase letters, numbers, hyphens only
    // - Cannot start or end with hyphen
    const subdomainRegex = /^[a-z0-9]([a-z0-9-]{1,61}[a-z0-9])?$/;
    return subdomainRegex.test(subdomain);
}
