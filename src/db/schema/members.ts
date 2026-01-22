import { pgTable, uuid, timestamp, pgEnum, unique } from 'drizzle-orm/pg-core';
import { organizations } from './organizations';
import { users } from './users';

export const roleEnum = pgEnum('member_role', ['SUPER_ADMIN', 'ADMIN', 'MANAGER']);

export const members = pgTable('members', {
  id: uuid('id').defaultRandom().primaryKey(),
  orgId: uuid('org_id')
    .notNull()
    .references(() => organizations.id, { onDelete: 'cascade' }),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  role: roleEnum('role').notNull(),
  joinedAt: timestamp('joined_at').defaultNow().notNull(),
}, (table) => ({
  uniqueOrgUser: unique('members_org_id_user_id_unique').on(table.orgId, table.userId),
}));

export type Member = typeof members.$inferSelect;
export type NewMember = typeof members.$inferInsert;
