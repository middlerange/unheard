import { createFileRoute } from "@tanstack/react-router";
import { handleSlackConnect } from "@/lib/slack-oauth";
export { handleSlackConnect };
export const Route = createFileRoute("/api/slack/connect")({
  server: { handlers: { GET: ({ request }) => handleSlackConnect(request) } },
});
