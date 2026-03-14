import { Elysia, t } from "elysia";
import bearer from "@elysiajs/bearer";
import jwtPlugin from "@elysiajs/jwt";
import { eq } from "drizzle-orm";
import { db, schema } from "../../core/database/client";
import { jwtConfig, toPublicUser } from "../../middleware/auth.middleware";
import { logEvent } from "../../shared/helpers/log.helper";
import { verifyTurnstileToken } from "../../shared/helpers/turnstile.helper";

export const loginRoutes = new Elysia({ prefix: "/login" })
	.use(bearer())
	.use(jwtPlugin({ name: "jwt", secret: jwtConfig.secret }))
	.post(
		"/",
		async ({ body, set, jwt, request }) => {
			const { email, password, cfTurnstileToken } = body;

			const remoteIp =
				request.headers.get("CF-Connecting-IP") ??
				request.headers.get("X-Forwarded-For") ??
				undefined;

			const turnstile = await verifyTurnstileToken(cfTurnstileToken, remoteIp ?? undefined);
			if (!turnstile.success) {
				set.status = 400;
				return { success: false, message: "Turnstile verification failed" };
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
				cfTurnstileToken: t.String({ minLength: 1 }),
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
