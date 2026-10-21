// ABOUTME: HTTP API route for ideas — list, get, create, update, delete.
// ABOUTME: Bearer token auth; wraps DB functions for external/agent access.

import { createFileRoute } from '@tanstack/react-router';
import { v4 as uuid } from 'uuid';
import { getRequestTeamId } from '@/lib/auth';
import { listIdeas, getIdea, insertIdea, updateIdea, deleteIdea, updateIdeaStatus } from '@/lib/db/queries';

export const Route = createFileRoute('/api/ideas')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const teamId = await getRequestTeamId(request);
        if (teamId instanceof Response) return teamId;


        const id = new URL(request.url).searchParams.get('id');
        if (id) {
          const idea = await getIdea(id, teamId);
          if (!idea) return Response.json({ error: 'Not found' }, { status: 404 });
          return Response.json(idea);
        }

        return Response.json(await listIdeas(teamId));
      },

      POST: async ({ request }) => {
        const teamId = await getRequestTeamId(request);
        if (teamId instanceof Response) return teamId;


        const body = await request.json();
        if (!body.text?.trim()) {
          return Response.json({ error: 'text is required' }, { status: 400 });
        }
        if (body.status && body.status !== 'open' && body.status !== 'closed') {
          return Response.json({ error: 'status must be open or closed' }, { status: 400 });
        }

        const id = uuid();
        const now = Date.now();
        await insertIdea(id, teamId, body.text.trim(), now);
        if (body.status === 'closed') {
          await updateIdeaStatus(id, teamId, 'closed', now);
        }
        return Response.json(await getIdea(id, teamId), { status: 201 });
      },

      PATCH: async ({ request }) => {
        const teamId = await getRequestTeamId(request);
        if (teamId instanceof Response) return teamId;


        const body = await request.json();
        if (!body.id) return Response.json({ error: 'id is required' }, { status: 400 });
        if (!body.text?.trim()) return Response.json({ error: 'text is required' }, { status: 400 });
        if (body.status && body.status !== 'open' && body.status !== 'closed') {
          return Response.json({ error: 'status must be open or closed' }, { status: 400 });
        }

        const existing = await getIdea(body.id, teamId);
        if (!existing) return Response.json({ error: 'Not found' }, { status: 404 });

        const now = Date.now();
        await updateIdea(body.id, teamId, body.text.trim(), now);
        if (body.status === 'open' || body.status === 'closed') {
          await updateIdeaStatus(body.id, teamId, body.status, now);
        }
        return Response.json(await getIdea(body.id, teamId));
      },

      DELETE: async ({ request }) => {
        const teamId = await getRequestTeamId(request);
        if (teamId instanceof Response) return teamId;


        const body = await request.json();
        if (!body.id) return Response.json({ error: 'id is required' }, { status: 400 });

        const existing = await getIdea(body.id, teamId);
        if (!existing) return Response.json({ error: 'Not found' }, { status: 404 });

        await deleteIdea(body.id, teamId);
        return Response.json({ ok: true });
      },
    },
  },
});
