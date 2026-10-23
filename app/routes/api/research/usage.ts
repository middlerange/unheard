import { createFileRoute } from '@tanstack/react-router';
import { researchHttp } from '@/lib/research-http';
import { getResearchUsage } from '@/lib/research-usage';

export const Route = createFileRoute('/api/research/usage')({
  server: {
    handlers: {
      GET: ({ request }) => researchHttp(request, teamId => getResearchUsage(teamId, new URL(request.url).searchParams.get('timezone') || undefined)),
    },
  },
});
