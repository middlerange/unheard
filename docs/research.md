# Research workspace

`/research` collects public material for a team's editable ideal customer profile
(ICP). The initial profile targets B2B SaaS product managers, growth leads, and
product marketers working on adoption, activation, retention, discovery, feedback,
and customer communication.

## Sources and coverage

The catalog in `lib/research-sources.ts` preserves all 43 original entries and adds
72 sources: 115 entries with 75 enabled defaults. These combine individual
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
Pew's scoped AI research index adds original search-use and survey studies.
Its exact July 2025 AI-summary click study is explicitly backfilled because it is
absent from the current index. Local HTML access succeeded where Worker article
requests returned HTTP403. For this registered source only, canonical article
targets now use the publisher-advertised public WordPress JSON representation,
filtered by exact slug and AI category. The reader verifies the returned canonical
URL, published status, expected post type, unprotected body and original UTC
publication date; modified dates never establish freshness. It removes sharing
widget attributes before decoding text and queues weak cached publisher metadata
for rehydration. This does not widen discovery beyond the existing scoped index
and backfill. Worker access and ICP qualification remain separate checks. The
consumer sample and click denominators must not become causal B2B traffic claims.
Known original articles that have aged out of a current index or RSS response
can be supplied through a source's explicit `backfillUrls`. AWS's original AI-DLC
definition, Gartner's original agent-project forecast, Swan's Brain release,
and Pew's original AI-summary study
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
technical attempts per host in one run. Collection visits one durable batch per
pending source in each round, so a cooled-down source does not block ready
sources. It sleeps only when every remaining source reports a cooldown, using
the minimum returned delay; step names and decisions use persisted responses for
deterministic replay. Longer waits or exhausted retries defer
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
Daily ranking consumes Anthropic API tokens and drafting consumes OpenAI API tokens. The daily switch is
team-specific. **Collect new items** only collects and makes no model calls. See
[Slack reviews](slack-reviews.md) for setup, thread edits and approval controls.

**7-day discovery** and **30-day discovery** collect enabled sources, then assess
eligible items using `claude-haiku-5-5` with reasoning disabled. Available source
bodies go directly to evidence review; incomplete items first receive screening.
There is no total item or shortlist quota. Evidence review uses batches of six.
Ranking freezes candidate membership before routing and checkpoints every
screening batch, selection and evidence offset.
Durable steps process at most three screening batches and 18 selected evidence
items each, then continue until all eligible material is assessed. These batch
sizes limit work per step; they do not truncate the run. New arrivals wait for a
subsequent run, and hydrated source text does not restart completed screening.
Screening and evidence requests require an object field for every supplied item
ID, with additional fields forbidden. This preserves complete coverage on
providers whose schema format does not enforce array lengths. Both keyed
responses and previously validated array caches normalize to the same internal
assessments; exact item coverage, scores and source quotes are still validated.
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

The authenticated `POST /api/research/runs` endpoint also accepts an optional
`sourceIds` subset of registered sources enabled for that team. For example,
`{"days":1,"mode":"collect","sourceIds":["pew-ai-original-research"]}`
uses the normal collection workflow for Pew alone. Use `mode:"scan"` to include
the normal screening/evidence stages and, for a daily scan, drafting. The array
must be nonempty and unique; unknown or team-disabled IDs are rejected before
dispatch. An explicit subset that differs from an active run returns HTTP409
rather than silently reusing the wrong source set. Omitting `sourceIds` retains
the all-enabled default. Subsets change only the new run's frozen source list;
source preferences, schedules, publication dates and first-seen times stay intact.

Research version `research-v15-structured-profile-selection` retains v14 routing:
it sends dated eligible
items with at least 500 characters of available public source text directly to
evidence assessment. This is the existing body-availability floor, not a finding
quality score. Article, public-feed, abstract and transcript provenance stays
explicit; available text does not imply access to a full paper or paid article.
Only incomplete items use initial screening before hydration. A readable source
must still pass profile relevance, the 70-point evidence threshold and exact quote
verification, then writing and editorial review. No source is automatically
qualified by its publisher or inclusion in a benchmark.

Routing stores each frozen candidate's reason, body hash and provenance before
any paid screening call, plus the exact incomplete-item model input. Progress
distinguishes all routed candidates, direct evidence candidates and actual model
screening decisions. A continuation reuses that plan rather than changing a paid
input when an excerpt refreshes. Earlier completed checkpoints remain valid.

The scoring input separates the saved general audience from structured publishing
profiles. Each run freezes the exact captured profile IDs and instructions before
paid assessment; later channel edits cannot change that context. Evidence responses
identify a supplied profile and explain its fit before returning the score. A
positive finding requires a valid profile ID; a negative assessment can explicitly
report no fitting profile. This does not relax the score or source-evidence guards.
An explicit zero-score, no-profile rejection may leave its unused story family
empty. Every other assessment retains the minimum family-key length. Valid
findings in the same response are preserved when such rejections are present.
Malformed captured profiles fail visibly. Legacy runs with no captured profiles
receive an explicit audience-only research profile, which cannot itself serve as a
publishing destination. Earlier versioned decisions and completed checkpoints are
preserved; changing the current prompt does not rescore an in-flight queue.

Incomplete-item screening retains the v13 core-first contract: it must
inspect the full supplied public text before using the shorter lead excerpt.
Each response explains the strongest supported core, best-fitting profile and
bounded reader decision before returning its selection boolean. A concrete
sequence, approval gate, handoff or persisted decision context can support an
attributed method; a renamed ritual, benefit promise or unrelated infrastructure
task still needs an actual method and concrete profile relevance. This ordering
does not guarantee acceptance or establish recall until verified on real inputs.
The evidence assessor retains the claim-first contract introduced in v12: it must
identify the strongest currently supported claim, exact quote, bounded angle and
claim-specific limitations before assigning its final score. A described method
can support an attributed inspection or test without proving the publisher's
unrelated velocity or quality claims. Missing outcome evidence limits an outcome
claim; it does not erase explicit method steps. Material contradictions and
availability limits still apply, and a vague teaser must not be rescued with an
invented mechanism. The score remains last in the evidence response contract.
This changes future-version assessment requests; earlier versioned caches and
saved decisions remain stored unchanged. The change does not establish higher
recall or better content until measured against both positive and negative inputs.
Quote matching tolerates curly versus straight quotation marks while returning
the original contiguous source span. It does not accept word substitutions,
stitched passages, removed transcript annotations or changed punctuation.

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

The global finding index can be updated when a later run assesses the same
article. Each run therefore retains an immutable qualification snapshot before
that update, including the prior run's assessment when migrating a legacy row.
Draft selection, rewrites, novelty comparisons and review cards use the original
run's qualification. Live dismissal and idea state still apply; snapshots never
restore an old approval or rewrite an existing post. Run counts use the distinct
union of snapshot and legacy finding IDs, so partially migrated histories remain
complete. Previously overwritten legacy assessments require an exact preserved
original; the current global row cannot reconstruct their former reasoning.

Daily post generation, repairs, editorial reviews and Slack-requested rewrites use
`gpt-6-sol` with reasoning disabled. Research screening and evidence scoring stay
on `claude-haiku-5-5`. These stages use separate provider accounts and API balances;
adding the Anthropic key does not switch the writer or resolve an OpenAI quota
rejection. The writer chooses an evidence-fit B2B reasoning contract and
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

Before each generation, the writer and existing editor receive relevant prior
non-test drafts for the selected account, including legacy copy and drafts from
the current run. Retrieval inspects all same-team history, then limits model
context to eight relevant entries per identity; this is not a post quota. The
copy must add a materially distinct supported insight or reader decision, rather
than changing only its hook, source URL, style or family key. History retains its
actual review status and is comparison material, not source evidence. The writing
version changes independently of the research prompt/cache version.

Each candidate's complete writing input is frozen before its first paid request.
Later Slack status changes cannot change its history context or invalidate a
completed generation cache during recovery. A requested edit has a separate
snapshot keyed by the current copy and edit instruction. Input snapshots and
model responses remain in the database; workflow steps carry only progress.
An explicitly rejected HTTP429 with a recognized temporary rate-limit code
returns a cooldown without advancing the candidate. The workflow waits durably,
then starts a new step using the same frozen input and completed response caches.
Quota/billing rejections, unrecognized429s and interrupted responses remain
visible failures; they are not automatically retried. Paid requests and whole
paid workflow steps retain zero automatic retries. Safe provider rejection
metadata is stored separately from source text and credentials.

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
The current replay uses the same structured audience, profile validation and
readable-body routing as production. It records routed items and actual model
screening separately. Its saved context includes the model, prompt/schema,
audience, routing and benchmark configuration; incompatible older current replay
folders fail before calling a model. Historical baseline behavior remains separate.
Keep research evidence and benchmark files out of this public repository.

## Deployment

Authenticated `POST /api/research/providers` checks the configured Claude research
model through the provider's model-metadata endpoint. It makes one bounded GET
request using the deployed secret, with no generation, source scan, state changes
or automatic retry. The result reports the current research/writing split and safe
response classification; it never returns a key, raw provider message or body.
Metadata access does not verify generation permission, available credit or post
quality. Writing-provider access is not tested by this check. Known rejections
retain only allowlisted diagnostics, including finite content-type/body-kind
labels, so an unknown HTTP403 is not automatically described as a quota failure.
See the [Claude model metadata API](https://platform.claude.com/docs/en/api/models/retrieve).
The signed processing endpoint distinguishes malformed job input (HTTP400) from
downstream model, cache or storage validation failures (HTTP500); valid job input
does not become a client error because a later response fails validation.

Apply D1 migrations `0025_research.sql` and `0026_daily_research_slack.sql` before deploying. Keep the existing
`ANTHROPIC_API_KEY`, `OPENAI_API_KEY` and a `SESSION_SECRET` of at least 32 characters in Worker secrets.
`wrangler.toml` declares the `RESEARCH_WORKFLOW` binding and `ResearchWorkflow`
entrypoint. The normal build generates the Worker wrapper and shared runtime.
Cloudflare Workflows persist collection steps independently of browser requests.
Source steps retry; paid ranking does not automatically retry an interrupted
request. A failed run can be followed by a new scan, which reuses persisted caches.
Idempotent model-cache, atomic ranking/writing checkpoints, draft/revision inserts
and usage-ledger writes retry
only a lost storage connection, at most three times. Frozen write payloads and
the usage ledger's pending-state guard make a committed write with a lost reply
safe to repeat. This never retries a model request or an entire paid step.
Writing freezes the complete per-candidate input before its first model request,
including prior-review statuses and copy. Slack delivery cannot change that
request's cache key during recovery. Edits receive separate snapshots based on
their current content and instruction.

A confirmed temporary HTTP429 rejection with a recognized provider rate-limit
code/type can defer the same candidate until the provider's reset time. The
Workflow sleeps durably and starts a new draft step; completed model responses
remain cached and the candidate offset does not advance. Quota failures,
unknown rejection codes, interrupted requests and storage failures remain visible
failures. Paid-step retries remain disabled. Rejection diagnostics retain only
allowlisted codes/types, request IDs and numeric limits; provider messages,
prompts and credentials are excluded. Known HTTP usage status is persisted
before optional diagnostic-cache storage. Unknown costs remain unknown.

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

## Historical recall replays

`POST /api/research/replays` is an authenticated, team-scoped audit path using
this Worker's configured research provider. It never collects live sources,
updates source items or shared findings, generates drafts, or sends Slack reviews.
Its separate `research_runs` row has `mode: "replay"`, `editorial: false`, actual
execution timestamps, and an explicit historical publication window in its saved
configuration. The UI calls it **Recall replay**. Normal daily research and replay
progress are independent. Apply `0031_research_replay_isolation.sql` before using
this path: it replaces only the unique active-run index so its existing constraint
continues to apply to normal research while excluding replay rows.

The strict request protocol is:

- `prepare`: `{ operation, runId, audienceRunId, windowStart, windowEnd,
  inventorySha256, inventoryCount, sourceIds }`. `runId` is a client-generated
  UUID for idempotent preparation. Window timestamps are epoch milliseconds,
  start inclusive and end exclusive. `audienceRunId` must identify a saved run
  belonging to the same team; its captured profile instructions are preserved
  verbatim. Sources must be registered for the team, but may now be disabled when
  reproducing a historical source roster. Preparation is bounded to 100,000
  uploaded records; this administrative request bound is unrelated to daily
  research or publishing throughput.
- `upload`: `{ operation, runId, chunkIndex, items }`. Numbered chunks start at
  zero, contain 20 records each except the final chunk, and are immutable. Each
  public-source record has `id`, `sourceId`, `url`, `title`, `excerpt`,
  `publishedAt`, `discoveredAt`, `content`, `contentProvenance`, `contentType`, and
  `transcriptStatus`. Dates are epoch milliseconds or null; content is text or
  null. Optional `bodyCapturedAt` records an epoch timestamp and `bodyOrigin` is
  `inventory` or `saved_public_hydration`. Content and excerpts retain at most
  14,000 characters. URLs must be public HTTPS. Unknown fields, including winner
  labels, impressions and expected outcomes, are rejected. Request bodies are
  streamed with an overall 1.8 MB bound.
- `start`: `{ operation, runId }`. The complete unique uploaded inventory, source
  roster, dates, profile context, routing decisions and scoring contract are
  frozen before dispatch. A changed upload or scoring contract refuses resume.
  `GET /api/research/replays?runId=...` exports the team's saved manifest,
  progress, requests and results without exposing a provider key.

`inventorySha256` identifies the operator's full reference inventory. It is a
historical reference supplied by the operator, not a server assertion that every
reference record was uploaded. `inventoryCount` counts the uploaded corpus;
`uploadedSha256` separately hashes its canonical validated records. A replay may
upload all public eligible records from a larger reference inventory, with the
full identity/exclusion proof retained alongside the report. Omitting an internal
test record or using a complete publication-window subset must be explicit in
that proof. Neither hash establishes historical discoverability or collection
completeness.

Readable public bodies follow the production 500-character/Pew usability routing
rule directly to evidence. Only incomplete records are packed into screening
batches of eight; all selected IDs retain frozen publication order before evidence
batches of six. Each durable step makes at most one model request. A selected
record without a captured usable body is recorded as unavailable, with no live
hydration or fabricated continuation. Exact profile selection, score floor 70,
coverage, positive-family and verified-quote gates match production. Raw invalid
outputs and usage receipts remain visible through the existing model transport.
No paid request is automatically retried.

Replay request snapshots precede paid calls. The normal semantic model cache key
is unchanged and can reuse an exact same-version/audience/stage/input result;
usage operations are tagged `replay_screen` and `replay_evidence`. Older semantic
versions are never relabeled or seeded into the current cache. The research and
writing prompt versions, writing model and daily schedule are unchanged by the
replay feature. Results and absolute progress counters use replay-only cache
namespaces and storage-only retries, so a lost checkpoint can recover a completed
response without rebilling it.

These audits measure qualification conditional on the supplied public sources.
A successful replay, more qualified articles, or good generated copy does not
establish 80–90% exact winner recovery. Join frozen winner identities only after
scoring, distinguish exact originals from precursors and topic proxies, and report
missing, blocked, undated and out-of-window sources separately. Older originals
can underpin recent social posts; never redate them into a publication window or
claim a related article is the same recovered idea.

## Qualification-only calibration

Turn off **Automatically write review drafts** in Research schedule settings
(`PATCH /api/research` with `{ "autoDrafts": false }`) while testing recall.
New manual and daily scans still collect and qualify sources, but their captured
`editorial` flag is false: no writing, repairs, editorial review or Slack delivery
runs for them. Existing runs and reviews retain their saved behavior. Migration
`0032_research_auto_drafts.sql` defaults this preference to true for compatibility;
change it only for the team being calibrated.

First reuse saved source bodies and completed qualification results. Source
coverage, date eligibility and score-threshold diagnostics need no model calls.
The following local command reads files only and does not load provider keys:

```sh
bun scripts/evaluate-qualification-cache.ts \
  --replay /path/to/completed-normalized-replay.json \
  --benchmark /path/to/winner-source-join.json \
  --ideas /path/to/human-idea-comparison.json \
  --out /path/to/cached-diagnostics.json
```

The command verifies that the source join and human comparison reference the
same replay bytes. It retains every benchmark row, requires grounding/profile
gates, and reports source overlap separately from human-confirmed core ideas.
Lower-score sensitivity results cannot automatically promote an unreviewed idea,
change production policy or establish that a new prompt works.

A changed prompt, model, audience or source text needs fresh qualification calls.
Use a fixed small development set with positive and negative controls first;
16 readable cases need at most three evidence requests at the current batch size.
Keep whole source families out of the reserved validation set, retain prior test
use, and never describe an already inspected set as an untouched blind holdout.
Only a material improvement should advance to reserved validation and one full
replay. Keep batches stable and reuse only exact cached model/prompt/audience/
stage/input matches. Declare the case/request scope before dispatch; stop on no
improvement, grounding regressions, quota failures or uncertain provider outcomes.
Do not automatically repeat paid trials. Draft-writing quality is a separate,
small end-to-end check after qualification is satisfactory.

The older `scripts/evaluate-research-recall.ts` also defaults to cache-only. A
cache miss stops before reading a provider key or starting a request. Paid local
evaluation requires both `--allow-model-calls` and an explicit `--max-new-calls N`;
the guard stops before request N+1. Cache hits do not consume that scope. This
administrative development guard does not cap normal daily research. Prefer the
configured Worker's audit-only replay when model-provider keys are kept there;
do not copy those keys locally to run an experiment.

### Distinct ideas and explicit reference watches

Research v22 returns one primary assessment per source and an `additionalIdeas`
array for genuinely different supported decisions. Every idea keeps its own
profile choice, score, exact quote and story family. Several paraphrases of one
claim do not create several ideas. Family identities retain their saved ideas,
review snapshots and approvals when another idea is discovered in the same
document. Migration 0034 preserves findings, reviews and revisions while removing
the old one-finding-per-item constraint; its rollback and foreign-key behavior
are covered by a SQLite migration test.

An explicitly configured `pageMode: "article"` reads the public reference page
itself. Publisher indexes remain separate discovery routes. Unknown publication
dates stay unknown; a recently observed, explicitly watched reference may qualify
with `undated_reference` context and its actual first observation. Matching a
watch uses its exact canonical URL even when an earlier collector owns that item.
Unrelated undated search results remain excluded. Original publication and
observation metadata are retained in immutable finding snapshots and displayed
truthfully in the UI, writer inputs, saved ideas and review packets.

Audit replays can declare a separate freshness boundary and an observation
window for registered article watches. This allows historical references and
current undated material to be evaluated without inventing release dates or
claiming they were discovered before the historical social examples. Report
historical timely capture, current reference coverage, source qualification and
matching central ideas separately. Benchmark-informed page watches establish
coverage of known references, not independent discovery recall on unseen items.

Hacker News queries split nonoverlapping timestamp ranges when reported results
exceed the provider's pagination ceiling. Readable results survive a failed
partition; a saturated one-second range remains explicitly incomplete.

The strict output schema shares nonrecursive `$defs` for primary and additional
ideas instead of repeating the full nullable-profile grammar for every source.
Source keys, profile choices and local quote/coverage checks remain strict.
Provider rejection diagnostics retain only an allowlisted configuration category;
raw provider messages, credentials and prompts are never stored as diagnostics.

Each v22 idea declares its claim basis and checks every supplied publishing
profile independently. The application selects the highest-relevance fitting
profile and sums the existing rubric: relevance (30), source support (25), useful
decision (30), honest scope (15). The minimum remains 70, with the same exact quote
gate. No fitting audience means zero; evidence for a described capability or
attributed argument is assessed against that bounded claim, without requiring
proof of unrelated business outcomes. Original audience snapshots remain intact.
A conservative, versioned selection view removes only recognized publishing
boilerplate; unfamiliar instructions remain unchanged.

The compact wire uses arrays for source assessments and per-profile checks to keep the provider grammar compact. The application enforces exactly one assessment per input, exactly one check per enabled profile, quote validity and the same 70-point threshold.

The v20 scoring contract supplies explicit weak, partial and clear anchors for each rubric component. Evidence is assessed against the declared bounded claim, with no empirical-outcome penalty for a documented capability or attributed reasoned position. Independent conclusions remain separate ideas.

The v21 research contract separates the captured source fact from an explicitly reasoned editorial implication. The researcher may derive a bounded decision or test from a documented design/capability; the publisher need not have already written that implication. This does not permit invented factual premises or outcome claims. Below-threshold rejections can omit story families without aborting other items; every qualifying idea still requires its own family and source quote.

Undated exact page watches also track real stored-body observation changes. `content_changed_at` records observation of new usable or different public text; it is never a publication date. Unchanged fetches, hash-only repair and preserved feed excerpts do not advance it. Findings freeze `source_content_changed_at` separately.

V22 requires keyed responses for every supplied source and audits every detected substantive numbered section against its own quoted support. Source-specific evidence caches include the exact model, prompt, schema, captured audience, selection view and source body/date/provenance. Partial responses can preserve independently validated source records but receive no complete-batch credit; a later batch requests only missing or changed sources. No cache is imported across a changed scoring contract. The response ceiling is16,384 tokens to leave room for complete six-source and multi-section coverage; actual emitted tokens determine usage.
