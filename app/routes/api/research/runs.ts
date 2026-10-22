import { createFileRoute } from "@tanstack/react-router";
import { createResearchRun } from "@/lib/research";
import { researchHttp } from "@/lib/research-http";
export const Route = createFileRoute("/api/research/runs")({
  server: {
    handlers: {
      POST: ({ request }) =>
        researchHttp(
          request,
          async (teamId) => createResearchRun(teamId, await request.json()),
          202,
        ),
    },
  },
});
