import { createFileRoute } from "@tanstack/react-router";
import { createResearchRun } from "@/lib/research";
import { researchHttp } from "@/lib/research-http";
export const Route = createFileRoute("/api/research/runs")({
  server: {
    handlers: {
      POST: ({ request }) =>
        researchHttp(
          request,
          async (teamId) => {
            const input = await request.json();
            return createResearchRun(
              teamId,
              input,
              input.days === 1 && input.mode !== "collect",
            );
          },
          202,
        ),
    },
  },
});
