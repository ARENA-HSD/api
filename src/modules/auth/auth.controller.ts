import { Elysia, t } from "elysia";
import bearer from "@elysiajs/bearer";
import jwtPlugin from "@elysiajs/jwt";
import { eq } from "drizzle-orm";
import { db, schema } from "../../core/database/client";
import { jwtConfig, toPublicUser } from "../../middleware/auth.middleware";

export const loginRoutes = new Elysia({ prefix: "/login" })
	.use(bearer())
	.use(jwtPlugin({ name: "jwt", secret: jwtConfig.secret }))
	.post(
		"/",
		async ({ body, set, jwt }) => {
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
	)
	.post(
		"/register",
		async ({ body, set, jwt }) => {
			const { username, email, password } = body;

			// Check if email already exists
			const [existingUser] = await db
				.select()
				.from(schema.users)
				.where(eq(schema.users.email, email))
				.limit(1);

			if (existingUser) {
				set.status = 409; // Conflict
				return { success: false, message: "Email already registered" };
			}

			// Hash password
			const hashedPassword = await Bun.password.hash(password);

			// Create user
			const [user] = await db
				.insert(schema.users)
				.values({
					username,
					email,
					password: hashedPassword,
				})
				.returning();

			// Generate token
			const token = await jwt.sign({ sub: user.id, email: user.email });

			return {
				success: true,
				data: {
					user: toPublicUser(user),
					token,
				},
				message: "User registered successfully",
			};
		},
		{
			body: t.Object({
				username: t.String({ minLength: 3 }),
				email: t.String({ format: "email" }),
				password: t.String({ minLength: 6 }),
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
				summary: "Register new user and issue JWT",
				tags: ["Auth Operations"],
			},
		}
	);
