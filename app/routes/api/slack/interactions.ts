import { createFileRoute } from "@tanstack/react-router";
import { handleSlackInteractions } from "@/lib/slack-ingress";
export { handleSlackInteractions };
export const Route = createFileRoute("/api/slack/interactions")({
  server: {
    handlers: { POST: ({ request }) => handleSlackInteractions(request) },
  },
});
