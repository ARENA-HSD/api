import jwt from "jsonwebtoken";
import { schema } from "../core/database/client";
import type { InferSelectModel } from "drizzle-orm";

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret";
const TOKEN_EXPIRES_IN = "7d";

export type UserRow = InferSelectModel<typeof schema.users>;

export const toPublicUser = (user: UserRow) => ({
  id: user.id,
  username: user.username,
  email: user.email,
  createdAt: user.createdAt,
});

export const signUserToken = (user: Pick<UserRow, "id" | "email">) =>
  jwt.sign({ sub: user.id, email: user.email }, JWT_SECRET, {
    expiresIn: TOKEN_EXPIRES_IN,
  });

export const jwtConfig = {
  secret: JWT_SECRET,
  expiresIn: TOKEN_EXPIRES_IN,
};
