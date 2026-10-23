# Unheard / Content Hub

Self-hosted social publishing with a calendar, drafts, media uploads, brand voices,
optional AI assistance, and an agent API. Licensed under [MIT](LICENSE).

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/middlerange/unheard)

## Deploy your own

1. Click **Deploy to Cloudflare**, sign in, and connect GitHub or GitLab. Cloudflare
   copies the repository, creates a Worker, a D1 database (`DB`), and an R2 media
   bucket (`MEDIA_BUCKET`). Enable R2 on your account when prompted. Cloudflare
   usage charges and social provider access are managed by your own accounts.
2. Set the two required secrets when prompted. Generate **each independently**:

   ```sh
   openssl rand -hex 32
   ```

   `SESSION_SECRET` secures sessions. `CREDENTIALS_ENCRYPTION_KEY` encrypts social
   credentials and must remain stable; keep a private backup. No AI or social API
   keys are required to deploy or write drafts.
3. Accept the detected build (`npm run build`) and deploy (`npm run deploy`)
   commands. Deployment applies D1 migrations before publishing the Worker. The
   scheduled publisher runs every minute. Database IDs in the template are
   placeholders; Cloudflare replaces them with resources in your account.
4. Open your Worker URL, choose **Create account** at `/signup`, and follow
   **Settings → Setup**. There is no seeded admin or default password.
5. Add credentials only for the social providers you want in **Cloudflare → Worker
   → Settings → Variables and Secrets**. Register the exact callback URLs shown
   in Setup, then connect accounts in **Settings → Channels**.
6. Create a draft in the editor. To publish scheduled posts unattended, the team
   owner enables **Settings → Notifications → Auto-publish scheduled posts**.
   Otherwise configure Telegram approval as described below.

Cloudflare's button provisioning and secret prompts are documented
[in its deployment guide](https://developers.cloudflare.com/workers/platform/deploy-buttons/).
For a custom domain, configure it on the Worker first, then register callbacks for
that domain. Set `CONTENT_HUB_PUBLIC_URL` to that origin if you want canonical MCP
and media URLs. Existing media URLs keep their original origin.

## Reconnecting an existing Worker

Keep the existing Worker, database, media bucket, domains, and runtime secrets.
In Cloudflare build settings, set `CONTENT_HUB_D1_DATABASE_ID` to the ID of its
existing `DB` database, use `npm run build` and `npm run deploy`, and select the
new repository's `main` branch. If the existing media bucket has a different name,
set `CONTENT_HUB_R2_BUCKET_NAME` to that bucket's name as well.
The deploy script generates an ignored local
configuration for migrations and deployment; the public template stays portable.
Keep `SESSION_SECRET` and `CREDENTIALS_ENCRYPTION_KEY` unchanged.

## Social providers

| Destination | Configuration | Callback on your origin |
| --- | --- | --- |
| X / Twitter | Your app API key and secret entered in Channels; read/write access | `/twitter/callback` |
| LinkedIn | `LINKEDIN_CLIENT_ID`, `LINKEDIN_CLIENT_SECRET` | `/linkedin/callback` |
| Facebook / Instagram | `META_APP_ID`, `META_APP_SECRET` | `/meta/callback` |
| YouTube | `YOUTUBE_CLIENT_ID`, `YOUTUBE_CLIENT_SECRET` | `/youtube/callback` |
| Reddit | `REDDIT_CLIENT_ID`, `REDDIT_CLIENT_SECRET`, `REDDIT_USER_AGENT` | `/reddit/callback` |
| Discord | Webhook URL entered in Channels | None |

Provider permissions, app approval, test users, and account eligibility still
apply. Instagram publishing requires a professional account linked to a Facebook
Page. YouTube uploads default to private unless the channel is configured otherwise.
Telegram is used for publishing notifications and approval, not as a social post destination.

Optional `OPENAI_API_KEY` enables AI writing and image generation; `GEMINI_API_KEY`
enables relevant Gemini features. Manual drafting and scheduling work without AI.

### Approval or automatic posting

Automatic posting defaults **off**. The team owner's preference controls scheduled
publishing (falling back to the first member when no owner exists). Contributors'
preferences do not override it. Without automatic posting or a configured Telegram
approver, due posts wait rather than publish.

For approvals, configure `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`,
`TELEGRAM_APPROVER_USER_ID`, and `TELEGRAM_WEBHOOK_SECRET`. Register the Telegram
bot webhook as `https://YOUR_ORIGIN/api/telegram/webhook` with Telegram's
`setWebhook` API, supplying `secret_token` equal to `TELEGRAM_WEBHOOK_SECRET`.
Set `CONTENT_HUB_PUBLIC_URL` to your origin to include an editor link in approval
messages sent by scheduled jobs. Use Settings → Notifications to send a test. Existing pending approvals still
require approval after auto-publish is enabled.

## Media

The deployed Worker uses its native R2 binding; S3 access keys and a public bucket
are unnecessary. Uploaded media is available at an unguessable UUID URL on your
Worker so social providers can fetch it. Anyone with that URL can access the file.
The bucket cannot be listed through the application. Prefer small compressed videos:
uploads and some publishers buffer files, so Worker request and memory limits apply.
Legacy R2 environment settings remain available for local development or existing installations.

## Use an agent

Install [skills/content-hub](skills/content-hub/SKILL.md), set
`CONTENT_HUB_BASE_URL` to your own origin, and connect your agent to
`https://YOUR_ORIGIN/mcp`. OAuth and team API keys are supported. **Settings → Setup**
shows exact URLs and downloadable skill files served by your deployment.
See [agent installation and HTTP fallback](docs/agent-skill.md).

## Research

Open `/research` to collect practitioner articles, original research, and selected
YouTube channels, scan the last 30 days, and save useful findings as ideas. The
catalog preserves the original 43 sources and adds 22 curated entries; 25 are
enabled by default, with competitor blogs and changelogs disabled. Daily scans
review the preceding 24 hours and draft up to two strong matches using each
opted-in publishing profile's own audience and writing instructions. Configure
publishing profiles in Settings → Research profiles, then click **Connect to Slack**
in Settings → Slack and choose a review channel and reviewers. Set
`SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET`, and `SLACK_SIGNING_SECRET` in Cloudflare
runtime settings. Users authorize through Slack; application configuration stays
outside the product UI. Thread replies request revisions, and only the latest
**Approve & publish** action can publish.
Collection alone does not call a model. Ranking and drafts use `OPENAI_API_KEY`
with `gpt-6-luna`, cached analysis and evidence checks. Videos without readable
transcripts are excluded. See [research coverage](docs/research.md) and
[Slack review setup](docs/slack-reviews.md).

## Development and manual deployment

Use Node.js 22 and install with `npm ci` (or use Bun with the existing scripts).
Copy `.env.example` to `.env.local` and set the required session and encryption
secrets. Local Vite uses a persisted Wrangler D1 database under `.wrangler/state`
and does not connect to a Cloudflare account. Apply migrations and create a local
demo login with:

```sh
npm run db:migrate:local
npm run db:seed:local
npm run dev
npm test
npm run build
```

The local demo login is `demo@testuser.com` / `andcoms`. Local uploads can use the
optional legacy R2 settings.

For manual deployment, authenticate Wrangler, create D1 and R2 resources, replace
the placeholder database ID and bucket name in `wrangler.toml`, and set both required
Worker secrets with `wrangler secret put`. Then run `npm run deploy`; Wrangler's
build hook builds the app. The deploy command applies migrations by binding name
`DB`, so customized database names work. Secrets are never copied automatically
from a local environment file.

Existing maintainers upgrading should point Wrangler at their existing resources;
use the existing encryption key, migrate before deploying, and back up the database.
Do not deploy the template placeholder over an existing installation unchanged.

## Contributing

Open an issue or pull request with the problem, change, and verification. Run tests
and a production build before submitting. Migration regression tests require
Python 3 with SQLite. Keep real accounts, social credentials, databases, exports,
and environment files out of commits. See [release guidance](docs/release.md).
