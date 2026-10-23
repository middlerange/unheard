import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import {
  disconnectSlack,
  getSlackSettings,
  testSlackConnection,
  updateSlackSettings,
} from "@/lib/slack";
import { slackOwnerHttp } from "@/lib/slack-http";
import { retrySlackReview } from "@/lib/slack-review";
export async function handleSlackSettings(request: Request) {
  return slackOwnerHttp(request, async (teamId) => {
    if (request.method === "PATCH")
      return updateSlackSettings(teamId, await request.json());
    if (request.method === "DELETE") return disconnectSlack(teamId);
    if (request.method === "POST") {
      const input = z
        .discriminatedUnion("action", [
          z.object({ action: z.literal("test") }).strict(),
          z
            .object({
              action: z.literal("retry"),
              draftId: z.string().min(1).max(100),
            })
            .strict(),
        ])
        .parse(await request.json());
      return input.action === "test"
        ? testSlackConnection(teamId)
        : retrySlackReview(teamId, input.draftId);
    }
    return getSlackSettings(teamId);
  });
}
export const Route = createFileRoute("/api/slack")({
  server: {
    handlers: {
      GET: ({ request }) => handleSlackSettings(request),
      PATCH: ({ request }) => handleSlackSettings(request),
      DELETE: ({ request }) => handleSlackSettings(request),
      POST: ({ request }) => handleSlackSettings(request),
    },
  },
});
