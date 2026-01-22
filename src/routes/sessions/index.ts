import { Elysia, t } from "elysia";
import { eq } from "drizzle-orm";
import { db, schema } from "../../db";
import { signUserToken, toPublicUser } from "../../lib/auth";

export const sessionsRoutes = new Elysia({ prefix: "/sessions" })
	.post(
		"/",
		async ({ body, set }) => {
			const { email, password } = body;

			const [user] = await db
				.select()
				.from(schema.users)
				.where(eq(schema.users.email, email))
				.limit(1);

			if (!user) {
				set.status = 401;
				return { success: false, message: "Invalid credentials" };
			}

			const valid = await Bun.password.verify(password, user.password);
			if (!valid) {
				set.status = 401;
				return { success: false, message: "Invalid credentials" };
			}

			const token = signUserToken({ id: user.id, email: user.email });

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
			}),
			response: t.Object({
				success: t.Boolean(),
				data: t.Optional(t.Any()),
				message: t.Optional(t.String()),
			}),
			detail: {
				summary: "Authenticate user and issue JWT",
				tags: ["Session Operations"],
			},
		}
	);
