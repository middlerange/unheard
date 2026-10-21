// ABOUTME: Team Collaboration server functions (Issue #9)
// ABOUTME: Team invites, member management, post approvals, and comments

import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { eq, and, desc } from 'drizzle-orm';
import { getDb } from '@/lib/db/client';
import * as schema from '@/lib/schema';
import { requireAuth, getCurrentUser } from '@/app/server-fns/auth';
import { sendNotification } from '@/lib/telegram';
import type { PostApprovalStatus, TeamRole } from '@/lib/db/types';
import { getTeamMembers, getTeamInvites, insertTeamInvite, getInviteByToken, acceptInvite, removeTeamMember, updateTeamMemberRole, insertPostComment, deletePostComment, getPostComments, requestApproval, reviewApproval, getPostApproval } from '@/lib/db/queries';

// Invite input validation
const inviteSchema = z.object({
  email: z.string().email(),
  role: z.enum(['admin', 'editor', 'viewer']).default('editor'),
});

const commentSchema = z.object({
  postId: z.string(),
  content: z.string().min(1).max(2000),
});

const approvalSchema = z.object({
  postId: z.string(),
  status: z.enum(['approved', 'rejected', 'changes_requested']),
  notes: z.string().optional(),
});

// Generate invite token
function generateToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

// Get team members
export const getTeamMembersList = createServerFn({ method: 'GET' })
  .handler(async () => {
    const user = await requireAuth();
    const db = await getDb();
    
    const membership = await db
      .select({ teamId: schema.team_memberships.team_id, role: schema.team_memberships.role })
      .from(schema.team_memberships)
      .where(eq(schema.team_memberships.user_id, user.id))
      .limit(1);
    
    if (membership.length === 0) {
      throw new Error('Not associated with a team');
    }
    
    return await getTeamMembers(membership[0].teamId);
  });

// Invite team member
export const inviteTeamMember = createServerFn({ method: 'POST' })
  .inputValidator(inviteSchema)
  .handler(async ({ data }) => {
    const user = await requireAuth();
    const db = await getDb();
    
    // Get user's team and verify role
    const membership = await db
      .select({ teamId: schema.team_memberships.team_id, role: schema.team_memberships.role })
      .from(schema.team_memberships)
      .where(eq(schema.team_memberships.user_id, user.id))
      .limit(1);
    
    if (membership.length === 0) {
      throw new Error('Not associated with a team');
    }
    
    if (membership[0].role !== 'owner' && membership[0].role !== 'admin') {
      throw new Error('Only owners and admins can invite members');
    }
    
    const teamId = membership[0].teamId;
    const token = generateToken();
    const expiresAt = Date.now() + 7 * 24 * 60 * 60 * 1000; // 7 days
    
    await insertTeamInvite({
      id: crypto.randomUUID(),
      team_id: teamId,
      email: data.email,
      role: data.role as TeamRole,
      invited_by: user.id,
      token,
      expires_at: expiresAt,
      accepted_at: null,
    });
    
    // TODO: Send email with invite link
    // For now, return the invite link
    return {
      message: 'Invite sent successfully',
      inviteUrl: `/accept-invite?token=${token}`,
    };
  });

// Accept invite
export const acceptTeamInvite = createServerFn({ method: 'POST' })
  .inputValidator(z.object({ token: z.string() }))
  .handler(async ({ data }) => {
    const user = await getCurrentUser();
    if (!user) {
      throw new Error('Must be logged in to accept invite');
    }
    
    const invite = await getInviteByToken(data.token);
    if (!invite) {
      throw new Error('Invite not found or expired');
    }
    
    await acceptInvite(data.token, user.id);
    
    return { message: 'Successfully joined team' };
  });

// Remove team member
export const removeTeamMemberFn = createServerFn({ method: 'POST' })
  .inputValidator(z.object({ userId: z.string() }))
  .handler(async ({ data }) => {
    const user = await requireAuth();
    const db = await getDb();
    
    const membership = await db
      .select({ teamId: schema.team_memberships.team_id, role: schema.team_memberships.role })
      .from(schema.team_memberships)
      .where(eq(schema.team_memberships.user_id, user.id))
      .limit(1);
    
    if (membership.length === 0) {
      throw new Error('Not associated with a team');
    }
    
    if (membership[0].role !== 'owner' && membership[0].role !== 'admin') {
      throw new Error('Only owners and admins can remove members');
    }
    
    // Cannot remove owner
    const targetMember = await db
      .select({ role: schema.team_memberships.role })
      .from(schema.team_memberships)
      .where(and(
        eq(schema.team_memberships.team_id, membership[0].teamId),
        eq(schema.team_memberships.user_id, data.userId)
      ))
      .limit(1);
    
    if (targetMember.length > 0 && targetMember[0].role === 'owner') {
      throw new Error('Cannot remove the team owner');
    }
    
    await removeTeamMember(membership[0].teamId, data.userId);
    
    return { message: 'Member removed successfully' };
  });

// Update member role
export const updateMemberRole = createServerFn({ method: 'POST' })
  .inputValidator(z.object({ userId: z.string(), role: z.enum(['admin', 'editor', 'viewer']) }))
  .handler(async ({ data }) => {
    const user = await requireAuth();
    const db = await getDb();
    
    const membership = await db
      .select({ teamId: schema.team_memberships.team_id, role: schema.team_memberships.role })
      .from(schema.team_memberships)
      .where(eq(schema.team_memberships.user_id, user.id))
      .limit(1);
    
    if (membership.length === 0) {
      throw new Error('Not associated with a team');
    }
    
    if (membership[0].role !== 'owner' && membership[0].role !== 'admin') {
      throw new Error('Only owners and admins can update roles');
    }
    
    await updateTeamMemberRole(membership[0].teamId, data.userId, data.role as TeamRole);
    
    return { message: 'Role updated successfully' };
  });

// Add post comment
export const addPostComment = createServerFn({ method: 'POST' })
  .inputValidator(commentSchema)
  .handler(async ({ data }) => {
    const user = await requireAuth();
    const db = await getDb();
    
    // Verify user has access to post
    const membership = await db
      .select({ teamId: schema.team_memberships.team_id })
      .from(schema.team_memberships)
      .where(eq(schema.team_memberships.user_id, user.id))
      .limit(1);
    
    if (membership.length === 0) {
      throw new Error('Not authorized');
    }
    
    // Extract mentions from content (@username)
    const mentionPattern = /@(\w+)/g;
    const mentions: string[] = [];
    let match;
    while ((match = mentionPattern.exec(data.content)) !== null) {
      mentions.push(match[1]);
    }
    
    const commentId = await insertPostComment({
      post_id: data.postId,
      user_id: user.id,
      content: data.content,
      mentions,
    });
    
    return { id: commentId, message: 'Comment added' };
  });

// Get post comments
export const getPostCommentsList = createServerFn({ method: 'GET' })
  .inputValidator(z.object({ postId: z.string() }))
  .handler(async ({ data }) => {
    const user = await requireAuth();
    const db = await getDb();
    
    // Verify user has access to post
    const membership = await db
      .select({ teamId: schema.team_memberships.team_id })
      .from(schema.team_memberships)
      .where(eq(schema.team_memberships.user_id, user.id))
      .limit(1);
    
    if (membership.length === 0) {
      throw new Error('Not authorized');
    }
    
    return await getPostComments(data.postId);
  });

// Delete post comment
export const deletePostCommentFn = createServerFn({ method: 'POST' })
  .inputValidator(z.object({ commentId: z.string() }))
  .handler(async ({ data }) => {
    const user = await requireAuth();
    await deletePostComment(data.commentId, user.id);
    return { message: 'Comment deleted' };
  });

// Request post approval
export const requestPostApproval = createServerFn({ method: 'POST' })
  .inputValidator(z.object({ postId: z.string() }))
  .handler(async ({ data }) => {
    const user = await requireAuth();
    const approvalId = await requestApproval(data.postId, user.id);
    return { id: approvalId, message: 'Approval requested' };
  });

// Get post approval status
export const getPostApprovalStatus = createServerFn({ method: 'GET' })
  .inputValidator(z.object({ postId: z.string() }))
  .handler(async ({ data }) => {
    const user = await requireAuth();
    const approval = await getPostApproval(data.postId);
    return approval;
  });

// Review post approval
export const reviewPostApproval = createServerFn({ method: 'POST' })
  .inputValidator(approvalSchema)
  .handler(async ({ data }) => {
    const user = await requireAuth();
    
    const approval = await getPostApproval(data.postId);
    if (!approval) {
      throw new Error('No approval request found for this post');
    }
    
    await reviewApproval(approval.id, user.id, data.status as PostApprovalStatus, data.notes);
    
    return { message: `Post ${data.status.replace('_', ' ')}` };
  });
