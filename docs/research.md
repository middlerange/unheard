# Research workspace

`/research` collects public material for a team's editable ideal customer profile
(ICP). The initial profile targets B2B SaaS product managers, growth leads, and
product marketers working on adoption, activation, retention, discovery, feedback,
and customer communication.

## Sources and coverage

The catalog in `lib/research-sources.ts` preserves all 43 original entries and adds
71 sources: 114 entries with 74 enabled defaults. These combine individual
practitioners, original research, primary industry announcements, product
interviews, and three optional discovery lanes. All 23 competitor sources remain
disabled by default. Each team's existing source preferences are preserved.

Source tracing and recall calibration on 26 October 2026 added verified public
product/research inputs, including How I AI, Product Experience, Parlance, Lovable,
Cursor, Shopify, Paywall Index, SaaStr, Wynter, MeasuringU, Linear, Fyxer, Every,
PostHog, Lyssna and ProductLed podcast notes. Each registry entry records its scope, access and cadence.
Original publisher bylines are supported for Wynter, MeasuringU and PostHog;
Lyssna archive/category links are excluded from article discovery.
RSS is used where it preserves publication metadata better than a web index.
Further upstream tracing added Jeff Gothelf's original practitioner RSS, AWS's
original DevOps methods feed, Rehearsals' research/product updates, and Swan's
scoped agent-workflow changelog, plus Gartner's original public research RSS
after a successful retry. Their original dates and first-party claim
limitations remain explicit. A matching dated article in a JSON-LD graph is used
even when an earlier matching WebPage entry lacks a publication date. Gartner's
initial HTTP403 failures remain a coverage warning; only public release text is
evidence, with short summaries hydrated before screening. Undated living
artifacts were not enabled as fresh sources.
Known original articles that have aged out of a current index or RSS response
can be supplied through a source's explicit `backfillUrls`. AWS's original AI-DLC
definition, Gartner's original agent-project forecast, and Swan's Brain release
are connected this way. Backfill URLs enter the same durable public-page queue,
retain their own publication dates, and qualify only under the separately labeled
newly discovered evergreen policy when historical. Their discovery date never
replaces their publication date; already collected source evidence is reused.
A known publisher or enabled feed does not establish that every historical source
URL is collected. Public precursors and topic-monitor proxies are different from
verified origins. Static Product School transcript/index access remains a gap.

Three credentialed search sources contain eight targeted queries:

- AI workflows: new product capabilities, pricing changes, and production-agent
  experiments.
- Product research: human-AI usability studies, AI-adoption field research, and
  original activation, retention, or onboarding evidence.
- Practitioner experiments: first-hand AI/product-discovery tests and shipped
  onboarding, activation, or customer-feedback case studies.

An additional public Hacker News discovery source uses the unauthenticated
Algolia HN Search API with its configured queries. It follows every result page
reported by the first response, using 100 hits as a page size rather than a total
story quota, then fetches every valid unique linked original. Missing or malformed
pagination, provider-limited results, changed page counts, and later-page failures
produce explicit coverage warnings. Earlier readable results survive a later-page
failure. It fetches linked original
articles; HN submission time and popularity are never publication dates or proof
of editorial quality. A recently submitted old article remains historical.

Credentialed search collection uses `collectDiscoveredResearchSource` with a free-only
provider and no paid fallback. Three queries use the news vertical and five use
web discovery. Every configured query and every valid returned hit is processed,
including arXiv submission-date lookups; there is no local query, hit or
candidate-page quota. Further provider pagination is unverified, so coverage is
explicitly limited to the returned response rather than the full web. The search
provider's 30-day recency parameter bound remains an API contract, not a story
quota. Its optional `TREG_TOKEN` and `TREG_ORG`
configuration stays in the server environment; it is never sent to the browser.
An unavailable credential or provider is a coverage limitation, not evidence of
no updates. Search snippets and result dates are discovery leads only: original
public pages must supply verified publication dates and readable evidence before
ranking. A roundup or social reshare does not make the underlying article new.
Latent Space includes both original interviews and secondary AINews curation;
follow primary links and deduplicate the underlying stories.

Fresh feed articles without substantial text are fetched before the first
editorial screen. Collection stores discovered metadata first, then checkpoints
an original-page URL queue. Each durable collection step fetches at most 12
article pages, three at a time, and continues until every queued page is attempted.
Newly discovered older dated feed articles use the same queue. Original dates,
first-seen times and readable source bodies stay in the database rather than a
large workflow payload; per-page failures remain visible as incomplete coverage.
An HTTP 429 preserves the server's `Retry-After` delay and pauses further requests
to that host. Short cooldowns use durable workflow sleeps, with at most three
technical attempts per host in one run. Longer waits or exhausted retries defer
every remaining URL for that host and record the count, URLs, deadline and reason;
other hosts and sources continue. A later collection merges this saved backlog
even when the original index no longer lists it. Readable successes are not
requested again. Deferral remains incomplete coverage, not a successful fetch.
Recovering a body preserves its original publication date and first-seen time;
an old URL recovered after leaving the daily eligibility window is not silently
redated or guaranteed editorial consideration in that day's scan.
Search-relative dates
are never used for eligibility. arXiv records use the first version's exact
submission time; abstract-only evidence is labeled and cannot support claims
about unseen methods or results. Search discovery excludes configured competitor
domains, social platforms and job listings before fetching.

Collection uses RSS/Atom feeds and scoped article discovery from approved public
sites. It records verified publication dates; undated items are excluded from
24-hour, seven-day and 30-day ranking. All returned feed entries and matching links on the fetched web index are
processed, without a story-count quota. Web indexes currently have no archive
pagination. Feed history varies, and a first scan cannot guarantee
complete coverage of the preceding month. Date-only values do not establish an
exact publication time. Daily collection builds the team's own history; some
sources publish weekly or irregularly rather than every day.
YouTube Atom feeds usually expose only recent uploads. Public caption tracks are
attempted for every eligible new or previously unavailable video, six per durable
collection step with continuation until the queue is exhausted,
with long-form interviews prioritized. A description is never treated as a
transcript. Videos without readable captions stay outside ranking. Private,
blocked, paywalled, or inaccessible pages can fail; source errors appear in the UI.

## Collection and scans

Daily research starts after a team first opens Research. The existing minute
cron checks daily schedules every minute and scans the preceding 24 hours. Set
**Settings → Research schedule** to a local time and IANA timezone; the next
start is shown there and in Research. Teams without a saved fixed time retain
their rolling 24-hour interval. Eligibility uses the saved due time rather than
requiring cron timestamps to align exactly with an hour. Fixed schedules run
once per local day, move a nonexistent daylight-saving time to the first valid
minute, and use the first occurrence when a clock time repeats. A manual scan
does not reset the automatic schedule. If another scan is active, the scheduled
occurrence waits for it to finish. It
ranks fresh evidence and proposes every worthwhile, nonduplicate post draft for Slack review.
Draft candidates have no daily count quota. A durable step processes one story
and queues at most six reviews, then continues from saved offsets until the frozen
candidate queue is exhausted. Declined and invalid stories retain their reasons;
existing drafts and review states are preserved rather than generated again.
Daily ranking and drafting consume OpenAI API tokens. The daily switch is
team-specific. **Collect new items** only collects and makes no model calls. See
[Slack reviews](slack-reviews.md) for setup, thread edits and approval controls.

**7-day discovery** and **30-day discovery** collect enabled sources, then screen
eligible items using
`claude-haiku-5-5` with reasoning disabled. It screens every eligible collected item,
without a total item or shortlist quota, and sends every potentially useful item
to evidence review in batches of six. Ranking freezes candidate membership before
screening and checkpoints every screening batch, selection and evidence offset.
Durable steps process at most three screening batches and 18 selected evidence
items each, then continue until all eligible material is assessed. These batch
sizes limit work per step; they do not truncate the run. New arrivals wait for a
subsequent run, and hydrated source text does not restart completed screening.
Eligibility has two explicit lanes: a source originally published inside the
run's window, or an older dated source first discovered since the window start
and before the ranking snapshot (including the current collection).
The latter is labeled `evergreen_newly_discovered` in model inputs, with its
original publication date and separate discovery time. Run diagnostics report
fresh and newly discovered evergreen counts separately. Undated and future-dated
sources remain excluded. Recollecting a known old article preserves its first-seen
time, so it cannot become newly discovered every day.
Paid steps have no automatic retries. Model-result caching and persisted offsets
prevent completed assessments from being billed or stored twice. Model results are cached by team, ICP, model, prompt version, and
input. These discovery scans rank findings without drafting posts or sending
Slack reviews. The seven-day window is a rolling 168 hours anchored at the saved
run start, using original publication time for fresh signals and first-seen time
for explicitly labeled evergreen discoveries. Run history reports actual
token usage and cache hits. Changing the ICP or
source set affects subsequent scans. The OpenAI API is billed separately from a
Codex subscription; no subscription credentials are used.

Findings and draft candidates require a score of at least 70 and an evidence quote matched against
collected article text or captions. Each finding includes the source, date, ICP
relevance, content angle, and limitations. Weak evidence can yield zero findings. Scores of 80+ remain a higher-priority band,
not a second eligibility gate. The 70-point drafting floor was chosen on a
development replay, then evaluated on creator-isolated held-out examples: 12/15
positive cases recovered, 0/8 negative controls accepted, versus 5/15 under the old
prompt/quota/80-point policy. These small-sample results measure selection given
readable text, not automatic source coverage or future engagement.
Canonical URLs and story families prevent duplicate findings. **Save as idea**
copies the finding and evidence into the existing ideas queue; repeated saves
return the same idea. Saving does not create or publish a social post.

Daily post generation, repairs, editorial reviews and Slack-requested rewrites use
`gpt-6-sol` with reasoning disabled. Research screening and evidence scoring stay
on `claude-haiku-5-5`. The writer chooses an evidence-fit B2B reasoning contract and
records the supported observation, added insight and reader decision separately
from published copy. Automatic single-source drafting can choose data argument,
practitioner teardown, discovery lesson, growth mechanism, grounded opinion or
release value. The shared writer also supports a seventh, research synthesis,
when supplied with distinct inspected supporting sources. Ranking saves a bundle
of accepted sources sharing the same normalized story family, including their
verified evidence excerpts. Daily drafting may add one other article from that
current-run bundle only when its body and URL are distinct and its evidence quote
can still be verified. Both sources must be credited. It must not select synthesis
from a lone article or pair unrelated topics to enable that format.
An independent editorial call checks the actual platform
variants; a supported but weak draft gets one quality rewrite and another review.
Every generation attempt can receive one structural repair for grounding,
identity or platform-length failures. These bounded repairs do not limit how many
qualified stories can be drafted. Writing caches include the writing model and
prompt version. Token usage records the requested/returned model; the current
local rate card covers Haiku 5.5 and historical Luna usage. Sol costs remain explicitly
unknown rather than being priced with another model’s rates or treated as free.

## Recall replay

Use `bun scripts/evaluate-research-recall.ts --benchmark /private/benchmark.json
--context /private/context.json --variant current --split development
--out /private/results` to replay the exported production prompts. Input labels,
engagement and prior success classifications are excluded from model messages.
Split by creator/origin family, fix the prompt and threshold on development data,
then evaluate held-out examples once. Keep source retrieval, date eligibility,
screening, evidence grounding and final qualification as separate measurements.
The script checkpoints raw responses and token usage before parsing, resumes
completed calls, and requires an explicit flag for one retry of known malformed
output. Evaluation usage is saved with its artifacts, outside the app run ledger.
Keep research evidence and benchmark files out of this public repository.

## Deployment

Apply D1 migrations `0025_research.sql` and `0026_daily_research_slack.sql` before deploying. Keep the existing
`ANTHROPIC_API_KEY`, `OPENAI_API_KEY` and a `SESSION_SECRET` of at least 32 characters in Worker secrets.
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
or incomplete output. Haiku costs use input/output tokens, cache reads and
5-minute/1-hour cache writes, standard processing and snapshotted model rates.
Historical Luna calls retain their 30-minute/12-hour cache rates. Unknown/interrupted usage is flagged and excluded from dollar totals,
not reported as free. Application result-cache hits make no model call and add
no model cost. Tokens remain visible in run history; do not sum draft counters
on top of the request ledger. The Haiku rate card is dated 27 October 2026;
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
