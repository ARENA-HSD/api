import { pgTable, uuid, text, varchar, integer } from 'drizzle-orm/pg-core';
import { quizzes } from './quizzes';

export const questions = pgTable('questions', {
  id: uuid('id').defaultRandom().primaryKey(),
  quizId: uuid('quiz_id')
    .notNull()
    .references(() => quizzes.id, { onDelete: 'cascade' }),
  text: text('text').notNull(),
  imageUrl: varchar('image_url', { length: 500 }),
  timeLimit: integer('time_limit').notNull().default(30), // seconds
  orderIndex: integer('order_index').notNull(),
});

export type Question = typeof questions.$inferSelect;
export type NewQuestion = typeof questions.$inferInsert;
