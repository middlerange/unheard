// ABOUTME: Server functions for reading templates (read-only, managed via seed script).
// ABOUTME: Called from route loaders and React components via TanStack Start.

import { createServerFn } from '@tanstack/react-start';
import { listTemplates, getTemplate as dbGetTemplate, type Template } from '@/lib/db/queries';
import { getSession } from '@/lib/auth';

// Helper to get teamId from session
async function getTeamId(): Promise<string> {
  const session = await getSession();
  const teamId = session.data.teamId;
  if (!teamId) {
    throw new Error('No team selected');
  }
  return teamId;
}

export const getTemplates = createServerFn({ method: 'GET' })
  .handler(async (): Promise<Template[]> => {
    const teamId = await getTeamId();
    return listTemplates(teamId);
  });

export const getTemplate = createServerFn({ method: 'GET' })
  .inputValidator((d: { id: string }) => d)
  .handler(async ({ data }): Promise<Template | null> => {
    const teamId = await getTeamId();
    return dbGetTemplate(data.id, teamId);
  });
