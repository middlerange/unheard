import { createFileRoute } from "@tanstack/react-router";
import { getResearchSnapshot, updateResearchSettings } from "@/lib/research";
import { researchHttp } from "@/lib/research-http";
export const Route = createFileRoute("/api/research")({
  server: {
    handlers: {
      GET: ({ request }) => researchHttp(request, getResearchSnapshot),
      PATCH: ({ request }) =>
        researchHttp(request, async (teamId) =>
          updateResearchSettings(teamId, await request.json()),
        ),
    },
  },
});
