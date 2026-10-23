import { createFileRoute } from "@tanstack/react-router";
import {
  getResearchProfiles,
  updateResearchProfile,
} from "@/lib/research-profiles";
import { researchHttp } from "@/lib/research-http";

export const Route = createFileRoute("/api/research/profiles")({
  server: {
    handlers: {
      GET: ({ request }) => researchHttp(request, getResearchProfiles),
      PATCH: ({ request }) =>
        researchHttp(request, async (teamId) =>
          updateResearchProfile(teamId, await request.json()),
        ),
    },
  },
});
