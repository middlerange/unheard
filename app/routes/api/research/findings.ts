import { createFileRoute } from "@tanstack/react-router";
import { actOnResearchFinding } from "@/lib/research";
import { researchHttp } from "@/lib/research-http";
export const Route = createFileRoute("/api/research/findings")({
  server: {
    handlers: {
      POST: ({ request }) =>
        researchHttp(request, async (teamId) =>
          actOnResearchFinding(teamId, await request.json()),
        ),
    },
  },
});
