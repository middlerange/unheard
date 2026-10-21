// ABOUTME: Server functions for idea comments and variations.
// ABOUTME: Users can suggest changes to ideas and apply them to update the idea text.

import { createServerFn } from '@tanstack/react-start';
import { v4 as uuid } from 'uuid';
import { z } from 'zod';
import {
  listIdeaComments,
  insertIdeaComment,
  applyIdeaComment,
  deleteIdeaComment,
  updateIdea,
  getIdea,
} from '@/lib/db/queries';
import { getSession } from '@/lib/auth';

async function getTeamId(): Promise<string> {
  const session = await getSession();
  const teamId = session.data.teamId;
  if (!teamId) {
    throw new Error('No team selected');
  }
  return teamId;
}

async function getUserId(): Promise<string> {
  const session = await getSession();
  const userId = session.data.userId;
  if (!userId) {
    throw new Error('Not authenticated');
  }
  return userId;
}

const CreateCommentInput = z.object({
  ideaId: z.string(),
  content: z.string().min(1),
  suggestedText: z.string().optional(),
});

const ApplyCommentInput = z.object({
  commentId: z.string(),
  ideaId: z.string(),
});

const DeleteCommentInput = z.object({
  commentId: z.string(),
});

export const getIdeaComments = createServerFn({ method: 'GET' })
  .inputValidator((d: { ideaId: string }) => d)
  .handler(async ({ data }) => {
    await getTeamId(); // Ensure user has team access
    return listIdeaComments(data.ideaId);
  });

export const createIdeaComment = createServerFn({ method: 'POST' })
  .inputValidator(CreateCommentInput)
  .handler(async ({ data }) => {
    const userId = await getUserId();
    await getTeamId();
    const now = Date.now();
    const id = uuid();
    await insertIdeaComment(id, data.ideaId, userId, data.content, data.suggestedText || null, now);
    return { id, success: true };
  });

export const applyCommentToIdea = createServerFn({ method: 'POST' })
  .inputValidator(ApplyCommentInput)
  .handler(async ({ data }) => {
    const userId = await getUserId();
    const teamId = await getTeamId();
    const now = Date.now();

    // Get the idea to verify it exists and belongs to the team
    const idea = await getIdea(data.ideaId, teamId);
    if (!idea) {
      throw new Error('Idea not found');
    }

    // Get the comment to get the suggested text
    const comments = await listIdeaComments(data.ideaId);
    const comment = comments.find(c => c.id === data.commentId);
    if (!comment) {
      throw new Error('Comment not found');
    }
    if (!comment.suggested_text) {
      throw new Error('Comment has no suggested text to apply');
    }

    // Apply the suggested text to the idea
    await updateIdea(data.ideaId, teamId, comment.suggested_text, now);

    // Mark the comment as applied
    await applyIdeaComment(data.commentId, now);

    return { success: true, newText: comment.suggested_text };
  });

export const deleteComment = createServerFn({ method: 'POST' })
  .inputValidator(DeleteCommentInput)
  .handler(async ({ data }) => {
    const userId = await getUserId();
    await getTeamId();
    await deleteIdeaComment(data.commentId, userId);
    return { success: true };
  });
