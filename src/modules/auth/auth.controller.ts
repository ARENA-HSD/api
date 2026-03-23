import { Elysia, t } from "elysia";
import bearer from "@elysiajs/bearer";
import jwtPlugin from "@elysiajs/jwt";
import { eq } from "drizzle-orm";
import { db, schema } from "../../core/database/client";
import { jwtConfig, toPublicUser } from "../../middleware/auth.middleware";
import { logEvent } from "../../shared/helpers/log.helper";
import { verifyTurnstileToken } from "../../shared/helpers/turnstile.helper";
import { getOrgIdBySubdomain, getUserRoleInOrg } from "../../middleware/rbac.middleware";
import {
	getOrgSubdomainFromHost,
	getRequestHost,
	isMainDomainHost,
} from "../../shared/helpers/request-host.helper";

const shouldVerifyTurnstileOnLogin = (host: string | undefined): boolean => {
	if (!host) return true;

	if (isMainDomainHost(host)) return true;

	// Skip Turnstile for org subdomains only.
	if (getOrgSubdomainFromHost(host)) return false;

	return true;
};

export const loginRoutes = new Elysia({ prefix: "/login" })
	.use(bearer())
	.use(jwtPlugin({ name: "jwt", secret: jwtConfig.secret }))
	.post(
		"/",
		async ({ body, set, jwt, request }) => {
			const { email, password, cfTurnstileToken } = body;
			const host = getRequestHost(request);
			const orgSubdomain = getOrgSubdomainFromHost(host);

			const remoteIp =
				request.headers.get("CF-Connecting-IP") ??
				request.headers.get("X-Forwarded-For") ??
				undefined;

			if (shouldVerifyTurnstileOnLogin(host)) {
				if (!cfTurnstileToken) {
					set.status = 400;
					return { success: false, message: "Turnstile token is required" };
				}

				const turnstile = await verifyTurnstileToken(cfTurnstileToken, remoteIp ?? undefined);
				if (!turnstile.success) {
					set.status = 400;
					return { success: false, message: "Turnstile verification failed" };
				}
			}

			const [user] = await db
				.select()
				.from(schema.users)
				.where(eq(schema.users.email, email))
				.limit(1);

			if (!user) {
				set.status = 401;
				return { success: false, message: "Invalid credentials" };
			}

			let valid: boolean;
			try {
				valid = await Bun.password.verify(password, user.password);
			} catch (error) {
				logEvent({ event: 'auth.token.error', level: 'ERROR', source: 'code', data: { error: error instanceof Error ? error.message : 'unknown' } });
				set.status = 500;
				return { success: false, message: "Authentication error" };
			}
			if (!valid) {
				set.status = 401;
				return { success: false, message: "Invalid credentials" };
			}

			if (orgSubdomain) {
				if (orgSubdomain === "admin") {
					if (user.role !== "WEB_ADMIN") {
						set.status = 403;
						logEvent({ event: 'auth.admin.access.denied', level: 'WARNING', source: 'code', data: { userId: user.id, orgSubdomain, reason: 'not_web_admin' } });
						return { success: false, message: "Admin access denied" };
					}
				} else {
					const orgId = await getOrgIdBySubdomain(orgSubdomain);

					if (!orgId) {
						set.status = 403;
						logEvent({ event: 'auth.org.access.denied', level: 'WARNING', source: 'code', data: { userId: user.id, orgSubdomain, reason: 'org_not_found' } });
						return { success: false, message: "Organization access denied" };
					}

					const role = await getUserRoleInOrg(user.id, orgId);
					if (!role) {
						set.status = 403;
						logEvent({ event: 'auth.org.access.denied', level: 'WARNING', source: 'code', data: { userId: user.id, orgSubdomain, orgId, reason: 'not_member' } });
						return { success: false, message: "Organization access denied" };
					}
				}
			}

			const token = await jwt.sign({ sub: user.id, email: user.email });

			return {
				success: true,
				data: {
					user: toPublicUser(user),
					token,
				},
			};
		},
		{
			body: t.Object({
				email: t.String({ format: "email" }),
				password: t.String({ minLength: 6 }),
				cfTurnstileToken: t.Optional(t.String({ minLength: 1 })),
			}),
			response: t.Object({
				success: t.Boolean(),
				data: t.Optional(t.Object({
					user: t.Object({
						id: t.String({ format: "uuid" }),
						username: t.String(),
						email: t.String({ format: "email" }),
					}),
					token: t.String(),
				})),
				message: t.Optional(t.String()),
			}),
			detail: {
				summary: "Authenticate user and issue JWT",
				tags: ["Auth Operations"],
			},
		}
	);
