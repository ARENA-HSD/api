// INVITATIONS SERVICE LAYER

import { eq, and, lt } from 'drizzle-orm';
import { db, schema } from '../../core/database/client';

const INVITATION_EXPIRY_DAYS = 3;

//  Types 

export type InvitationResult =
    | { success: true; data: any }
    | { success: false; status: number; message: string };

//  CREATE INVITATION

export async function createInvitation(
    orgId: string,
    inviterId: string,
    inviteeUsername: string
): Promise<InvitationResult> {
    const [invitee] = await db
        .select({ id: schema.users.id })
        .from(schema.users)
        .where(eq(schema.users.username, inviteeUsername))
        .limit(1);

    if (!invitee) {
        return { success: false, status: 404, message: 'User not found' };
    }

    if (invitee.id === inviterId) {
        return { success: false, status: 400, message: 'Cannot invite yourself' };
    }

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

//  RESPOND TO INVITATION (ACCEPT / REJECT)

export async function respondToInvitation(
    invitationId: string,
    userId: string,
    newStatus: 'ACCEPTED' | 'REJECTED'
): Promise<InvitationResult> {
    const [invitation] = await db
        .select()
        .from(schema.invitations)
        .where(eq(schema.invitations.id, invitationId))
        .limit(1);

    if (!invitation) {
        return { success: false, status: 404, message: 'Invitation not found' };
    }

    if (invitation.inviteeId !== userId) {
        return { success: false, status: 403, message: 'Only the invited user can respond to this invitation' };
    }

    if (invitation.status !== 'PENDING') {
        return { success: false, status: 400, message: `Invitation already ${invitation.status.toLowerCase()}` };
    }

    // Suresi dolmus mu kontrol et (3 gun)
    const expiryDate = new Date(invitation.createdAt);
    expiryDate.setDate(expiryDate.getDate() + INVITATION_EXPIRY_DAYS);
    if (new Date() > expiryDate) {
        await db.delete(schema.invitations).where(eq(schema.invitations.id, invitationId));
        return { success: false, status: 410, message: 'Invitation has expired' };
    }

    const [updated] = await db
        .update(schema.invitations)
        .set({ status: newStatus })
        .where(eq(schema.invitations.id, invitationId))
        .returning();

    if (newStatus === 'ACCEPTED') {
        await db.insert(schema.members).values({
            orgId: invitation.orgId,
            userId: invitation.inviteeId,
            role: 'MANAGER',
        });
    }

    return { success: true, data: { invitation: updated } };
}

//  CANCEL INVITATION
export async function cancelInvitation(
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

    if (invitation.inviterId !== userId) {
        return { success: false, status: 403, message: 'Only the inviter can cancel this invitation' };
    }

    if (invitation.status !== 'PENDING') {
        return { success: false, status: 400, message: `Cannot cancel: invitation already ${invitation.status.toLowerCase()}` };
    }

    await db
        .delete(schema.invitations)
        .where(eq(schema.invitations.id, invitationId));

    return { success: true, data: { message: 'Invitation cancelled successfully' } };
}

//  GET INVITATION BY ID
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

    if (invitation.inviterId !== userId && invitation.inviteeId !== userId) {
        return { success: false, status: 403, message: 'Access denied' };
    }

    return { success: true, data: { invitation } };
}

//  LIST INVITATIONS

export async function getInvitationsByOrg(
    orgId: string,
    userId: string,
    userRole: 'SUPER_ADMIN' | 'ADMIN' | 'MANAGER' | null
): Promise<InvitationResult> {
    let invitations;

    if (userRole === 'SUPER_ADMIN') {
        invitations = await db
            .select()
            .from(schema.invitations)
            .where(eq(schema.invitations.orgId, orgId));
    } else {
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

//  GET MY INVITATIONS (user-scoped, with org names)

export async function getMyInvitations(userId: string): Promise<InvitationResult> {
    const results = await db
        .select({
            id: schema.invitations.id,
            orgId: schema.invitations.orgId,
            orgName: schema.organizations.name,
            orgSubdomain: schema.organizations.subdomain,
            inviterUsername: schema.users.username,
            status: schema.invitations.status,
            createdAt: schema.invitations.createdAt,
        })
        .from(schema.invitations)
        .innerJoin(schema.organizations, eq(schema.invitations.orgId, schema.organizations.id))
        .innerJoin(schema.users, eq(schema.invitations.inviterId, schema.users.id))
        .where(
            and(
                eq(schema.invitations.inviteeId, userId),
                eq(schema.invitations.status, 'PENDING')
            )
        );

    // Filter out expired invitations (3 days)
    const validInvitations = results.filter(inv => {
        const expiry = new Date(inv.createdAt);
        expiry.setDate(expiry.getDate() + INVITATION_EXPIRY_DAYS);
        return new Date() <= expiry;
    });

    return { success: true, data: { invitations: validInvitations } };
}

// 3 gunu gecen PENDING davetleri siler (cron ile cagirilir)
export async function cleanupExpiredInvitations(): Promise<number> {
    const expiryDate = new Date();
    expiryDate.setDate(expiryDate.getDate() - INVITATION_EXPIRY_DAYS);

    const deleted = await db
        .delete(schema.invitations)
        .where(
            and(
                eq(schema.invitations.status, 'PENDING'),
                lt(schema.invitations.createdAt, expiryDate)
            )
        )
        .returning({ id: schema.invitations.id });

    return deleted.length;
}
