import { pgTable, uuid, text, varchar, integer, jsonb } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { quizzes } from './quizzes';

export const questions = pgTable('questions', {
  id: uuid('id').defaultRandom().primaryKey(),
  quizId: uuid('quiz_id')
    .notNull()
    .references(() => quizzes.id, { onDelete: 'cascade' }),
  text: text('text').notNull(),
  mediaUrl: varchar('media_url', { length: 500 }),
  timeLimit: integer('time_limit').notNull(),
  points: integer('points').default(1000),
  correctIndex: integer('correct_index').notNull(),
  orderIndex: integer('order_index').notNull(),
  options: jsonb('options').notNull(),
});

export const questionsRelations = relations(questions, ({ one }) => ({
  quiz: one(quizzes, {
    fields: [questions.quizId],
    references: [quizzes.id],
  }),
}));

export type Question = typeof questions.$inferSelect;
export type NewQuestion = typeof questions.$inferInsert;
