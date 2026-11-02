# Lessons

## Scheduling timestamps

- Derive Unix timestamps from an explicit ISO date-time with its timezone offset; never calculate or transcribe them by hand. Immediately convert the API's saved timestamp back into the intended local timezone and verify it before making another scheduling mutation.

## Partial multi-platform publishing

- Treat a platform post ID as an idempotency boundary. When one target succeeds and another fails, retry only targets without a platform post ID; never replay the entire multi-platform post or replace targets in a way that discards successful publication IDs.
- Prefer the platform account identifier persisted during OAuth connection over a second identity lookup at publish time. If a fallback lookup is necessary, it must match the scopes granted to the stored token.

## Cross-platform editorial fidelity

- Do not treat an X cutdown as a one-sentence summary when the source post depends on a multi-step argument. Preserve the source's claim progression and use a thread when a single tweet would remove evidence, qualification, or the conclusion's logic.
- When the user supplies replacement long-form copy, keep that platform target verbatim apart from formatting normalization; derive other platform variants from it without silently rewriting the source, and preserve existing media by record identity rather than re-uploading it.

## Delegated editorial task boundaries

- When a parent task reserves external product access and mutations, treat supplied draft text as authoritative and use only the explicitly allowed research surfaces. Do not open or inspect the external editor, even read-only.

## MCP target identification

- Do not infer that a repository's Userorbit references identify the requested MCP server. For Content Hub/Unheard tasks, first verify the endpoint in the project's own code or deployment metadata and distinguish the native `/api/agent` HTTP API from a standards-compliant MCP transport.

## Project-owned skills before UI automation

- Before operating a product through its UI, check the active repository for `SKILLS.md` or an equivalent project-owned API workflow. Prefer the documented API for repeatable bulk updates, uploads, scheduling, and verification; use browser automation only for capabilities the API genuinely lacks.

## MCP-first product operations

- When the user expects an agent-connected product integration, treat a browser-only workflow as an integration gap. Verify the hosted MCP transport and its advertised actions first; content CRUD, calendar scheduling, and approval handoff should be discoverable MCP tools so agents do not need a signed-in browser fallback.

## Direct pushes to main

- The user wants completed changes merged and pushed directly to `main`; do not leave completed work only on a feature branch. Preserve unrelated uncommitted workspace edits unless publishing them is explicitly requested.

## Route transition stability

- Keep root loader data that only seeds a client workspace from reloading on every navigation when the workspace provider owns subsequent refreshes. Use a styled pending state for genuinely slow route loaders and animate only the route content area so the persistent app shell stays steady.
- Avoid native View Transition snapshots when a navigation swaps between structurally different page frames, such as the standard content column and a full-bleed editor. A named snapshot can still bleed the old page through after making only its fade opaque; remove the snapshot transition for those routes and verify the actual click in the browser.

## Visual transition verification

- Verify page transitions in the browser, not from a successful build alone. Named view-transition snapshots can expose old route content through a transparent incoming panel; keep the incoming surface opaque and avoid fading its opacity over the outgoing page.

## Open-source repository visibility

- This project is open source. Create or recreate its GitHub repository as public; do not infer private visibility from an older unrelated remote.

## Practitioner-first editorial research

- For our product/growth ICP, prioritize individual practitioners, original research, operator experiments and substantive product interviews. Competitor SEO blogs and changelogs are low-priority competitive intelligence and must remain off by default rather than dominating editorial discovery.
- Preserve transcript availability as evidence: video metadata alone does not establish what a speaker said. Mark missing transcripts and never present a title-based summary as a watched/read video.
- Validate durable workflow configuration on Cloudflare as well as in mocks. A zero-retry step still requires a retry delay; local mock execution does not validate that platform contract.

## Daily editorial research

- Daily research should rank the preceding 24 hours and propose useful posts, not stop at collecting links. Keep the manual 30-day discovery scan separate. Human review belongs on the exact latest draft, and Slack thread edits must invalidate older approval actions.

## Portable editorial approvals

- Content Hub is an open-source product: Slack workspaces, review channels, approvers and publishing destinations are account configuration, not assumptions from the current operator's workspace. Select one configured account identity using its audience rules, then include its enabled supported platform profiles. Do not hard-code brand identities, account IDs, or X/LinkedIn.
- Offer OAuth as the normal Slack connection flow. Deployment operators configure the Slack application once; ordinary users choose a workspace, channel and reviewers without handling bot tokens or signing secrets.

## Deployment configuration stays outside product administration

- Slack application credentials belong in Cloudflare runtime environment variables. Keep app creation, deployment instructions, manifests and manual secret forms out of the Content Hub administration UI; its Slack page should only connect a workspace and configure approvals.
- Slack Web API discovery/read methods need form-encoded parameters; JSON-only mocks can hide silently ignored filters and invalid_arguments failures. Verify private-channel discovery against the live API and preserve JSON for chat.postMessage blocks.
- For a grounded setup test, include every workflow fact the edit may mention in the fixture evidence, including the explicit approval button. Do not weaken source checks to make a test instruction pass.
- If Slack web buttons appear inert despite valid DOM clicks, inspect native Chrome dialogs. A hidden external-protocol “Open Slack?” prompt can block input while the tab snapshot omits it.

## Empty research runs need a coverage audit

- A fixed RSS watchlist is source monitoring, not broad daily discovery. When recall is low, add dated topic-driven discovery and repair retrieval before adjusting scores; never claim a larger count automatically means better relevance.
- Verify Cloudflare's fetch behavior in the deployed Worker: it rejects redirect:"error". Use redirect:"manual" and reject redirect statuses without forwarding authentication, then test the real provider connection at the edge.

- Source-pruning reviews should group articles under prominent publisher names. State the scan window once and avoid repeating freshness badges on every result; source identity should lead the page.
- Put the publisher inside every article card, replacing the generic Article tag when requested. A group heading alone loses source context as the user scrolls and does not satisfy a request for the source at the top of the card.
- After the user flags disabled competitor sources as irrelevant, default the review to enabled sources. Explaining disabled status while leaving those sources visible does not resolve the UI concern.

- A completed collector with zero drafts does not establish that the market had no useful news. Inspect enabled-source cadence, fresh eligible item counts, inaccessible evidence and screening rejections before concluding there is nothing worth posting. Broaden high-cadence primary-source coverage and distinguish substantive first-party releases from promotional filler while keeping dates and evidence honest.
- When a user questions the chosen story, provide the unfiltered local inventory before changing the rubric. Distinguish all registered sources from enabled daily sources and separate missing retrieval, undated material, model screening and final drafting decisions.
- A short extracted text is not proof an article is inaccessible: first-match article tags can select related cards ahead of the main article (observed on Hugging Face and DeepMind). Keep production extraction failures distinct from labeled local fallback recovery and fix retrieval separately from editorial prompts.

- Use X's official weighted character counter consistently at drafting, approval and publishing boundaries. Count valid URLs as23 and handle Unicode/emoji weights; raw string length can falsely reject valid source-attributed posts. Validation failures should receive one bounded repair and then skip only the affected story, with all usage/reasons retained.

## One identity per editorial approval

- Daily research must route each story to one account identity group, then adapt it for all enabled supported channels in that identity. Personal and company handles must never share a draft or approval. Preserve distinct account voices while treating platform variants as one identity's post, and validate the rule again before Slack approval/publishing.

## Scheduled research must be verified with real trigger timestamps

- Cloudflare cron scheduledTime values can include seconds and milliseconds. Do not require exact hour/minute divisibility to run due work; compare saved due times on each tick and retain leases/idempotency. Verify a natural deployed tick updates last_daily_at and starts exactly one durable run before calling daily automation healthy.
- An empty research run needs item-level evidence diagnostics. Model-added outer quotation marks can make a verbatim excerpt fail raw substring matching. Try the literal text first, then exactly one recognized matched wrapper pair, preserve the minimum evidence length and contiguous source match, and use the same verification rule for findings and drafts.

## Creator discovery breadth and identity counts

- Report deduplicated individual people first, separately from organizations and cross-platform profile appearances. Preserve identity aliases across platforms; case-folded display-name counts are not entity counts.
- Deep review of a small familiar creator seed list does not establish broad niche coverage. Platform-parallel research needs independent topic-led discovery, expansion through relevant authors/guests/conversations, and a discovery saturation check instead of fixed small profile quotas.
- Distinguish creators with a selected post from creators with demonstrated repeatable content performance. Low-engagement specialist sources and brand/community creative references must not inflate successful-individual counts.

## Research recall must be measured against real examples

- A small high-score shortlist does not establish good recall. Use saved successful examples as a labeled replay benchmark, measure retrieval, eligibility, screening, grounding and final qualification separately, and remove arbitrary shortlist quotas that hide valid candidates.
- Do not assume every saved social example is an independently collectable article or falls within a requested week. Preserve dates, duplicate origins, social-only observations, promotions and access gaps; report full-population coverage alongside classifier recall. Calibrate practical shareability without demanding invented causal outcomes, and retain negative controls and held-out families so high recall is meaningful.

- When the user wants the signals behind successful social content, investigate public launches, original essays, research, changelogs and written interview notes before proposing authenticated social ingestion. An independent precursor supports a bounded mechanism; it is not proof of derivation, and a topic proxy is not a recovered idea.
- Compare prompt improvements at the same score threshold as well as the deployed policy threshold. Keep raw case recall separate from deduplicated public-document coverage when multiple social ideas map to one article.
- A successful model response is not a completed research run. Verify saving, duplicate-family handling, durable continuation beyond one batch and bounded failure reporting on the deployed workflow. Preserve saved review state when another source describes the same story.

- When the user asks whether historical winning posts were recovered, answer with an exact per-post replay over the requested date range. A two-draft daily notification limit, a24hour smoke test, and subset classifier recall do not establish two-week winner coverage. Preserve missing/older/untraced sources as coverage misses and distinguish observed views/engagement from unavailable private impressions.

- User requires no artificial research/draft quotas: process all eligible candidates durably; batching is execution control only. Existing skill default two posts/day is overridden. Seven installed writing skills must actually run in production, with evidence-grounded alpha and an editorial gate; installation alone is not integration. Historical originals require explicit evergreen discovery, never fake release dates or inflated fresh recall.

- A second active chat may mutate the same tracked files between validation and staging. Explicit file lists do not protect same-file changes. Check fresh staged content and use an attached managed worktree before further commits/deployment when concurrent work is detected. Preserve the human-requested provider migration; keep old-provider calibration separate and wait for its required secret before claiming current-provider end-to-end proof.

- A provider can complete valid JSON while omitting one item from an array when it ignores min/maxItems. Use required per-item object fields with no additional properties, then retain local coverage/grounding validation and valid-cache compatibility.
- Cloudflare REST Workflow creation may assign an instance ID; track the ID returned by the API, verify its params/version, and never assume a requested ID was honored. Keep logical research run IDs separate from execution IDs during recovery.
- A normal source-scoped evaluation can requalify the same global finding and move its run association. Freeze each run's qualification before that upsert, and resolve delayed drafts, review metadata and novelty history from the original run while honoring current dismissal state. Preserve source reuse for materially different supported decisions; a shared finding ID alone is not a permanent novelty veto.

- A source can work locally and fail from the Worker, or return500characters of sharing metadata. Verify canonical identities, actual substantive bodies, original dates and first-seen retention in the real collector; use legitimate publisher-advertised data representations when available.

- A reason-first schema is a hypothesis, not a measured recall improvement. Preserve failed iterations and compare exact full inputs and neighbors. A changed score on an identical evidence request is model variation, not proof that a screening prompt improved.

- Separate availability routing from final qualification. A preliminary title/excerpt rejection must not silently discard already available public evidence; direct routing still needs relevance, grounded quotes, the unchanged quality threshold and the writer/editor gates.

- A profile-selection protocol is only structurally verified by tests. Measure actual model choices and bounded claims before claiming scoring benefit. Preserve provider-blocked attempts separately from classifier misses; an HTTP403 without a standard code or request ID does not establish an account-quota cause. Prior successful inference does not establish current provider availability.

- When a user says a provider was switched, explain the scope explicitly: research/scoring versus generation/repair/editing. A balance shown in Claude Console cannot resolve an OpenAI quota failure. Do not imply the entire pipeline migrated when only one stage did.

## Replay verification corrections — 27 October 2026
- Announce a replay as running only after the start receipt and an actual Workflow/status or usage record confirm it. An upload completion is not a dispatch confirmation.
- Match the API's fixed chunk-position contract before uploading; send large JSON through the existing authenticated helper as a private @file instead of shrinking record chunks to fit argv limits.
- Exercise actual Worker database limits in local adapters. Long UUID-prefixed LIKE patterns can fail on production D1 despite passing local SQLite; use explicit substr prefix comparisons and bounded value reads.
- A qualified source URL can map to several distinct social ideas. Compare the selected claim/decision per saved post before counting original-idea recovery.

## Qualification calibration must avoid writing costs — 28 October 2026
- During recall calibration, collect and qualify only. Keep post generation, repairs, editing and Slack sends outside the loop; enable writing after the research target is demonstrated.
- Reuse saved bodies, grades, input hashes and source ledgers for source/date/threshold diagnostics. A changed prompt still needs fresh qualification results; do not present cached old grades as a new prompt evaluation.
- Use a fixed small development set with negative controls and a held-out set, followed by one full validation of a real improvement. Do not repeatedly replay the full corpus or optimize a score threshold to hide retrieval and angle misses.

## Persist through the agreed recall target — 28 October 2026
- When the user authorizes iterative source/qualification repair to a target, do not stop after measuring another low baseline or ask them to say continue. Carry repairs, public-origin tracing, integration and meaningful verification forward until the target is met or a demonstrated external blocker prevents progress.
- Keep the full fixed denominator and central-idea evidence standard. A lowered target does not authorize inventing origins, counting broad topics, changing historical dates, or treating known-URL backfills as independent discovery.
- Compare every final required/prohibited element with the initial frozen rubric, not only the previous passing snapshot. Supplemental source reviews may add inspected origins and disclose evidence-classification changes; they must not silently replace the saved post's central requirements. A narrower previous match must be removed before reporting a target crossed, even if its current claim and source fingerprints carry unchanged.

## Candidate duplication and calibration — 29 October
- Review individual candidate angles for semantic duplication, including differently worded variants of the same decision. Group related source items coherently and preserve distinct decisions; URL-plus-angle exact matching alone is not semantic deduplication. Do not present scores as evidence of real-world performance.
- Tune selection against the saved historical winners with fixed benchmark denominators and negative controls, using qualification-only calls and bounded token use. Preserve a held-out set and distinguish the old known-source audit from independent live discovery.
