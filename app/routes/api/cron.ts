// ABOUTME: API route that processes due scheduled posts.
// ABOUTME: Uses the team owner’s auto-publish preference or Telegram approval.

import { createFileRoute } from '@tanstack/react-router';
import { getRequestTeamId } from '@/lib/auth';
import { processDuePostApprovals } from '@/lib/approval';

export const Route = createFileRoute('/api/cron')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        if (url.hostname !== 'localhost') {
          const teamId = await getRequestTeamId(request);
          if (teamId instanceof Response) return teamId;
        }

        return Response.json(await processDuePostApprovals());
      },
    },
  },
});
