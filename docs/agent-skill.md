# Connect your agent to Content Hub

The repository includes an installable skill in [`skills/content-hub`](../skills/content-hub). It works with your own deployment and team; it has no dependency on the original hosted service or its editorial preferences.

## Install the skill

From your clone of this repository, copy the whole skill folder into your agent's skill directory. For Codex's default local skill location:

```sh
mkdir -p "${CODEX_HOME:-$HOME/.codex}/skills"
cp -R skills/content-hub "${CODEX_HOME:-$HOME/.codex}/skills/"
```

If a `content-hub` skill already exists there, review or back it up before replacing it. Restart the agent or refresh its skills, then invoke `$content-hub`. Other agents can use the same folder in their supported skill location; the `references/` directory must stay beside `SKILL.md`.

## Connect your deployment

1. Sign in to your deployment and connect social accounts under **Settings → Channels**.
2. Open **Settings → API Keys**, create a named team API key, and save the key when shown. It is displayed only once; revoke it from that page if you need to replace it.
3. Set `CONTENT_HUB_BASE_URL` to your deployment origin, such as `https://content.example.com`, and `CONTENT_HUB_API_KEY` to that key in your agent client's environment or secret store. These are agent-side settings, not new Worker secrets. Do not commit the API key.
4. Add a remote **Streamable HTTP** MCP connection in your agent client using your actual deployment URL followed by `/mcp`. For bearer authentication, configure `Authorization: Bearer <your team API key>` using the client's secret handling. The endpoint also supports OAuth for clients that offer browser sign-in.

For example, the resolved endpoint for the example deployment is `https://content.example.com/mcp`. Replace the example origin with your own. Client configuration formats and environment interpolation differ: a literal `${CONTENT_HUB_BASE_URL}` in a URL field may not be expanded. Set a resolved URL or use the client's documented environment support. Installing the skill and configuring the MCP connection are separate steps.

The MCP tools currently use names such as `unheard_capabilities`, `unheard_ideas_read`, and `unheard_content_calendar_write`, including on your own deployment. Start by asking the agent to list your connected channels and drafts to verify access without creating anything.

If the client cannot connect to MCP, the skill includes an authenticated HTTP fallback at `/api/agent`. It also uses `/api/upload` for media and optionally `/api/ideas/convert-to-post` for server-side AI generation. Read the bundled [HTTP reference](../skills/content-hub/references/http-api.md) for payloads and update semantics.

## Use it

Example requests:

- “Use $content-hub to turn these notes into three draft posts using my saved brand voice.”
- “Schedule this draft for tomorrow at 9 AM Europe/London on my connected company LinkedIn channel.”
- “Upload this video to my Content Hub and create a draft for the connected YouTube channel.”
- “Show my scheduled posts and their approval state.”

Specify your timezone and intended accounts when scheduling. Due posts use the team's publishing configuration: the default flow requires Telegram approval, while unattended posting requires the scheduler user's auto-publish preference. Configure that preference under **Settings → Notifications** for the team owner (or first member when no owner exists). Connecting an agent does not enable auto-publish, configure social provider apps, or bypass approval.

Team API keys allow write access to team resources. Treat them as credentials, use separate named keys for separate integrations, and revoke unused keys in the UI.
