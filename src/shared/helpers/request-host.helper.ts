let DEFAULT_MAIN_DOMAIN = "quizstrike.com.tr";

if (process.env.NODE_ENV === "development") DEFAULT_MAIN_DOMAIN = "localhost";

export const MAIN_DOMAIN = (process.env.MAIN_DOMAIN ?? DEFAULT_MAIN_DOMAIN).toLowerCase();

const parseFirstHeaderValue = (value: string | null): string | undefined => {
  if (!value) return undefined;
  return value.split(",")[0]?.trim() || undefined;
};

const normalizeHost = (value: string | undefined): string | undefined => {
  if (!value) return undefined;

  const withProtocol = value.includes("://") ? value : `http://${value}`;

  try {
    const url = new URL(withProtocol);
    return url.hostname.toLowerCase();
  } catch {
    return undefined;
  }
};

export const getRequestHost = (request: Request): string | undefined => {
  const forwardedHost = parseFirstHeaderValue(request.headers.get("x-forwarded-host"));
  const origin = request.headers.get("origin") ?? undefined;

  return normalizeHost(forwardedHost ?? origin);
};

export const isMainDomainHost = (host: string | undefined): boolean => {
  if (!host) return true;
  return host === MAIN_DOMAIN || host === `www.${MAIN_DOMAIN}`;
};

export const getOrgSubdomainFromHost = (host: string | undefined): string | null => {
  if (!host || isMainDomainHost(host)) return null;

  const suffix = `.${MAIN_DOMAIN}`;
  if (!host.endsWith(suffix)) return null;

  const subdomain = host.slice(0, -suffix.length);
  if (!subdomain || subdomain.includes(".")) return null;


  return subdomain;
};
