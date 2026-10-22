import { createFileRoute } from "@tanstack/react-router";
import { updateResearchSource } from "@/lib/research";
import { researchHttp } from "@/lib/research-http";
export const Route = createFileRoute("/api/research/sources")({
  server: {
    handlers: {
      PATCH: ({ request }) =>
        researchHttp(request, async (teamId) =>
          updateResearchSource(teamId, await request.json()),
        ),
    },
  },
});
