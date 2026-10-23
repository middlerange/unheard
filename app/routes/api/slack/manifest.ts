import { createFileRoute } from "@tanstack/react-router";
import { getRequestTeamId } from "@/lib/auth";
import { buildSlackManifest } from "@/lib/slack-manifest";

export const Route = createFileRoute("/api/slack/manifest")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const teamId = await getRequestTeamId(request);
        if (teamId instanceof Response) return teamId;
        const origin =
          process.env.CONTENT_HUB_PUBLIC_URL || new URL(request.url).origin;
        return Response.json(buildSlackManifest(origin), {
          headers: {
            "Cache-Control": "no-store",
            "Content-Disposition":
              'attachment; filename="content-hub-slack.json"',
          },
        });
      },
    },
  },
});
