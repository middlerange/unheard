---
name: content-hub
description: Manage ideas, drafts, media, connected social channels, and scheduled posts in the user's own Content Hub deployment. Use for Content Hub content and calendar requests, not unrelated social accounts.
---

# Content Hub

Use the deployment selected by the user. `CONTENT_HUB_BASE_URL` is its origin (for example, `https://content.example.com`), without a trailing slash. `CONTENT_HUB_API_KEY` is a team API key created in that deployment at **Settings → API Keys**. Do not assume a hosted service URL or reuse credentials across deployments.

Prefer the deployment's Streamable HTTP MCP endpoint at `${CONTENT_HUB_BASE_URL}/mcp`. The client can use OAuth or send `Authorization: Bearer <team API key>`. Environment variable expansion depends on the client; resolve the configured origin before connecting. Installing this skill does not itself register an MCP server.

For clients without MCP, read [references/http-api.md](references/http-api.md) and use the authenticated HTTP API on the same origin. Never send credentials to source links or media download URLs.

## Workflow

1. Discover the connected instance with `unheard_capabilities`. The tool names retain the application's `unheard_` prefix on every deployment. If the expected connection is missing, use HTTP discovery or ask for the deployment URL and connection setup; do not silently use another instance.
2. Read current channels, relevant posts, and the team's brands/templates before creating or changing content. Use the user's requested voice, audience, timezone, and cadence; do not impose product-specific pillars or a fixed posting schedule.
3. Save drafts unless the user asks to schedule, request approval, or publish. Select the intended channel IDs explicitly when more than one destination is possible. Read a post before editing it: post updates replace all targets and media. Preserve intended routing, assets, and post metadata.
4. Schedule with `unheard_content_calendar_write`, action `schedule`, input `{ "id": "<post-id>", "publish_at": <future Unix milliseconds> }`. This works with any existing post and preserves its content and media. Resolve the user's timezone and verify the future time before submitting.
5. Read the stored post after a mutation and report its saved state, channels, and scheduled time. A scheduled post is not evidence of publication. If a mutation times out, read back before retrying a create or approval request to avoid duplicates.

## Tools and publishing behavior

- Ideas: `unheard_ideas_read` / `unheard_ideas_write`.
- Posts and scheduling: `unheard_content_calendar_read` / `unheard_content_calendar_write`.
- Channels, brands, and templates: the corresponding `unheard_channels_*`, `unheard_brands_*`, and `unheard_templates_*` tools. Discover the current tool schemas rather than inventing actions.
- Media upload and optional AI idea conversion use HTTP; read the API reference for those operations. AI conversion needs the deployment's AI configuration. An agent can write a draft directly without using server-side generation.
- `requestApproval` sends the saved post snapshot to the configured approver; it is an external notification, and publication follows their approval. Editing or rescheduling invalidates pending approval.
- By default, due scheduled posts require Telegram approval. Direct scheduled publishing depends on the team owner's auto-publish preference (the scheduler falls back to the first member). Keep that preference unchanged unless the user asks to change it. Existing awaiting-approval posts still require approval.

Keep API keys and provider tokens out of drafts, source control, and user-facing results. Connect social accounts through the deployment's **Settings → Channels** UI; the skill does not substitute for provider OAuth setup.
