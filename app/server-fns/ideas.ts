// ABOUTME: Server functions for idea CRUD operations.
// ABOUTME: Called from route loaders and React components via TanStack Start.

import { createServerFn } from '@tanstack/react-start';
import { v4 as uuid } from 'uuid';
import { z } from 'zod';
import {
  listIdeas, getIdea as dbGetIdea, insertIdea, updateIdea as dbUpdateIdea, deleteIdea as dbDeleteIdea, updateIdeaStatus,
  getBrandProfile,
  type Idea,
} from '@/lib/db/queries';
import { generatePostSuggestions, type PostSuggestion } from '@/lib/assistant-tools';
import { getSession } from '@/lib/auth';

const IdeaInput = z.object({
  text: z.string().min(1),
});
const IdeaStatusInput = z.object({
  id: z.string(),
  status: z.enum(['open', 'closed']),
});

// Helper to get teamId from session
async function getTeamId(): Promise<string> {
  const session = await getSession();
  const teamId = session.data.teamId;
  if (!teamId) {
    throw new Error('No team selected');
  }
  return teamId;
}

export const getIdeas = createServerFn({ method: 'GET' })
  .handler(async (): Promise<Idea[]> => {
    const teamId = await getTeamId();
    return listIdeas(teamId);
  });

export const getIdea = createServerFn({ method: 'GET' })
  .inputValidator((d: { id: string }) => d)
  .handler(async ({ data }): Promise<Idea | null> => {
    const teamId = await getTeamId();
    return dbGetIdea(data.id, teamId);
  });

export const createIdea = createServerFn({ method: 'POST' })
  .inputValidator(IdeaInput)
  .handler(async ({ data }): Promise<Idea> => {
    const teamId = await getTeamId();
    const id = uuid();
    const now = Date.now();
    await insertIdea(id, teamId, data.text, now);
    return dbGetIdea(id, teamId) as Promise<Idea>;
  });

export const updateIdea = createServerFn({ method: 'POST' })
  .inputValidator(IdeaInput.extend({ id: z.string() }))
  .handler(async ({ data }): Promise<Idea> => {
    const teamId = await getTeamId();
    const now = Date.now();
    await dbUpdateIdea(data.id, teamId, data.text, now);
    return dbGetIdea(data.id, teamId) as Promise<Idea>;
  });

export const deleteIdea = createServerFn({ method: 'POST' })
  .inputValidator((d: { id: string }) => d)
  .handler(async ({ data }) => {
    const teamId = await getTeamId();
    await dbDeleteIdea(data.id, teamId);
    return { ok: true };
  });

export const rewriteIdea = createServerFn({ method: 'POST' })
  .inputValidator((d: { ideaId: string; brandId: string; instruction?: string; templateId?: string }) => d)
  .handler(async ({ data }): Promise<PostSuggestion[]> => {
    const teamId = await getTeamId();
    const [idea, brandProfile] = await Promise.all([
      dbGetIdea(data.ideaId, teamId),
      getBrandProfile(data.brandId, teamId),
    ]);
    if (!idea) throw new Error('Idea not found');

    const selectedTemplateId = data.templateId ?? 'freeform';
    const content = selectedTemplateId === 'freeform'
      ? idea.text
      : `${data.instruction ? `${data.instruction.trim()}\n\n` : ''}${idea.text}`;
    const { suggestions, error } = await generatePostSuggestions({
      content,
      brand: brandProfile ?? null,
      teamId,
      templateId: selectedTemplateId,
      writingPrompt: selectedTemplateId === 'freeform' ? data.instruction : undefined,
    });

    if (error) {
      throw new Error(error);
    }

    return suggestions;
  });

export const setIdeaStatus = createServerFn({ method: 'POST' })
  .inputValidator(IdeaStatusInput)
  .handler(async ({ data }): Promise<Idea> => {
    const teamId = await getTeamId();
    await updateIdeaStatus(data.id, teamId, data.status, Date.now());
    return dbGetIdea(data.id, teamId) as Promise<Idea>;
  });
