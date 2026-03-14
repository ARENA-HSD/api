const TURNSTILE_VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const TURNSTILE_TEST_SECRET_KEY = "1x0000000000000000000000000000000AA";

interface TurnstileVerifyResponse {
  success: boolean;
  "error-codes"?: string[];
  challenge_ts?: string;
  hostname?: string;
}

/**
 * Verifies a Cloudflare Turnstile token server-side.
 * @param token  - The `cf-turnstile-response` token from the client
 * @param remoteip - (Optional) The visitor's IP address for extra validation
 */
export async function verifyTurnstileToken(
  token: string,
  remoteip?: string
): Promise<{ success: boolean; errorCodes?: string[] }> {
  const isLocalEnvironment =
    process.env.NODE_ENV !== "production" ||
    process.env.HOSTNAME === "localhost" ||
    process.env.HOST === "localhost";

  const secret =  (isLocalEnvironment ? TURNSTILE_TEST_SECRET_KEY : process.env.TURNSTILE_SECRET_KEY);

  if (!secret) {
    throw new Error("TURNSTILE_SECRET_KEY environment variable is not set");
  }

  const body = new URLSearchParams({ secret, response: token });
  if (remoteip) body.append("remoteip", remoteip);

  const res = await fetch(TURNSTILE_VERIFY_URL, {
    method: "POST",
    body,
  });

  if (!res.ok) {
    return { success: false, errorCodes: ["fetch-failed"] };
  }

  const data = (await res.json()) as TurnstileVerifyResponse;

  return {
    success: data.success,
    errorCodes: data["error-codes"],
  };
}
