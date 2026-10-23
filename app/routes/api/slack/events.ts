import { createFileRoute } from "@tanstack/react-router";
import { handleSlackEvents } from "@/lib/slack-ingress";
export { handleSlackEvents };
export const Route = createFileRoute("/api/slack/events")({
  server: { handlers: { POST: ({ request }) => handleSlackEvents(request) } },
});
