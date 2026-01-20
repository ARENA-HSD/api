import { pgTable, uuid, timestamp, integer, jsonb } from 'drizzle-orm/pg-core';
import { quizzes } from './quizzes';

export const gameReports = pgTable('game_reports', {
  id: uuid('id').defaultRandom().primaryKey(),
  quizId: uuid('quiz_id')
    .notNull()
    .references(() => quizzes.id, { onDelete: 'cascade' }),
  playedAt: timestamp('played_at').defaultNow().notNull(),
  participantCount: integer('participant_count').notNull().default(0),
  winnerData: jsonb('winner_data'), // Stores JSON data about winners
});

export type GameReport = typeof gameReports.$inferSelect;
export type NewGameReport = typeof gameReports.$inferInsert;
