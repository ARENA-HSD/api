import { pgTable, uuid, timestamp, pgEnum } from 'drizzle-orm/pg-core';

export const invitationStatusEnum = pgEnum('invitation_status', [
  'PENDING',
  'ACCEPTED',
  'REJECTED',
]);

export const invitations = pgTable('invitations', {
    id: uuid('id').defaultRandom().primaryKey(),
    orgId: uuid('org_id').notNull(),
    inviterId: uuid('inviter_id').notNull(),
    inviteeId: uuid('invitee_id').notNull(),
    status: invitationStatusEnum('status').default('PENDING').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  });

export type Invitation = typeof invitations.$inferSelect;
export type NewInvitation = typeof invitations.$inferInsert;
