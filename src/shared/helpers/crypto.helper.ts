/**
 * Shared authentication utilities for routes
 */
import { logEvent } from './log.helper';

type CookieJar = Record<string, { value?: string | undefined }> | undefined;
type AuthPayload = { sub: string; email: string };

/**
 * Extract token value from cookie jar
 */
export const getCookieValue = (cookies: any): string | undefined => {
    return cookies?.token?.value;
};

/**
 * Require authentication and return user payload
 * Returns null if authentication fails (also sets status to 401)
 */
export const requireAuth = async (
    jwt: { verify: (token: string) => Promise<unknown> },
    bearerToken: string | null | undefined,
    cookie: any,
    set: any
): Promise<AuthPayload | null> => {
    const token = bearerToken || getCookieValue(cookie);
    if (!token) {
        set.status = 401;
        return null;
    }

    try {
        const payload = (await jwt.verify(token)) as AuthPayload;
        return payload;
    } catch (error) {
        logEvent({ event: 'auth.token.error', level: 'ERROR', source: 'code', data: { error: error instanceof Error ? error.message : 'unknown' } });
        set.status = 401;
        return null;
    }
};
