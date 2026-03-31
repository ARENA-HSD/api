export type ClientPlatform = 'android' | 'ios' | 'desktop' | 'other' | 'unknown';

const MAX_CLOSE_REASON_LENGTH = 120;

const getHeaderValue = (headers: any, key: string): string | undefined => {
  if (!headers) return undefined;

  // Bun/Elysia may provide Headers-like API
  if (typeof headers.get === 'function') {
    const value = headers.get(key) ?? headers.get(key.toLowerCase()) ?? headers.get(key.toUpperCase());
    return value ?? undefined;
  }

  // Fallback for plain object headers
  const record = headers as Record<string, string | undefined>;
  return record[key] ?? record[key.toLowerCase()] ?? record[key.toUpperCase()] ?? undefined;
};

const normalizeUserAgent = (userAgent: string | undefined): string | undefined => {
  if (!userAgent) return undefined;
  const trimmed = userAgent.trim();
  if (!trimmed) return undefined;
  return trimmed.slice(0, 220);
};

export const detectClientPlatform = (userAgent: string | undefined): ClientPlatform => {
  if (!userAgent) return 'unknown';

  const ua = userAgent.toLowerCase();

  if (ua.includes('android')) return 'android';
  if (ua.includes('iphone') || ua.includes('ipad') || ua.includes('ios')) return 'ios';

  if (
    ua.includes('windows') ||
    ua.includes('macintosh') ||
    ua.includes('mac os') ||
    ua.includes('linux x86_64') ||
    ua.includes('x11')
  ) {
    return 'desktop';
  }

  if (ua.includes('mozilla') || ua.includes('chrome') || ua.includes('safari')) return 'other';

  return 'unknown';
};

export const sanitizeCloseReason = (reason: unknown): string => {
  if (typeof reason !== 'string') return 'none';

  const normalized = reason.replace(/[^\x20-\x7E]/g, '').trim();
  if (!normalized) return 'none';

  return normalized.slice(0, MAX_CLOSE_REASON_LENGTH);
};

export const extractWebSocketMeta = (ws: any) => {
  const headers = ws?.raw?.headers;
  const userAgent = normalizeUserAgent(getHeaderValue(headers, 'user-agent'));

  const cfConnectingIp = getHeaderValue(headers, 'cf-connecting-ip');
  const forwardedFor = getHeaderValue(headers, 'x-forwarded-for');
  const xRealIp = getHeaderValue(headers, 'x-real-ip');

  const clientIp =
    forwardedFor?.split(',')[0]?.trim() ||
    xRealIp ||
    cfConnectingIp ||
    'unknown';

  return {
    userAgent,
    clientIp,
    platform: detectClientPlatform(userAgent),
    cfRay: getHeaderValue(headers, 'cf-ray') || undefined,
    cfConnectingIp: cfConnectingIp || undefined,
    xForwardedFor: forwardedFor || undefined,
  };
};
