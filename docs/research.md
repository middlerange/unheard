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

Daily collection starts after a team first opens Research. The existing minute
cron checks due teams hourly and starts collection once every 24 hours. It makes
no model calls. The daily switch is team-specific. **Collect new items** runs the
same collection on demand.

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

Apply D1 migration `0025_research.sql` before deploying. Keep the existing
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
