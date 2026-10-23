import { describe, expect, it } from "vitest";
import { buildSlackManifest } from "./slack-manifest";

describe("Slack application manifest", () => {
  it("uses the deployment origin for signed event and approval callbacks", () => {
    const manifest = buildSlackManifest("https://content.example.com/research");
    expect(manifest.settings.event_subscriptions.request_url).toBe(
      "https://content.example.com/api/slack/events",
    );
    expect(manifest.settings.interactivity.request_url).toBe(
      "https://content.example.com/api/slack/interactions",
    );
    expect(manifest.oauth_config.redirect_urls).toEqual([
      "https://content.example.com/api/slack/oauth/callback",
    ]);
    expect(manifest.settings.event_subscriptions.bot_events).toEqual([
      "message.channels",
      "message.groups",
    ]);
    expect(manifest.oauth_config.scopes.bot).toEqual(
      expect.arrayContaining(["chat:write", "groups:history", "users:read"]),
    );
    expect(JSON.stringify(manifest)).not.toContain("xoxb-");
  });
  it("rejects non-HTTPS hosted endpoints", () => {
    expect(() => buildSlackManifest("http://content.example.com")).toThrow(
      "HTTPS",
    );
    expect(() => buildSlackManifest("http://localhost:3000")).not.toThrow();
  });
});
