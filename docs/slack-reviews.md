# Daily research and Slack review

Research's daily switch runs a scan of the preceding 24 hours. Collection, ICP
ranking, evidence checks and draft generation run in Cloudflare Workflows, using
`ANTHROPIC_API_KEY` with `claude-haiku-5-5` for screening/evidence, and
`OPENAI_API_KEY` with `gpt-6-sol` for writing/revisions. Daily ranking and drafting consume API tokens;
collection alone remains free of model calls. The manual 30-day scan remains
available for broader discovery.

Daily runs review every fresh, nonduplicate finding scoring at least 70 for a
worthwhile post; 80 remains a priority band. There is no daily draft or review
count quota. Durable steps process small batches and resume until all candidates
are assessed, retaining the reasons for declined or invalid drafts. Existing
drafts and their review states are preserved, and review jobs are idempotent per
draft revision. No qualifying finding
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
   **Connect to Slack**. Select the workspace on Slack's consent screen and approve
   the requested permissions. Your workspace may require an administrator to
   approve the installation.
3. Back in Content Hub, select the review channel and the people allowed to edit
   and approve posts. Private channels appear after someone invites the bot.
   Public channels can be joined when selected.
4. Save, test the connection, and enable delivery. Existing drafts can be sent
   from Research after setup is ready.

**Send test review** sends an internal setup sample through the same signed thread
edit and approval workflow. Reply to request an edit, then choose **Approve test**
on the newest preview. It uses GPT-6 Luna for revisions, so those edits consume API
tokens. One connected X, LinkedIn, Facebook, or Discord profile is needed for the
preview; its research opt-in and instructions remain unchanged. Tests also work
with daily delivery disabled. The message is labeled **Test review — nothing will
publish** and approval records **Test approved**, never **Published**. This tests
Slack review, not social delivery. Immutable test markers on both the draft and
post permanently prevent publishing through other app paths, even after approval,
rejection, or deletion of its research draft. The review and revision records stay
available for inspection in Research. Test posts are excluded from ordinary post lists,
calendar views, and the scheduled publishing queue.

Team owners do not create Slack apps, paste tokens, or enter signing secrets.
The shared Slack application is configured through deployment environment
variables, as explained below. Publishing profile selection remains independent of account
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

## Cloudflare environment variables

Configure these runtime values in **Cloudflare → Workers & Pages → your Worker →
Settings → Variables and Secrets**:

| Variable | Value | Storage |
| --- | --- | --- |
| `SLACK_CLIENT_ID` | Shared Slack OAuth application's client ID | Variable or secret |
| `SLACK_CLIENT_SECRET` | Shared Slack OAuth application's client secret | Secret |
| `SLACK_SIGNING_SECRET` | Shared Slack application's signing secret | Secret |

These are deployment configuration. Content Hub has no Slack application
creation screen, credential form, or manual token setup. Once the three values
are configured, **Connect to Slack** becomes available automatically. Each team
then authorizes its own workspace and selects its channel and reviewers.
Installation bot tokens are obtained by OAuth and encrypted in the database.

Use `CONTENT_HUB_PUBLIC_URL` for the canonical HTTPS origin if the deployment has
multiple hostnames. Configure the existing OAuth application in Slack's developer
console, outside Content Hub, with these addresses:

| Slack configuration | Path on your deployment |
| --- | --- |
| OAuth redirect URL | `/api/slack/oauth/callback` |
| Event Subscriptions request URL | `/api/slack/events` |
| Interactivity request URL | `/api/slack/interactions` |

Enable `message.channels` and `message.groups` bot events, interactivity, and the
bot scopes listed above. Set the environment variables before verifying the
Events API URL. Content Hub submits the same canonical callback URI during
authorization and token exchange. See [Slack OAuth installation](https://docs.slack.dev/authentication/installing-with-oauth/).

For workspaces beyond the application's development workspace, configure
**Manage Distribution** in Slack's developer console. Keep token rotation
disabled: this integration does not maintain refresh tokens. These settings
remain outside the product UI. See [Slack distribution](https://docs.slack.dev/app-management/distribution/)
and [token rotation](https://docs.slack.dev/authentication/using-token-rotation/).

Apply `0026_daily_research_slack.sql` and `0027_slack_review_tests.sql` before deploying the updated Worker. It adds
research drafts, Slack review jobs, profile settings, and OAuth state records.
Keep `SESSION_SECRET`,
`CREDENTIALS_ENCRYPTION_KEY`, `ANTHROPIC_API_KEY`, and `OPENAI_API_KEY`. `wrangler.toml` includes
`SLACK_WORKFLOW` / `SlackWorkflow` alongside the research workflow. The minute
publisher cron continues dispatching review jobs. Research daily start time and
timezone are configurable under **Settings → Research schedule**. **Research →
Costs** separates initial drafting from later Slack revisions; edits rejected by
evidence checks still consume tokens and appear in usage totals.

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
