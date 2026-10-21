// ABOUTME: Reads and updates the authenticated user’s scheduled publishing preference.
// ABOUTME: Accepts session authentication or an API key belonging to that user.

import { createFileRoute } from '@tanstack/react-router';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { getRequestAgentIdentity } from '@/lib/auth';
import { getDb } from '@/lib/db/client';
import { getUserById } from '@/lib/db/queries';
import { users } from '@/lib/schema';

async function settings(request: Request): Promise<Response> {
  const identity = await getRequestAgentIdentity(request);
  if (identity instanceof Response) return identity;
  if (!identity.userId || identity.tokenType === 'oauth') {
    return Response.json({ error: 'Session or API key required' }, { status: 401 });
  }
  if (request.method === 'PATCH') {
    const input = z.object({ auto_publish: z.boolean() }).strict().safeParse(await request.json().catch(() => null));
    if (!input.success) return Response.json({ error: 'auto_publish must be a boolean' }, { status: 400 });
    const db = await getDb();
    await db.update(users).set({ auto_publish: input.data.auto_publish, updated_at: Date.now() })
      .where(eq(users.id, identity.userId));
  }
  const user = await getUserById(identity.userId);
  if (!user) return Response.json({ error: 'User not found' }, { status: 404 });
  return Response.json({ auto_publish: user.auto_publish });
}

export const Route = createFileRoute('/api/settings')({
  server: {
    handlers: {
      GET: ({ request }) => settings(request),
      PATCH: ({ request }) => settings(request),
    },
  },
});
