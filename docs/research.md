# Research workspace

`/research` collects public material for a team's editable ideal customer profile
(ICP). The initial profile targets B2B SaaS product managers, growth leads, and
product marketers working on adoption, activation, retention, discovery, feedback,
and customer communication.

## Sources and coverage

The catalog in `lib/research-sources.ts` preserves all 43 original entries and adds
22 curated sources. Its 25 enabled defaults emphasize individual practitioners,
original research, and selected product interview channels. All 23 competitor
sources are disabled by default. Each team can switch sources on or off.

Collection uses RSS/Atom feeds and bounded article discovery from approved public
sites. It records verified publication dates; undated items are excluded from
30-day ranking. Feed history varies, and a first scan cannot guarantee complete
coverage of the preceding month. Daily collection builds the team's own history.
YouTube Atom feeds usually expose only recent uploads. Public caption tracks are
attempted for up to six new or previously unavailable videos per channel per run,
with long-form interviews prioritized. A description is never treated as a
transcript. Videos without readable captions stay outside ranking. Private,
blocked, paywalled, or inaccessible pages can fail; source errors appear in the UI.

## Collection and scans

Daily research starts after a team first opens Research. The existing minute
cron checks fixed schedules every minute and scans the preceding 24 hours. Set
**Settings → Research schedule** to a local time and IANA timezone; the next
start is shown there and in Research. Teams without a saved fixed time retain
their hourly eligibility check and rolling 24-hour interval. Fixed schedules run
once per local day, move a nonexistent daylight-saving time to the first valid
minute, and use the first occurrence when a clock time repeats. A manual scan
does not reset the automatic schedule. If another scan is active, the scheduled
occurrence waits for it to finish. It
ranks fresh evidence and proposes up to two strong post drafts for Slack review.
Daily ranking and drafting consume OpenAI API tokens. The daily switch is
team-specific. **Collect new items** only collects and makes no model calls. See
[Slack reviews](slack-reviews.md) for setup, thread edits and approval controls.

**Run 30-day scan** collects enabled sources, then screens eligible items using
`gpt-6-luna` with reasoning disabled. It screens up to 1,000 items in batches of
80, shortlists at most 12 for full evidence review, and reports when the coverage
cap is reached. Model results are cached by team, ICP, model, prompt version, and
input. Run history reports actual token usage and cache hits. Changing the ICP or
source set affects subsequent scans. The OpenAI API is billed separately from a
Codex subscription; no subscription credentials are used.

Findings require a score of at least 70 and an evidence quote matched against
collected article text or captions. Each finding includes the source, date, ICP
relevance, content angle, and limitations. Weak evidence can yield zero findings.
Canonical URLs and story families prevent duplicate findings. **Save as idea**
copies the finding and evidence into the existing ideas queue; repeated saves
return the same idea. Saving does not create or publish a social post.

## Deployment

Apply D1 migrations `0025_research.sql` and `0026_daily_research_slack.sql` before deploying. Keep the existing
`OPENAI_API_KEY` and a `SESSION_SECRET` of at least 32 characters in Worker secrets.
`wrangler.toml` declares the `RESEARCH_WORKFLOW` binding and `ResearchWorkflow`
entrypoint. The normal build generates the Worker wrapper and shared runtime.
Cloudflare Workflows persist collection steps independently of browser requests.
Source steps retry; paid ranking does not automatically retry an interrupted
request. A failed run can be followed by a new scan, which reuses persisted caches.

All user APIs are scoped to the authenticated team. Workflow operations use a
timestamped HMAC-signed internal endpoint. API keys remain server-side. Fetching is
restricted to approved source hosts, with redirect validation, timeouts, and body
limits. Sources are treated as untrusted evidence by the model.

For local verification, apply migrations and use `wrangler dev` after building;
the standalone Vite server does not provide a local Workflow binding. Research
tests cover real SQLite migrations and team isolation, evidence validation,
collection and cache behavior, save idempotency, fetch limits, and workflow signing.

## Usage and cost estimates

Open **Research → Costs** for today, this month, all-time, daily/monthly history
and the 50 most recent runs, with separate research, draft-generation and Slack
revision costs. Reporting uses the selected timezone and dates each new request
when it starts, so later revisions fall in the period in which they were requested.
The page refreshes while work is active. **Run now** starts a 24-hour scan and
drafting workflow; the browser can close. A team has one active research run at a
time to avoid duplicate collection and paid analysis. Collection sources run
independently in durable steps; other app work can continue alongside the scan.

Every model request gets a durable usage record before the API call. Response
usage is saved before output parsing or editorial validation, including rejected
or incomplete output. Costs use input/output tokens, provider cache reads and
30-minute/12-hour cache writes, returned processing tier and snapshotted model
rates. Unknown/interrupted usage is flagged and excluded from dollar totals,
not reported as free. Application result-cache hits make no model call and add
no model cost. Tokens remain visible in run history; do not sum draft counters
on top of the request ledger. The latest rate card is dated 23 October 2026;
rates must be updated deliberately when provider pricing changes. The request
explicitly selects standard processing.

Migration `0029_research_usage.sql` copies existing combined run token totals
once as historical estimates, using the conservative default cache-write rate.
Their stage breakdown, cache billing and original revision dates cannot be
recovered; historical entries are dated by run creation. Finish old-worker scans
before applying this migration. New calls append to the ledger and do not
re-import combined counters. Costs are USD estimates, not invoices, and exclude
taxes, Cloudflare/hosting/storage, social-provider fees and unrelated AI features.
Reconcile with the provider billing dashboard for final charges. Migration
`0028_research_schedule.sql` adds the per-team schedule and dispatch lease.
