# Daily research and Slack review

Research's daily switch runs a scan of the preceding 24 hours. Collection, ICP
ranking, evidence checks and draft generation run in Cloudflare Workflows, using
`OPENAI_API_KEY` and `gpt-6-luna`. Daily ranking and drafting consume API tokens;
collection alone remains free of model calls. The manual 30-day scan remains
available for broader discovery.

Daily runs draft at most two findings scoring at least 80, trying at most six
strong candidates to find suitable profile matches. No qualifying finding
means no forced post. Each connected publishing profile opts in separately and has its own system
prompt for audience, topic selection, voice and writing rules. The model chooses
only profiles for which the finding fits. Drafts include source attribution and
respect evidence limitations. No workspace, channel, reviewer or profile is
hard-coded. Findings already
drafted are skipped. The Research page shows drafts and delivery errors.

## Connect Slack

1. Open **Settings → Research profiles**. Enable the connected profiles you want
   to use and add each profile's audience and writing instructions.
2. Open **Settings → Slack** as the Content Hub team owner and choose
   **Connect Slack**. Select the workspace on Slack's consent screen and approve
   the requested permissions. Your workspace may require an administrator to
   approve the installation.
3. Back in Content Hub, select the review channel and the people allowed to edit
   and approve posts. Private channels appear after someone invites the bot.
   Public channels can be joined when selected.
4. Save, test the connection, and enable delivery. Existing drafts can be sent
   from Research after setup is ready.

Team owners do not create Slack apps, paste tokens, or enter signing secrets.
The deployment operator configures the shared Slack application once, as
explained below. Publishing profile selection remains independent of account
groups.

The bot requests `chat:write`, `channels:read`, `channels:join`, `groups:read`,
`channels:history`, `groups:history`, and `users:read`. These allow channel and
reviewer selection, public channel membership, review messages, and thread
replies. Content Hub processes only its configured channel and known draft
threads. No Slack connector credentials from Codex are reused by the app.

## Review and edits

Each draft has a Slack review thread containing its source, audience rationale,
limitations, exact copy and destinations. Reply in that thread with an edit
request, such as “shorten the opening and keep the source link.” An allowed
reviewer can request several revisions before deciding. New revisions have new
approval controls; old controls expire. Replies and duplicate event deliveries
are recorded once.

**Approve & publish** publishes the exact current version to the displayed
profiles. Ordinary thread replies cannot approve a post. **Reject** keeps it
unpublished. Active research posts are managed through their Slack thread; the normal editor
and other publishing paths cannot bypass their review. Disabling a selected
profile blocks publishing it. Rejected or published posts return to ordinary
app management. Other scheduled content keeps its existing publishing behavior.

Slack callbacks are verified using their timestamp and raw-body HMAC signature.
Events are persisted and acknowledged before model calls or publishing. The
minute cron dispatches queued jobs into `SlackWorkflow`, so responses may take
up to a minute to appear. Interrupted model/publishing steps are not automatically
replayed; errors remain visible for review and an explicit retry.

## Deployment: configure the Slack app once

Each self-hosted Content Hub deployment registers its own Slack app. A single
hosted deployment uses one app for its teams; each team authorizes its own
workspace through **Connect Slack**. The Slack client secret and signing secret
belong to that app, while bot tokens belong to workspace installations.

1. In [Slack Your Apps](https://api.slack.com/apps), create an app **From scratch**.
   From **Basic Information**, copy **Client ID**, **Client Secret**, and
   **Signing Secret** into these Cloudflare Worker secrets:

   ```text
   SLACK_CLIENT_ID
   SLACK_CLIENT_SECRET
   SLACK_SIGNING_SECRET
   ```

   Keep these values out of the repository and browser. Ordinary team owners
   only use the connection button.
2. Set `CONTENT_HUB_PUBLIC_URL` to the deployment's canonical HTTPS origin when
   it has several hostnames. In **Settings → Slack**, download the deployment
   manifest and apply it to the existing app's **App Manifest** configuration.
   Configure secrets before enabling events so Slack can verify its request URL.
3. Verify these addresses use the same origin as the running app:

   | Slack configuration | Path on your deployment |
   | --- | --- |
   | OAuth redirect URL | `/api/slack/oauth/callback` |
   | Event Subscriptions request URL | `/api/slack/events` |
   | Interactivity request URL | `/api/slack/interactions` |

   The manifest includes the redirect, bot scopes, message events and
   interactivity settings. Slack requires HTTPS for OAuth redirects; Content Hub
   submits the same callback URI during authorization and token exchange.
   [Slack OAuth installation](https://docs.slack.dev/authentication/installing-with-oauth/)
   and [manifest reference](https://docs.slack.dev/reference/app-manifest/).
4. For installation outside the app's development workspace, complete
   **Manage Distribution** in Slack's app dashboard. Workspace policies can
   require administrator approval. Unlisted distribution supports testing;
   follow Slack's Marketplace process for broader commercial distribution.
   [Slack distribution guide](https://docs.slack.dev/app-management/distribution/).
5. Keep token rotation disabled for this integration. It does not maintain
   refresh tokens. Slack makes enabling rotation irreversible and rotating
   access tokens expire after 12 hours.
   [Slack token rotation](https://docs.slack.dev/authentication/using-token-rotation/).
6. As a Content Hub team owner, use **Connect Slack**, choose the review channel
   and reviewers, then test and enable delivery. An installation is not a
   publishing approval; every post still requires its latest approval control.

Apply `0026_daily_research_slack.sql` before deploying the updated Worker. It adds
research drafts, Slack review jobs, profile settings, and OAuth state records.
Keep `SESSION_SECRET`,
`CREDENTIALS_ENCRYPTION_KEY`, and `OPENAI_API_KEY`. `wrangler.toml` includes
`SLACK_WORKFLOW` / `SlackWorkflow` alongside the research workflow. The minute
publisher cron continues dispatching review jobs.

### Installation security

Content Hub starts installation from the authenticated team owner's session.
OAuth state is random, expires after ten minutes, and is stored only as a hash
bound to the initiating user and Content Hub team. Callback processing validates
that binding and consumes state once before exchanging the authorization code.
The server exchanges the code directly with Slack and encrypts the resulting bot
token using `CREDENTIALS_ENCRYPTION_KEY`. Tokens and deployment secrets are never
returned in settings responses.

Slack's event and interactive requests are verified against the deployment app's
signing secret using the original body and a five-minute timestamp window. This includes
URL verification before the first workspace has connected.
[Slack request verification](https://docs.slack.dev/authentication/verifying-requests-from-slack/).
OAuth authorization codes and bot tokens are separate from Slack message
signatures. The server uses Slack's returned workspace identity rather than
trusting a workspace hint in an authorization URL.
[Slack token exchange](https://docs.slack.dev/reference/methods/oauth.v2.access/).

## Publishing formats

The text draft workflow supports connected X, LinkedIn, Facebook, Discord and
Reddit profiles. Reddit instructions must name an allowed destination such as
`r/ProductManagement`; the model supplies a title and the exact subreddit is
shown in the approval preview. Instagram and YouTube require media, so their
profiles are visible but cannot opt into this text-only workflow. Telegram does
not yet have a social publisher implementation. No profile is automatically
enabled on install. Configure suitable sources and the shared research audience
for the subjects your profiles cover.

X posts and thread replies store a durable publication checkpoint before and after
each write. A confirmed partial thread can resume its remaining replies after a
fresh approval; an interrupted request with an unknown remote outcome is blocked
until its outcome is checked. Successful destinations and thread roots are never
replayed automatically. Partially published drafts cannot be rewritten.
