import { pgTable, uuid, varchar, timestamp, pgEnum, boolean } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { organizations } from './organizations';
import { users } from './users';
import { questions } from './questions';

export const defaultModeEnum = pgEnum('default_mode', ['PERSONAL', 'STAGE']);

export const quizzes = pgTable('quizzes', {
  id: uuid('id').defaultRandom().primaryKey(),
  orgId: uuid('org_id')
    .notNull()
    .references(() => organizations.id, { onDelete: 'cascade' }),
  creatorId: uuid('creator_id')
    .references(() => users.id, { onDelete: 'set null' }),
  title: varchar('title', { length: 255 }).notNull(),
  defaultMode: defaultModeEnum('default_mode').notNull(),
  isDeleted: boolean('is_deleted').default(false),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const quizzesRelations = relations(quizzes, ({ many, one }) => ({
  questions: many(questions),
  organization: one(organizations, {
    fields: [quizzes.orgId],
    references: [organizations.id],
  }),
  creator: one(users, {
    fields: [quizzes.creatorId],
    references: [users.id],
  }),
}));

export type Quiz = typeof quizzes.$inferSelect;
export type NewQuiz = typeof quizzes.$inferInsert;
