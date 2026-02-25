// INVITATIONS SERVICE LAYER
// Business Logic for Invitation Operations

import { eq, and } from 'drizzle-orm';
import { db, schema } from '../../core/database/client';

// ─── Types ───────────────────────────────────────────

export type InvitationResult =
    | { success: true; data: any }
    | { success: false; status: number; message: string };

// ─── CREATE INVITATION ───────────────────────────────

/**
 * Creates a new invitation.
 * Only SUPER_ADMIN can invite.
 * Checks: user exists, not self-invite, not already member, no pending invite.
 */
export async function createInvitation(
    orgId: string,
    inviterId: string,
    inviteeUsername: string
): Promise<InvitationResult> {
    // 1. Find invitee by username
    const [invitee] = await db
        .select({ id: schema.users.id })
        .from(schema.users)
        .where(eq(schema.users.username, inviteeUsername))
        .limit(1);

    if (!invitee) {
        return { success: false, status: 404, message: 'User not found' };
    }

    // 2. Cannot invite yourself
    if (invitee.id === inviterId) {
        return { success: false, status: 400, message: 'Cannot invite yourself' };
    }

    // 3. Check if already a member
    const [existingMember] = await db
        .select({ id: schema.members.id })
        .from(schema.members)
        .where(
            and(
                eq(schema.members.orgId, orgId),
                eq(schema.members.userId, invitee.id)
            )
        )
        .limit(1);

    if (existingMember) {
        return { success: false, status: 409, message: 'User is already a member of this organization' };
    }

    // 4. Check if pending invitation already exists
    const [existingInvitation] = await db
        .select({ id: schema.invitations.id })
        .from(schema.invitations)
        .where(
            and(
                eq(schema.invitations.orgId, orgId),
                eq(schema.invitations.inviteeId, invitee.id),
                eq(schema.invitations.status, 'PENDING')
            )
        )
        .limit(1);

    if (existingInvitation) {
        return { success: false, status: 409, message: 'A pending invitation already exists for this user' };
    }

    // 5. Create invitation
    const [invitation] = await db
        .insert(schema.invitations)
        .values({
            orgId,
            inviterId,
            inviteeId: invitee.id,
        })
        .returning();

    return { success: true, data: { invitation } };
}

// ─── RESPOND TO INVITATION (ACCEPT / REJECT) ────────

/**
 * Accept or reject an invitation.
 * Only the invitee can respond.
 * If accepted → insert into members table with MANAGER role.
 */
export async function respondToInvitation(
    invitationId: string,
    userId: string,
    newStatus: 'ACCEPTED' | 'REJECTED'
): Promise<InvitationResult> {
    // 1. Find invitation
    const [invitation] = await db
        .select()
        .from(schema.invitations)
        .where(eq(schema.invitations.id, invitationId))
        .limit(1);

    if (!invitation) {
        return { success: false, status: 404, message: 'Invitation not found' };
    }

    // 2. Only invitee can respond
    if (invitation.inviteeId !== userId) {
        return { success: false, status: 403, message: 'Only the invited user can respond to this invitation' };
    }

    // 3. Cannot respond to already responded invitation
    if (invitation.status !== 'PENDING') {
        return { success: false, status: 400, message: `Invitation already ${invitation.status.toLowerCase()}` };
    }

    // 4. Update invitation status
    const [updated] = await db
        .update(schema.invitations)
        .set({ status: newStatus })
        .where(eq(schema.invitations.id, invitationId))
        .returning();

    // 5. If accepted, add to members
    if (newStatus === 'ACCEPTED') {
        await db.insert(schema.members).values({
            orgId: invitation.orgId,
            userId: invitation.inviteeId,
            role: 'MANAGER',
        });
    }

    return { success: true, data: { invitation: updated } };
}

// ─── CANCEL INVITATION ──────────────────────────────

/**
 * Cancel (delete) a pending invitation.
 * Only the inviter (SUPER_ADMIN) can cancel.
 */
export async function cancelInvitation(
    invitationId: string,
    userId: string
): Promise<InvitationResult> {
    // 1. Find invitation
    const [invitation] = await db
        .select()
        .from(schema.invitations)
        .where(eq(schema.invitations.id, invitationId))
        .limit(1);

    if (!invitation) {
        return { success: false, status: 404, message: 'Invitation not found' };
    }

    // 2. Only inviter can cancel
    if (invitation.inviterId !== userId) {
        return { success: false, status: 403, message: 'Only the inviter can cancel this invitation' };
    }

    // 3. Cannot cancel already responded invitation
    if (invitation.status !== 'PENDING') {
        return { success: false, status: 400, message: `Cannot cancel: invitation already ${invitation.status.toLowerCase()}` };
    }

    // 4. Delete
    await db
        .delete(schema.invitations)
        .where(eq(schema.invitations.id, invitationId));

    return { success: true, data: { message: 'Invitation cancelled successfully' } };
}

// ─── GET INVITATION BY ID ───────────────────────────

/**
 * Get a single invitation.
 * Accessible by inviter or invitee only.
 */
export async function getInvitationById(
    invitationId: string,
    userId: string
): Promise<InvitationResult> {
    const [invitation] = await db
        .select()
        .from(schema.invitations)
        .where(eq(schema.invitations.id, invitationId))
        .limit(1);

    if (!invitation) {
        return { success: false, status: 404, message: 'Invitation not found' };
    }

    // Only inviter or invitee can view
    if (invitation.inviterId !== userId && invitation.inviteeId !== userId) {
        return { success: false, status: 403, message: 'Access denied' };
    }

    return { success: true, data: { invitation } };
}

// ─── LIST INVITATIONS ───────────────────────────────

/**
 * List invitations for an organization.
 * SUPER_ADMIN sees all invitations for that org.
 * Others see only invitations where they are the invitee.
 */
export async function getInvitationsByOrg(
    orgId: string,
    userId: string,
    userRole: 'SUPER_ADMIN' | 'ADMIN' | 'MANAGER' | null
): Promise<InvitationResult> {
    let invitations;

    if (userRole === 'SUPER_ADMIN') {
        // Super Admin sees all invitations for this org
        invitations = await db
            .select()
            .from(schema.invitations)
            .where(eq(schema.invitations.orgId, orgId));
    } else {
        // Others see only their own received invitations for this org
        invitations = await db
            .select()
            .from(schema.invitations)
            .where(
                and(
                    eq(schema.invitations.orgId, orgId),
                    eq(schema.invitations.inviteeId, userId)
                )
            );
    }

    return { success: true, data: { invitations } };
}
