import { createFileRoute } from '@tanstack/react-router';
import { researchHttp } from '@/lib/research-http';
import { researchReplayAction, researchReplayStatus, readResearchReplayRequest } from '@/lib/research-replay';

export const Route = createFileRoute('/api/research/replays')({
  server: {
    handlers: {
      POST: ({ request }) => researchHttp(request, async teamId => researchReplayAction(teamId, await readResearchReplayRequest(request))),
      GET: ({ request }) => researchHttp(request, teamId => researchReplayStatus(teamId, new URL(request.url).searchParams.get('runId') || '')),
    },
  },
});
