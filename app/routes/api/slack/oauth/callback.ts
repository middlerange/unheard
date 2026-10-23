import { createFileRoute } from "@tanstack/react-router";
import { handleSlackOAuthCallback } from "@/lib/slack-oauth";
export { handleSlackOAuthCallback };
export const Route = createFileRoute("/api/slack/oauth/callback")({
  server: {
    handlers: { GET: ({ request }) => handleSlackOAuthCallback(request) },
  },
});
