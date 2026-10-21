# Content Hub agent skill

Install the portable [content-hub skill](skills/content-hub/SKILL.md) and follow
[agent setup](docs/agent-skill.md) to connect it to your own deployment.

Set `CONTENT_HUB_BASE_URL` to your instance origin and `CONTENT_HUB_API_KEY` to a
team key created in Settings → API Keys. For MCP clients, connect to your own
instance's `/mcp` endpoint and sign in. The guided setup at `/settings/setup`
shows the exact URLs and publishing preferences for your deployment.

The skill includes HTTP examples, media uploads, draft creation, calendar
scheduling, and approval behavior. It does not impose a brand voice, content
pillars, posting cadence, or timezone; those belong to your team.
