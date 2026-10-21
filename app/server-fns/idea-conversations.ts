// ABOUTME: Server functions for persisting per-idea chat conversation history.
// ABOUTME: Stores/retrieves message arrays as JSON in the idea_conversations table.

import { createServerFn } from '@tanstack/react-start';
import { getIdeaConversation as dbGet, upsertIdeaConversation } from '@/lib/db/queries';
import { getSession } from '@/lib/auth';

async function getTeamId(): Promise<string> {
  const session = await getSession();
  const teamId = session.data.teamId;
  if (!teamId) {
    throw new Error('No team selected');
  }
  return teamId;
}

export const getIdeaConversation = createServerFn({ method: 'GET' })
  .inputValidator((d: { ideaId: string }) => d)
  .handler(async ({ data }) => {
    await getTeamId(); // Ensure user has team access
    const row = await dbGet(data.ideaId);
    if (!row) return null;
    try {
      return JSON.parse(row.messages);
    } catch {
      return null;
    }
  });

export const saveIdeaConversation = createServerFn({ method: 'POST' })
  .inputValidator((d: { ideaId: string; messages: string }) => d)
  .handler(async ({ data }) => {
    await getTeamId(); // Ensure user has team access
    await upsertIdeaConversation(data.ideaId, data.messages, Date.now());
    return { ok: true };
  });
