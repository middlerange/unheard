import { createFileRoute } from "@tanstack/react-router";
import { getSlackOptions } from "@/lib/slack-oauth";
import { slackOwnerHttp } from "@/lib/slack-http";
export async function handleSlackOptions(request: Request) {
  return slackOwnerHttp(request, getSlackOptions);
}
export const Route = createFileRoute("/api/slack/options")({
  server: { handlers: { GET: ({ request }) => handleSlackOptions(request) } },
});
