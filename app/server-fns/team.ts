// ABOUTME: Team Collaboration server functions (Issue #9)
// ABOUTME: Team invites, post comments, and approval workflows

import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { eq, and, desc, sql, isNull } from 'drizzle-orm';
import { getDb } from '@/lib/db/client';
import * as schema from '@/lib/schema';
import { requireAuth } from '@/app/server-fns/auth';

// Team invites
export const inviteTeamMember = createServerFn({ method: 'POST' })
  .inputValidator(z.object({
    email: z.string().email(),
    role: z.enum(['admin', 'editor', 'viewer']).default('editor'),
  }))
  .handler(async ({ data }) => {
    const user = await requireAuth();
    const db = await getDb();
    
    // Get user's team and verify they have permission
    const membership = await db
      .select({ teamId: schema.team_memberships.team_id, role: schema.team_memberships.role })
      .from(schema.team_memberships)
      .where(eq(schema.team_memberships.user_id, user.id))
      .limit(1);
    
    if (membership.length === 0) {
      throw new Error('Not authorized');
    }
    
    const { teamId, role: userRole } = membership[0];
    
    // Only owner/admin can invite
    if (!['owner', 'admin'].includes(userRole)) {
      throw new Error('Only team owners and admins can invite members');
    }
    
    // Generate invite token
    const token = crypto.randomUUID();
    const now = Date.now();
    const expiresAt = now + 7 * 24 * 60 * 60 * 1000; // 7 days
    
    await db.insert(schema.team_invites).values({
      id: crypto.randomUUID(),
      team_id: teamId,
      email: data.email,
      role: data.role,
      invited_by: user.id,
      token,
      expires_at: expiresAt,
      created_at: now,
    });
    
    return { token, message: 'Invitation sent' };
  });

// Accept team invite
export const acceptInvite = createServerFn({ method: 'POST' })
  .inputValidator(z.object({ token: z.string() }))
  .handler(async ({ data }) => {
    const user = await requireAuth();
    const db = await getDb();
    
    // Find invite
    const invite = await db
      .select()
      .from(schema.team_invites)
      .where(and(
        eq(schema.team_invites.token, data.token),
        eq(schema.team_invites.email, user.email),
        sql`${schema.team_invites.accepted_at} IS NULL`
      ))
      .limit(1);
    
    if (invite.length === 0) {
      throw new Error('Invalid or expired invite');
    }
    
    const inviteData = invite[0];
    
    // Check expiration
    if (inviteData.expires_at < Date.now()) {
      throw new Error('Invite has expired');
    }
    
    // Add user to team
    await db.insert(schema.team_memberships).values({
      id: crypto.randomUUID(),
      user_id: user.id,
      team_id: inviteData.team_id,
      role: inviteData.role,
      created_at: Date.now(),
    });
    
    // Mark invite as accepted
    await db
      .update(schema.team_invites)
      .set({
        accepted_at: Date.now(),
      })
      .where(eq(schema.team_invites.id, inviteData.id));
    
    return { message: 'Joined team successfully' };
  });

// Get team members
export const getTeamMembers = createServerFn({ method: 'GET' })
  .handler(async () => {
    const user = await requireAuth();
    const db = await getDb();
    
    const membership = await db
      .select({ teamId: schema.team_memberships.team_id })
      .from(schema.team_memberships)
      .where(eq(schema.team_memberships.user_id, user.id))
      .limit(1);
    
    if (membership.length === 0) {
      return [];
    }
    
    const members = await db
      .select({
        membership: schema.team_memberships,
        user: schema.users,
      })
      .from(schema.team_memberships)
      .where(eq(schema.team_memberships.team_id, membership[0].teamId))
      .innerJoin(schema.users, eq(schema.team_memberships.user_id, schema.users.id));
    
    return members.map(m => ({
      id: m.membership.id,
      userId: m.user.id,
      email: m.user.email,
      name: m.user.name,
      role: m.membership.role,
    }));
  });

// Remove team member
export const removeTeamMember = createServerFn({ method: 'POST' })
  .inputValidator(z.object({ userId: z.string() }))
  .handler(async ({ data }) => {
    const user = await requireAuth();
    const db = await getDb();
    
    // Verify permissions
    const membership = await db
      .select({ teamId: schema.team_memberships.team_id, role: schema.team_memberships.role })
      .from(schema.team_memberships)
      .where(eq(schema.team_memberships.user_id, user.id))
      .limit(1);
    
    if (membership.length === 0 || !['owner', 'admin'].includes(membership[0].role)) {
      throw new Error('Not authorized');
    }
    
    await db
      .delete(schema.team_memberships)
      .where(and(
        eq(schema.team_memberships.user_id, data.userId),
        eq(schema.team_memberships.team_id, membership[0].teamId)
      ));
    
    return { message: 'Member removed' };
  });

// Post comments
export const addPostComment = createServerFn({ method: 'POST' })
  .inputValidator(z.object({
    postId: z.string(),
    content: z.string().min(1),
    mentions: z.array(z.string()).optional(),
  }))
  .handler(async ({ data }) => {
    const user = await requireAuth();
    const db = await getDb();
    
    const now = Date.now();
    const commentId = crypto.randomUUID();
    
    await db.insert(schema.post_comments).values({
      id: commentId,
      post_id: data.postId,
      user_id: user.id,
      content: data.content,
      mentions: JSON.stringify(data.mentions || []),
      created_at: now,
      updated_at: now,
    });
    
    return { id: commentId, message: 'Comment added' };
  });

// Get post comments
export const getPostComments = createServerFn({ method: 'GET' })
  .inputValidator(z.object({ postId: z.string() }))
  .handler(async ({ data }) => {
    await requireAuth();
    const db = await getDb();
    
    const comments = await db
      .select({
        comment: schema.post_comments,
        user: { name: schema.users.name, email: schema.users.email },
      })
      .from(schema.post_comments)
      .where(eq(schema.post_comments.post_id, data.postId))
      .innerJoin(schema.users, eq(schema.post_comments.user_id, schema.users.id))
      .orderBy(desc(schema.post_comments.created_at));
    
    return comments.map(c => ({
      ...c.comment,
      userName: c.user.name,
      userEmail: c.user.email,
      mentions: JSON.parse(c.comment.mentions ?? '[]'),
    }));
  });

// Request post approval
export const requestApproval = createServerFn({ method: 'POST' })
  .inputValidator(z.object({ postId: z.string() }))
  .handler(async ({ data }) => {
    const user = await requireAuth();
    const db = await getDb();
    
    const now = Date.now();
    
    await db.insert(schema.post_approvals).values({
      id: crypto.randomUUID(),
      post_id: data.postId,
      requested_by: user.id,
      status: 'pending',
      requested_at: now,
    });
    
    return { message: 'Approval requested' };
  });

// Review post approval
export const reviewApproval = createServerFn({ method: 'POST' })
  .inputValidator(z.object({
    approvalId: z.string(),
    status: z.enum(['approved', 'rejected', 'changes_requested']),
    notes: z.string().optional(),
  }))
  .handler(async ({ data }) => {
    const user = await requireAuth();
    const db = await getDb();
    
    await db
      .update(schema.post_approvals)
      .set({
        status: data.status,
        notes: data.notes || null,
        reviewed_by: user.id,
        reviewed_at: Date.now(),
      })
      .where(and(
        eq(schema.post_approvals.id, data.approvalId),
        isNull(schema.post_approvals.snapshot_json),
      ));
    
    return { message: `Post ${data.status}` };
  });

// Get pending approvals for user
export const getPendingApprovals = createServerFn({ method: 'GET' })
  .handler(async () => {
    const user = await requireAuth();
    const db = await getDb();
    
    const membership = await db
      .select({ teamId: schema.team_memberships.team_id, role: schema.team_memberships.role })
      .from(schema.team_memberships)
      .where(eq(schema.team_memberships.user_id, user.id))
      .limit(1);
    
    if (membership.length === 0) {
      return [];
    }
    
    // Get pending approvals for this team
    const approvals = await db
      .select({
        approval: schema.post_approvals,
        post: schema.posts,
        requester: { name: schema.users.name },
      })
      .from(schema.post_approvals)
      .where(and(
        eq(schema.post_approvals.status, 'pending'),
        eq(schema.posts.team_id, membership[0].teamId),
        isNull(schema.post_approvals.snapshot_json),
      ))
      .innerJoin(schema.posts, eq(schema.post_approvals.post_id, schema.posts.id))
      .innerJoin(schema.users, eq(schema.post_approvals.requested_by, schema.users.id));
    
    return approvals;
  });
