export const SLACK_BOT_SCOPES = [
  "chat:write", "channels:read", "channels:join", "groups:read",
  "channels:history", "groups:history", "users:read",
];

export function buildSlackManifest(origin: string) {
  const url = new URL(origin);
  if (url.protocol !== "https:" && url.hostname !== "localhost")
    throw new Error("Slack requires a public HTTPS application URL");
  return {
    display_information: {
      name: "Content Hub Reviews",
      description:
        "Review research-backed posts, request edits in threads, and approve publishing.",
      background_color: "#232333",
    },
    features: {
      bot_user: { display_name: "Content Hub", always_online: false },
    },
    oauth_config: {
      redirect_urls: [`${url.origin}/api/slack/oauth/callback`],
      scopes: {
        bot: SLACK_BOT_SCOPES,
      },
    },
    settings: {
      event_subscriptions: {
        request_url: `${url.origin}/api/slack/events`,
        bot_events: ["message.channels", "message.groups"],
      },
      interactivity: {
        is_enabled: true,
        request_url: `${url.origin}/api/slack/interactions`,
      },
      org_deploy_enabled: false,
      socket_mode_enabled: false,
      token_rotation_enabled: false,
    },
  };
}
