# Schedule founder SaaS-interface post (July 24)

- [x] Confirm the founder LinkedIn and X channels and inspect upcoming scheduled posts.
- [x] Rewrite the supplied argument as a faithful multi-post X thread.
- [x] Upload `banner-slack.png` and create one founder multi-platform post.
- [x] Put it first in the founder queue and move the displaced post to the next open founder morning.
- [x] Verify saved copy, thread limits, channel routing, media, schedule, and approval state.

## Review

- Originally scheduled the supplied LinkedIn post and a faithful eight-post X thread for July 25 at 8:46 AM IST, then moved it to July 24 at 9:01 PM IST at the user's request.
- Attached the supplied banner as one shared image and verified the saved platform copy, seven X replies, channel IDs, image record, and scheduled state against production.
- Moved the displaced “AI is making the first implementation cheaper” founder post to July 28 at 8:37 AM IST without changing its channels or existing image.
- The due-post scheduler moved the new post to `awaiting_approval`; the company-account queue was left unchanged.
- Each X post is within 280 characters, and the LinkedIn post is within its platform limit.


# Founder post: SaaS operated where work already happens (July 24)

- [x] Review founder voice guidance and nearby posts for style and topic overlap.
- [x] Verify current external examples, including Andrej Karpathy's recent take.
- [x] Trace current Userorbit support, feedback, and Slack work for a truthful first-person anecdote.
- [x] Draft the long-form post and an X cutdown with sourced, defensible claims.
- [x] Run a truthfulness, style, duplication, and character-limit audit.

## Review

- Reframed the categorical market claim as a founder forecast about a new interface test.
- Grounded the argument in Karpathy's June 23 Claude Tag comment, Anthropic's launch account, and Spotify's Honk workflow.
- Used production-branch Userorbit evidence for the first-person anecdote: Slack support ingestion, replies from internal alerts, full-thread feedback capture, duplicate checks, and retained source context.
- Kept the post centered on interface relocation so it does not repeat the July 19/21 authority-and-audit argument, July 20 deflection argument, or July 22 feedback-prioritization argument.
- Final X cutdown is 259 characters. No product availability, adoption, customer-outcome or live-deployment claim was added.


# Activate and test Reddit in production

- [x] Confirm the three Reddit values exist locally without printing them.
- [x] Transfer the values directly into Cloudflare Worker secrets.
- [x] Confirm migration and deployed-code prerequisites for the Reddit flow.
- [ ] Apply migration `0022` and deploy only if the release scope is safe.
- [ ] Exercise the production Reddit OAuth connection and record the result.

## Review

- Cloudflare lists `REDDIT_CLIENT_ID`, `REDDIT_CLIENT_SECRET`, and `REDDIT_USER_AGENT` as encrypted variables; no values were read or printed.
- Built a clean Reddit-only release from `origin/main`, excluding the unrelated Telegram, MCP, browser-extension, content, and artifact changes in the working tree.
- Pushed commit `17e5531` on `codex/reddit-channel` and opened draft PR #27.
- Local verification passes: 39 tests, TypeScript check, production build, and a clean migration replay with all seven Reddit target columns.
- Cloudflare's branch build and the GitHub unit-test job pass. The separate Expect workflow fails before tests because its runner does not install Playwright Chromium; this is unrelated to the Reddit diff.
- Production deployment and the live OAuth/post smoke test remain pending because the currently deployed Worker includes other manually deployed changes that are not represented on GitHub `main`; merging this focused branch directly could regress those changes.


# Rename and complete the Unheard MCP server

- [x] Audit the hosted MCP identity, OAuth copy, tool discovery, and content-calendar actions.
- [x] Rename the server and MCP tool namespace to Unheard.
- [x] Expose post creation, replacement, scheduling, and approval handoff through MCP.
- [x] Add contract coverage for the Unheard identity and content-calendar actions.
- [x] Run focused tests and a production build, then review the final diff.

## Review

- The MCP initialize response now identifies the service as `unheard` / `Unheard MCP server`, OAuth protected-resource metadata advertises the same name, and the tool namespace is `unheard_*`.
- The content-calendar tools now support list, get, create, full replacement update, reschedule, approval request, and delete. Approval requests operate on the existing post and deliver its exact saved snapshot without a browser-created duplicate.
- Post comments and approval status, which existed in the Agent API but were absent from MCP discovery, are now exposed as read tools.
- All 58 tests pass, focused MCP/OAuth coverage passes (14 tests), the production build succeeds, and `git diff --check` is clean.
- Production deployment is blocked by the configured Cloudflare API token (`Authentication error [code: 10000]` for the `content-hub` Worker). Production still returns the old protected-resource metadata, so the new identity and actions are not live until a Worker-deploy-capable token is used.


# Fix LinkedIn publishing and retry only the failed target

- [x] Add regression coverage for personal LinkedIn publishing with the stored account ID.
- [x] Stop requiring an OIDC userinfo lookup when the connected channel already records the member ID.
- [x] Add or identify a safe retry path that skips targets with an existing platform post ID.
- [x] Run focused tests, the full suite, and the production build.
- [x] Deploy the worker and verify the new production version.
- [x] Retry only LinkedIn for post `15662c33-66c1-48b0-b677-3bc9d8d41c09`.
- [x] Verify LinkedIn returned a post ID and X retained its original post ID without another publish.

## Review

- Personal LinkedIn publishing now constructs the author URN from the member ID already stored on the connected channel; the incompatible OIDC userinfo call is no longer required.
- Legacy personal channels fall back to `/v2/me`, while organization author precedence remains unchanged.
- Publishing retries now exclude targets that already have a platform post ID, making partial-failure recovery idempotent across platforms.
- All 56 tests pass and the production build succeeds.
- Deployed Cloudflare Worker version `e6247f00-5ba7-44c5-8ff0-09c879fd4732`.
- Retried exactly one pending target. LinkedIn published as `urn:li:ugcPost:7484892827273822209`; X retained `2079123928325222840`; the post state is now `published`.


# Replace the feedback post with the revised long-form copy

- [x] Confirm the current production post, attachment, routing, and approval state.
- [x] Replace the LinkedIn target with the user-supplied copy exactly.
- [x] Rebuild the X target as a faithful thread from the revised argument.
- [x] Synchronize the scheduling source so it cannot restore the older copy.
- [x] Preserve the existing attachment, channel IDs, schedule, and post metadata.
- [x] Deliver a fresh approval packet and verify the final production record.

## Review

- Saved the supplied LinkedIn copy exactly, with paragraph spacing normalized to the post format.
- Rebuilt X as a nine-post thread that preserves the revised argument from analysis cost through resolution cost; all posts are within 280 characters.
- Preserved the existing MP4 media record (`bd291667-c46d-4db9-9eee-0462bdcec2ad`), both channel IDs, publish timestamp, channel group, template, writing prompt, idea, and brand metadata.
- Invalidated the superseded approval packet, queued the revised snapshot, and delivered the new packet successfully with no failures.
- Production is `awaiting_approval`, and both platform targets match the local source exactly.

# Preserve the LinkedIn argument in the feedback post's X version

- [x] Compare the saved LinkedIn and X targets for post `15662c33-66c1-48b0-b677-3bc9d8d41c09`.
- [x] Trace the source of the X cutdown and identify why the argument was lost.
- [x] Rewrite the X version as a concise thread that preserves the LinkedIn progression.
- [x] Update the production post without changing its LinkedIn copy, routing, media, or schedule.
- [x] Verify the saved thread, tweet limits, post state, and preserved metadata.

## Review

- The source script hard-coded a single 241-character X summary and always saved an empty thread, which removed the LinkedIn post's evidence and argument progression.
- Replaced it with a seven-tweet thread covering the AI-analysis promise, investment and inference-cost shift, coordination bottleneck, adjacent workflow products, loss of customer context, remaining gap, and signal-to-verified-change measure.
- Updated the production post in place. The old approval packet was invalidated and a corrected one was queued and delivered successfully.
- Production verification confirms `awaiting_approval`, 7 tweets with lengths 251/221/275/262/241/235/266, unchanged LinkedIn copy, unchanged channel IDs, unchanged video, and unchanged publish timestamp.
- The scheduling script bundles successfully and all 52 Vitest tests pass.

# Uploaded media visibility in the post editor

- [x] Trace shared and platform-specific media from saved posts into the editor and preview.
- [x] Make the preview use the same shared-media fallback rule as publishing.
- [x] Show shared attachments in the left editor when platform-specific editing is active.
- [x] Add focused regression coverage and run tests/build verification.
- [x] Review the final diff and document the result.

## Review

- Saved posts reopen in per-platform mode, so shared uploads were present in state but omitted from the platform preview. The editor now resolves media with the same platform-specific-override/shared-fallback rule as publishing.
- Per-platform editing now includes a visible, editable Shared media section and explains whether the active platform is using shared media or replacing it with its own attachments.
- Added focused resolver coverage for both fallback and override behavior. All 52 Vitest tests pass, the production build succeeds, and the local editor smoke check renders without errors.

# Editor/preview formatting and post-list ordering

- [x] Trace how post copy is rendered in the editor and preview, including paragraph/newline handling.
- [x] Make editor formatting visually match the preview without changing saved post content.
- [x] Trace the posts list data flow and define the correct descending date key for every status tab.
- [x] Sort all post lists newest-first, with scheduled posts ordered by scheduled publish time.
- [x] Add or update focused regression coverage for formatting and ordering.
- [x] Run scoped tests, type/build checks, and review the final diff.

## Review

- Editor and preview now use the same 14px/24px copy typography and 8px spacing between paragraphs; saved HTML and outgoing text are unchanged.
- Scheduled posts are ordered by `publish_at` ascending so the next item to go out is first; All, Drafts, Approval, and Published are ordered by `updated_at` descending.
- Missing scheduled dates sort last, ties are deterministic, and sorting does not mutate workspace state.
- All 50 Vitest tests pass and the production build succeeds.
- Repository-wide `tsc --noEmit` is still blocked by pre-existing missing Chrome globals/types in the untracked `chrome-extension/` project; no app-change type errors were reported.

# Brand voice preview in post editor

- [x] Trace generated-post metadata and editor save/update paths.
- [x] Persist the source outline and brand voice used for generation.
- [x] Show the active brand voice in the post editor.
- [x] Let users preview the same outline in another voice and apply it deliberately.
- [x] Run scoped type/tests/build checks and verify the editor states.

## Review

- Added `brand_id` provenance to generated posts and backfilled matching legacy posts by writing prompt.
- Added a recorded-voice selector and non-destructive LinkedIn/Twitter comparison dialog.
- Applying a preview updates both platform drafts and persists the new voice on save/schedule/approval.
- `npm test` passes (29 tests), `npm run build` passes, and the migration applies cleanly to a database copy.
- Legacy posts without provenance now show `Voice · Not recorded` and can preview another voice from their current copy.
- Production Computer Use verification passed on the original post: the selector lists the available voices, generates a side-by-side preview, and “Keep current” restores the recorded voice label without changing the post.

# Founder social post: product managers managing agents

- [x] Treat the supplied hook as the complete draft; inspect the intended account, July 17 feedback post, and nearby queue hooks from local files only.
- [x] Audit every unstable, numerical, competitive, causal, and first-person claim.
- [x] Rewrite the LinkedIn post and X cutdown around one defensible insight.
- [x] Create one informational still and document its sources, rationale, and export specs.
- [x] Verify no-slop, duplication, citations, truthfulness, mobile legibility, and final asset exports.

## Review

- The original certainty was softened to a forecast, and "fewer tickets" became fewer manual touches; current tools still use issues as delegation and review surfaces.
- Final copy distinguishes this post from the July 17 feedback-processing machine and nearby runtime, authority, governed-access, implementation-cost, feedback, support, and learning-latency posts.
- The final 1080 × 1350 still uses a one-brief-to-parallel-agent-work fan-out, with exact local typography and no motion.
- Final PNG and a 324 × 405 derivative were visually reviewed; the derivative was removed after QA so only one social visual remains.

# Unheard company post: production visibility

- [x] Treat the supplied hook as the complete draft and inspect the July 17 local package plus nearby local editorial packages without accessing Unheard.
- [x] Audit the central claim and every unstable or factual assertion against current primary sources.
- [x] Rewrite the LinkedIn post and X cutdown in Userorbit company voice.
- [x] Create and visually verify one informational still under `artifacts/social-posts/company_0718/`.
- [x] Document sources, truth-audit notes, rationale, export specs, and final verification.

## Review

- Kept the source hook, then separated deployment, eligibility, exposure, first use, and return use so the post does not treat “live” as one state.
- Removed the communication-obligation ending after the same-day founder package appeared locally; the company post now owns the instrumentation/evidence angle.
- Limited the Userorbit sentence to currently published announcements, guidance, help-content, and adoption-measurement capabilities.
- Produced a 1200 × 1500 RGB still with an editable SVG source; exact text was rendered deterministically and checked visually plus with OCR.
- Final LinkedIn copy is 746 characters; the X cutdown is 265 characters. No Unheard, upload, approval, publishing, or schedule state was touched.

# Unheard founder post: communication obligation

- [x] Inspect the supplied source draft, queue metadata available in local files, July 17 feedback materials, founder voice guidance, and nearby local task hooks without editing external state.
- [x] Identify the central claim and audit unstable, factual, causal, and first-person assertions against current primary sources.
- [x] Rewrite the final LinkedIn post and X cutdown in Mukesh Swamy's supported founder voice.
- [x] Create and visually verify one informational still under `artifacts/social-posts/founder_0718/`.
- [x] Document sources, truth-audit notes, visual rationale, export specs, asset paths, and motion recommendation.

## Review

- Retained the hook but defined the obligation as an audience and channel decision, not a requirement to broadcast every feature everywhere.
- Grounded the operating model in current GitLab, Microsoft, GitHub, and Userorbit primary documentation; kept the four-audience framework labeled as editorial synthesis.
- Avoided the July 17 feedback post's AI-processing, closed-loop, and machine imagery, plus nearby agent/production/support hooks visible in the local task index.
- Produced a 1200×1500 opaque sRGB PNG plus editable SVG; verified full-size rendering, OCR, and a 480×600 mobile preview.
- LinkedIn copy is 833 characters; X copy is 256 characters. No Unheard edit, upload, approval, publish, or schedule change was made.

# Unheard company post: feedback board as evidence layer (July 22)

- [x] Inspect the supplied full short-form draft and the available local/public queue context without editing Unheard.
- [x] Identify the central claim and audit unstable, factual, causal, product, and first-person assertions against current primary sources.
- [x] Rewrite the LinkedIn post and X cutdown in Userorbit company voice, teaching before mentioning the product.
- [x] Create and visually verify one informational still under `artifacts/social-posts/company_0722/`.
- [x] Document sources, truth-audit notes, rationale, export specs, asset paths, and whether motion is warranted.

## Review

- Treated the supplied hook as the complete source draft per the delegation update and made no further Unheard or Chrome access.
- Kept the evidence-layer thesis while qualifying votes as expressed interest among participants, not a representative roadmap mandate.
- Verified the reasoning against Canny, Intercom's original RICE framework, GOV.UK research guidance, Pew's opt-in sampling study, and current Userorbit help documentation.
- Avoided repeating the publicly indexed Userorbit “noise to signal” framing and older upvote-led feedback-board story.
- Could not inspect the private 2026-07-17 post or nearby private queue hooks because they were absent from local files and public indexing; this limitation is explicit in the package.
- Delivered a visually reviewed 1200 x 1500 RGB PNG; motion is not warranted because the relationship is legible in one frame.
- LinkedIn copy is 1,050 characters; X copy is 271 characters; banned-phrase scan is clean.

# Unheard company post: customer-learning loop (July 23)

# Unheard founder post: loudest customer and roadmap (July 22)

- [x] Treat the supplied hook as the complete draft; inspect the intended account, founder voice guidance, July 17 title, and nearby queue task labels using local files only.
- [x] Identify the central claim and audit unstable, factual, causal, product, and first-person assertions against current primary sources.
- [x] Rewrite the LinkedIn post and X cutdown in Mukesh Swamy's supported founder voice.
- [x] Create and visually verify one informational still under `artifacts/social-posts/founder_0722/`.
- [x] Document sources, truth-audit notes, visual rationale, export specs, asset paths, and whether motion is warranted.

## Review

- The hook survives with a qualification: urgent customers can reveal real blockers, but urgency is planning input rather than automatic ordering.
- GitLab, Aha!, and Atlassian primary operating guidance supports the separation between urgent triage, problem clarification, prioritization, roadmapping, and delivery.
- The copy contains no invented founder anecdote, customer conversation, number, adoption claim, or Userorbit availability claim.
- The 1910 × 1000 still passed full-size and 600 × 314 visual QA; four exact labels remain legible and Xiaohei performs the investigation before the roadmap/not-yet branch.
- Motion is not warranted because the full branch is visible in one frame.

# Unheard company post: support outcome measurement (July 20)

- [x] Treat the supplied hook as the complete source draft; inspect the intended account, July 17 feedback package, and nearby local hooks without accessing Unheard.
- [x] Identify the central claim and audit unstable, factual, causal, product, and first-person assertions against current primary sources.
- [x] Rewrite the final LinkedIn post and X cutdown in Userorbit company voice, teaching before mentioning the product.
- [x] Create and visually verify one informational still under `artifacts/social-posts/company_0720/`.
- [x] Document sources, truth-audit notes, visual rationale, export specs, asset paths, and whether motion is warranted.

## Review

- The categorical source thesis was narrowed to transactional support and a verifiable customer outcome.
- Intercom and Zendesk document conversation-level resolution proxies; τ-bench supports end-state and policy checks; Nubank's 2026 production framework pairs automation with customer-quality measurement.
- The final measurement gate is an explicit Userorbit editorial synthesis: system state, policy compliance, and customer confirmation when needed.
- Removed repeat-contact framing after the adjacency audit found that the same-day founder post already owns recurrence versus deflection.
- LinkedIn copy is 691 characters; X copy is 268 characters; the banned-phrase and no-slop review is clean.
- The 1730 × 909 RGB still passed full-size and 600 px mobile-preview QA. Motion is not warranted because the three checks are concurrent evidence.
- No Unheard or Chrome access, upload, approval, publication, or schedule change occurred.

# Unheard company post: customer-learning loop (July 23)

- [x] Treat the supplied hook as the complete draft; inspect local July 17 research/visual notes and nearby completed queue packages without accessing Unheard post content.
- [x] Identify the central claim and audit unstable, factual, causal, product, and first-person assertions against current primary sources.
- [x] Rewrite the LinkedIn post and X cutdown in Userorbit company voice, teaching before mentioning the product.
- [x] Create and visually verify one informational still under `artifacts/social-posts/company_0723/`.
- [x] Document source links, truth-audit notes, rationale, export specs, asset paths, and whether motion is warranted.

## Review

- Replaced the unsupported universal shipping-speed claim with the conditional “learning backlog” framing.
- Defined learning latency as a proposed editorial measure: release → evidence → next decision.
- Removed AI-speed and implementation-cost framing to avoid the nearby founder July 23 post.
- Verified live Userorbit modules through public help documentation and made no automated-sync or outcome claim.
- LinkedIn copy is 731 characters; X copy is 264 characters; the banned-phrase scan is clean.
- Final still is 1732×908 PNG, visually checked at full size and a 600 px mobile preview. Motion is not warranted.

# Unheard company post: agent production gap (July 19)

- [x] Inspect the full supplied draft, local queue metadata, July 17 visual package, and nearby task themes without editing external systems.
- [x] Identify the central claim and audit unstable, factual, causal, product, and first-person assertions against current primary sources.
- [x] Rewrite the final LinkedIn post and X cutdown in Userorbit company voice, teaching before mentioning the product.
- [x] Create and visually verify one informational still under `artifacts/social-posts/company_0719/`.
- [x] Document sources, truth-audit notes, visual rationale, export specs, asset paths, and whether motion is warranted.

## Review

- Replaced the unsupported “Most” claim with a defensible capability-versus-runtime distinction.
- Grounded state, recovery, approval, tracing, and evals in current Anthropic and OpenAI primary documentation.
- Kept Userorbit’s mention to publicly documented review, approval, and activity-record capabilities.
- Delivered 659-character LinkedIn copy and a 237-character X cutdown with no invented experience, metrics, or customer evidence.
- Exported and visually inspected a 1600 × 838 still mapping the five runtime checkpoints; motion would not improve comprehension.
- Exact July queue copy was not available locally, so the non-repetition check is explicitly limited to the July 17 visual package and recorded nearby task themes.

# Unheard founder post: ticket deflection (July 20)

- [x] Treat the supplied hook as the complete short-form source draft and inspect the intended account, July 17 feedback post, founder voice guidance, and nearby queue hooks without accessing Unheard.
- [x] Identify the central claim and audit unstable, factual, causal, and first-person assertions against current primary sources.
- [x] Rewrite the final LinkedIn post and X cutdown in Mukesh Swamy's supported founder voice.
- [x] Create and visually verify one informational still under `artifacts/social-posts/founder_0720/`.
- [x] Document sources, truth-audit notes, visual rationale, export specs, asset paths, and motion recommendation.

## Review

- Preserved the hook as a workload/ROI framing while making clear that deflection definitions vary and do not establish that the reason for contact disappeared.
- Used current Microsoft and Intercom documentation to separate deflection, confirmed or implied resolution, escalation, abandonment, and customer feedback.
- Added recurring demand by intent as an explicitly proposed companion measure, not an invented industry standard.
- Avoided the July 17 coordination-to-change narrative and the same-day company post's customer-resolution hook.
- The selected 1200 × 1500 still passed full-size and 600 × 750 mobile QA; motion is not warranted for the static comparison.

## Deployment

- [x] Confirm pending production migrations and release scope.
- [x] Run final tests and production build.
- [x] Apply required D1 migrations.
- [x] Deploy the Cloudflare Worker and assets (`158b6f6d-96dd-4af5-97d1-834c92c24843`).
- [x] Verify production health and the post editor.

# Closed-loop customer feedback research

- [x] Define the research frame and test the outline's core claims.
- [x] Review expert commentary and established operating standards.
- [x] Map current AI-agent capabilities, deployments, and limitations.
- [x] Synthesize an original insight and practical operating model.
- [x] Verify claims against primary or authoritative sources and document conclusions.

## Review

- Formal quality guidance treats feedback as an end-to-end improvement process: intake, tracking, response, analysis, corrective action, audit, and continual improvement.
- CX practice distinguishes individual recovery from systemic improvement; current expert frameworks add workflow integration and strategic decision-making as separate loops.
- Product experts consistently treat feedback as evidence about problems, not a vote that directly determines the roadmap.
- Current AI is strongest at connective work: normalization, clustering, evidence retrieval, routing, drafting, cross-system updates, and monitoring. Strategy, public publishing, material remedies, and onboarding changes remain human-gated.
- The defensible category insight is a customer change ledger: a durable provenance chain from representative evidence through decision, work, release, enablement, notification, and verified outcome.
- The suggested north-star is learning conversion rate, supported by latency, coverage, recurrence, representativeness, and false-action metrics.

# Xiaohei feedback-processing loop video

- [x] Inspect the supplied illustration and available free local render tooling.
- [x] Build a restrained eight-second seamless animation from layered artwork.
- [x] Render MP4, WebM, GIF, and poster-frame deliverables.
- [x] Inspect representative frames and verify timing, dimensions, and codecs.

## Review

- Combined the recommended processing loop with the restrained social-loop treatment.
- Animated feedback intake, crank/lever motion, gear rotation, AI particles, sequential outputs, and two blinks.
- Rendered an 8.000-second, 30 fps, 1732×910 silent MP4 and WebM, plus a 15 fps GIF and poster frame.
- Verified the computed start and endpoint are pixel-identical and visually reviewed one frame per second plus the blink close-up.
- Used only local free/open-source tooling; the supplied artwork was not uploaded to a third party.

# Founder agent-runtime post editorial package

- [x] Read the research pipeline and no-slop rules in full.
- [x] Inspect the source draft, account, July 17 feedback posts, and nearby queue hooks read-only.
- [x] Audit and research the central claim with current primary sources.
- [x] Write distinct LinkedIn and X versions with a documented truth audit.
- [x] Create and verify one informative still visual and artifact README.
- [x] Run final factual, narrative, and no-slop checks.

## Review

- Narrowed the hook from a universal claim about implementation to a defensible claim about the first code change; shipping cost remains task- and system-dependent.
- Balanced the 26.08% completed-task gain in three randomized field experiments with METR's 19% early-2025 slowdown and METR's 2026 selection-bias caveat.
- Used DORA's throughput/instability and verification findings to support the cost-reallocation argument without claiming causation.
- Kept the founder voice to one explicit working assumption; no customer story, first-hand result, metric, or Userorbit capability was invented.
- Produced a 1731×909 master and 1200×630 sRGB social export; mobile and no-slop checks passed.

# Unheard founder post: agent authority boundary (July 19)

- [x] Treat the supplied hook as the complete founder source and use no additional first-person claims.
- [x] Research the proposal-versus-authorization thesis with current primary documentation.
- [x] Differentiate the narrative from the July 17 feedback posts and nearby company runtime hook.
- [x] Write final LinkedIn and X copy with a truth audit and primary-source links.
- [x] Create and verify one informative still under `artifacts/social-posts/founder_0719/`.

## Review

- Kept the supplied rebuild statement as the only first-person source fact; added no rewrite cause, customer story, incident, metric, or availability claim.
- Grounded guardrails, approvals, resumable state, tracing, least-privilege scopes, and resource-bound tokens in current OpenAI and MCP documentation.
- Reframed the post around the lifecycle from a proposed action to an authorized action, avoiding the July 17 closed-loop feedback framing and the nearby company runtime hook.
- Produced one 1600×2000 still with allow, pause, and deny branches plus an execution record.
- Verified the full-resolution PNG and a 540×675 mobile preview. Motion is not warranted.

# Content Hub / Unheard remote MCP client test

- [x] Inspect the local repository, git history, branches, stashes, and deployment configuration for the Content Hub MCP endpoint.
- [x] Probe the likely Unheard production MCP paths with and without the configured Content Hub API key.
- [x] Inspect existing Claude and Codex MCP registrations without changing permissions.
- [x] Specify a standards-compliant Streamable HTTP MCP transport, tool surface, authentication model, and safe deployment boundary.
- [x] Add protocol/integration tests and implement the Content Hub MCP endpoint.
- [x] Run focused tests, a production build, and direct protocol/security checks.
- [ ] Deploy without shipping unrelated worktree changes and verify the production endpoint.
- [ ] Connect and execute a read-only MCP call in Claude and Codex after action-time access confirmation.

## Review

- The repository exposes a bearer-authenticated remote HTTP agent API at `https://unheard.io/api/agent`, but contains no MCP route, MCP SDK dependency, transport implementation, OAuth metadata, or MCP deployment configuration.
- Authenticated MCP `initialize` requests to `https://unheard.io/mcp` and `https://unheard.io/api/mcp` hit the normal web-app fallback and return `500 {"error":"Only HTML requests are supported here"}`.
- The authenticated `/api/agent` endpoint treats an MCP `initialize` payload as invalid application input, confirming it is a project-specific JSON API rather than an MCP transport.
- Neither Claude nor Codex currently has a Content Hub/Unheard MCP registration; the visible `Userorbit` connections are unrelated and were left unchanged.
- A real two-client tool-call test is blocked on the actual hosted Content Hub MCP URL (or confirmation that a gateway/adapter exists outside this repository).

# Replace and schedule researched founder/company posts

- [x] Audit `SKILLS.md` against live API capabilities for read, overwrite, media replacement, scheduling, and verification.
- [x] Resolve authenticated API access and fetch all fourteen target posts.
- [x] Overwrite each target with the researched LinkedIn and X copy.
- [x] Upload and attach each post's intended visual asset.
- [x] Schedule one founder and one company post per day beginning July 19, 2026.
- [x] Verify post identity, audience, copy, media, timestamp, and final state through the API.

## Review

- Replaced fourteen existing Unheard posts rather than creating duplicates: seven founder/personal and seven company posts.
- Preserved the API-confirmed personal/company channel assignments and both explicit LinkedIn/X channel IDs for every post.
- Attached the feedback animation to the founder post, its poster to the company version, and one researched still to each remaining post.
- Scheduled the feedback pair for July 19 and the six researched pairs for July 20–25, all in Asia/Kolkata.
- A fresh singular GET for each post verified exact copy, one media record, the intended audience, both platforms, future timestamp, and `scheduled` state.
# Content Hub API/skill audit

- [x] Trace post read, update, media upload/replace, schedule/reschedule, and verification endpoints.
- [x] Compare implemented request/response schemas with `SKILLS.md` examples.
- [x] Confirm no API/schema change is required for the existing-post workflow.
- [x] Update `SKILLS.md` with precise overwrite and verification guidance.
- [x] Run available verification and record the result below.

## Review

- `GET /api/posts?id=<post-id>` returns one team-scoped post with full targets, explicit `channel_id` values, and media.
- `PATCH /api/posts` is the supported full-replacement operation: it deletes and recreates targets/media, accepts preserved channel IDs, and can atomically set `state: "scheduled"` with `publish_at` for arbitrary existing posts.
- `POST /api/posts/schedule` is intentionally conversion-specific because it requires an idea with the same ID; its optional media array appends rather than replaces.
- The skill now documents the safe fetch/upload/full-PATCH/verify sequence and the complete response fields needed by agents.
- `git diff --check -- SKILLS.md tasks/todo.md` passes. `npm test` could not start because `node_modules/.bin/vitest` is absent; no dependencies were installed for this documentation-only change.
# Complete Reddit channel publishing

- [x] Define the Reddit MVP data model and OAuth contract.
- [x] Implement encrypted OAuth connection, account discovery, and automatic token refresh.
- [x] Add subreddit, title, link, and flair controls to the post editor.
- [x] Persist Reddit target settings and publish reliable text/link posts.
- [x] Add focused tests, apply the migration to a database copy, and run the full suite/build.
- [x] Review the final diff and document operational setup.

## Review

- Added permanent OAuth authorization for a dedicated Reddit user, encrypted refreshable credentials, account discovery, default-subreddit storage, and live flair lookup.
- Reddit targets now retain an explicit title, subreddit, text/link mode, article URL, flair, NSFW flag, and spoiler flag across the editor, HTTP API, MCP/agent API, RSS imports, approvals, and publishing.
- RSS-created Reddit posts are link posts using the article title and URL. Shared media is deliberately excluded until native Reddit media upload is implemented.
- The migration applies cleanly to a database copy, all 69 tests pass, the production build succeeds, and the local Reddit connection form renders without browser errors.
- Production activation still requires Reddit approval for business use, an approved OAuth web app with the `/reddit/callback` redirect, the three Reddit environment values, migration `0022`, and a deployment.

# Per-user scheduled auto-publishing

- [x] Add default-off user preference, API, and settings toggle.
- [x] Route due posts through the publisher with an atomic scheduled-state claim.
- [x] Audit video API flow and update skill/API documentation.
- [x] Run TypeScript, lint, focused checks, and read-only live probe; record baseline blockers below.

## Auto-publishing review and release handoff

- User-level `auto_publish` defaults OFF. API keys change the key creator's preference, without accepting a user ID. UI: Settings → Notifications.
- Decision: posts have only team ownership, so cron uses the existing approval requester resolution (owner, otherwise first member). A contributor's preference does not override the owner's. No users were enabled.
- Due auto-posts atomically claim scheduled → publishing using ID/team/state/version predicates, then reuse the existing publisher. A Telegram notification exception cannot downgrade an already-published post. Existing approval packets remain gated.
- Instagram now waits up to roughly five minutes for a finished container; LinkedIn waits for video AVAILABLE after finalization. No resizing, transcoding, platform integrations, or validation rewrites were added.
- Manual checks: in-memory SQLite migration preserved existing/new defaults as 0; two identical state claims changed 1 then 0 rows. Shared single-MP4 validation returned no errors for YouTube, Instagram, Facebook, Twitter, and LinkedIn.
- `npx tsc --noEmit` is blocked by existing missing Chrome extension globals/implicit-any errors in `chrome-extension/src/background/index.ts`, `chrome-extension/src/content/index.ts`, and `chrome-extension/src/lib/api.ts`. A temporary config excluding only `chrome-extension` passes. The root tsconfig was not changed.
- Focused `npx eslint` was attempted and is blocked: ESLint 9 cannot find eslint.config.js/mjs/cjs. No lint script or TypeScript ESLint parser/config is present. No lint setup was invented for this change.
- `git diff --check` passes. No tests, production build, deployment, remote D1 access, or git writes were performed. Existing untracked `artifacts/` was untouched.
- Read-only production probe: unauthenticated GET https://unheard.io/api/settings returned HTTP 404 on 2026-10-17. The new settings route is not live; this does not establish the deployment status of every earlier committed feature.
- Provider-authenticated upload/publishing was not executed because it would write remote storage/D1/platforms. The API path was traced through upload → shared media persistence → channel resolution → cron → existing five publisher branches. HTTP posts do not invoke editor validation and upload does not probe codecs/size/duration; callers must honor documented limits. YouTube descriptions include the title line, and privacy defaults private unless configured on the selected channel.

Changed repo paths:
`lib/schema.ts`, `lib/db/types.ts`, `drizzle-d1/0023_user_auto_publish.sql`, `app/routes/api/settings.ts`, `app/routeTree.gen.ts`, `app/server-fns/telegram.ts`, `app/routes/settings/notifications.tsx`, `app/routes/settings/index.tsx`, `lib/approval.ts`, `app/routes/api/cron.ts`, `lib/instagram.ts`, `lib/linkedin.ts`, `AGENT_REFERENCE.md`, `SKILLS.md`, `tasks/todo.md`.

Changed external skill paths:
`/Users/mukesh/Downloads/agent-config-main/skills/content-hub/SKILL.md`
`/Users/mukesh/Downloads/agent-config-main/skills/content-hub/references/api.md`

Release commands for the orchestrator (not executed; migration first):

```bash
cd /Users/mukesh/Documents/dev/content-hub
npx wrangler d1 migrations apply content-hub --remote
npm run deploy
```

Enable afterwards using an API key created by the intended ProductWise owner (not executed):

```bash
curl -X PATCH 'https://unheard.io/api/settings' \
  -H "Authorization: Bearer $PRODUCTWISE_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{"auto_publish":true}'
```

Verify using GET on the same endpoint with the same key. For public YouTube publishing, select the correct channel and configure its privacy as public; automatic scheduling does not override that channel setting.

# Open-source self-hosting release

- [x] Add MIT license and public installation documentation.
- [x] Add deploy button, portable Cloudflare bindings, automatic migrations, native media delivery.
- [x] Add guided setup and portable installable agent skill.
- [x] Verify empty-database installation, tests, build, type checks, and release-data exclusions.
- [x] Record remaining publication steps and verification limits.

# Support drawer and floating widget

- [x] Confirm SDK drawer and floating placement options.
- [x] Wire Support to openWidget and enable a bottom-left floating launcher.
- [x] Verify the change, review its scope, and push only the support changes.


## Release review

- Public repo: https://github.com/middlerange/unheard; clean initial commit 5324f97982df9bc7314801d873cc4210c08fb8a1, exported by explicit allowlist. Original middlerange/content remains private; no history copied.
- MIT license, public README/deploy button, two required secret prompts, native D1/R2 bindings and migration-first deploy; signup enters guided setup and serves portable skill files.
- No inherited personal profile, Userorbit widget, Reddit identity, AI glossary, or hosted Telegram editor URL on new installations.
- 80 tests across 18 files, production build, application typecheck pass. Application config excludes preexisting Chrome extension typings. Dependency audit reports zero high/critical; remaining six moderate package entries affect development esbuild tooling and Nitro's Node request adapter, outside the deployed Worker path.
- Isolated Wrangler local D1 applied all migrations; browser signup reaches setup; deployment-specific URLs display correctly. Authenticated upload through R2 returned byte-identical public media; OAuth issuer uses the local deployment origin. Skill assets return HTTP 200.
- Local private account database and SQL export preserved under ignored .private-release-backup/. Public snapshot excludes these, historical state, internal notes, personal assets, and old automation/test credentials.
- Cloudflare hosted provisioning and real social provider authorization/posting were not executed. First public CI run passed installation, all 80 tests, build, and types: https://github.com/middlerange/unheard/actions/runs/39562248714.

Support review: Type checking and production build passed. A focused browser harness using the exact initialization and Support button from the source, with the live Userorbit SDK, confirmed the bottom-left launcher and right-side drawer. Only support integration hunks are staged; existing release edits remain uncommitted.

# Route transition polish and idea assistant

- [x] Inspect the supplied recording at sampled transition frames and identify avoidable route loading churn.
- [x] Keep initial workspace seed data stable across client navigation and animate page content transitions.
- [x] Add a styled pending state and steady connected-account loading slot in the post editor.
- [x] Bring the idea assistant empty state and composer into the dashboard design system.
- [x] Verify typecheck and production build.

## Review

The root workspace loader now stays fresh for the lifetime of the app session; `WorkspaceProvider` remains responsible for updates. Router view transitions animate only the page-content area, and a styled pending indicator appears only for slower route loads. The assistant now has a guided empty state, starter prompts, and a consistent composer surface.

Transition follow-up: reproduced `/posts` → `/posts/new` in the local browser. The first crossfade allowed the Posts screen to bleed through the editor; changed the incoming transition to an opaque, non-fading surface. Replayed the route and confirmed the editor now appears without old-page content behind it. Verified the assistant empty state no longer has an unnecessary inner scrollbar.

# Remove post editor route snapshot flicker

- [x] Trace `/posts` → `/posts/new` and identify the native View Transition snapshot between different page frames.
- [x] Remove the snapshot animation and page-content names so the persistent shell stays styled during navigation.
- [x] Confirm the editor route renders in the local browser and run the application typecheck.

## Review

Removed the native route View Transition setting, matching page-content names, and snapshot animation CSS. The local `/posts` → `/posts/new` click now opens the styled editor directly. `npm run typecheck` and `git diff --check` pass.

# Cloudflare research workspace

- [x] Curate practitioner-first sources; preserve original 43 with competitor sources disabled.
- [x] Implement team-scoped research storage, bounded collectors, GPT-6 Luna scoring and saving findings as ideas.
- [x] Add /research interface with source controls, daily collection, scan progress and grounded results.
- [x] Wire durable Cloudflare Workflow execution and daily dispatch, preserving publisher cron.
- [x] Verify migrations, meaningful regression tests, typecheck, build, UI and source parsing.
- [x] Deploy supported research feature with existing OpenAI secret and verify production behavior.

Review: Deployed /research and content-hub-research Workflow to the existing Cloudflare Worker; migrated existing D1 without altering application records. Preserved 43 original sources, curated 65 total, enabled 25 practitioner/research/YouTube sources and disabled every competitor source. Production collection completed for all 25 enabled sources with no errors, added eight archive items and used zero model tokens. The production 30-day scan produced six evidence-backed findings using GPT-6 Luna (26,161 input / 2,190 output tokens). Daily collection is enabled for UserOrbit. No ideas or posts were automatically created. Public captions were unavailable for collected videos, which remain outside ranking. All 99 tests, typecheck, build and desktop/mobile UI checks passed. Verified temporary validation credentials were removed.

# Daily research drafts and Slack review

- [x] Change scheduled research to scan the preceding 24 hours and select only strong, fresh post opportunities.
- [x] Generate grounded drafts with GPT-6 Luna, using each opted-in connected profile’s system prompt to decide relevance, and persist their evidence and revision history.
- [x] Add team-scoped Slack connection, verified event intake, review threads, edit requests and explicit latest-version publishing approval.
- [x] Add app controls and visible review/run status; document Slack installation and missing configuration.
- [x] Verify security, duplicate delivery, stale approvals, drafting quality boundaries, migrations, types, build and UI.
- [x] Deploy, verify live behavior, commit and push task changes while preserving unrelated edits.
- [x] Add Slack OAuth connection so users authorize a workspace and choose channel/reviewers without entering bot tokens; validate state binding, replay protection and encrypted token storage.

Review: Implemented team-configurable daily 24-hour ranking and up to two grounded drafts using per-profile system prompts; retained manual 30-day discovery. Slack OAuth supports workspace authorization and named channel/reviewer selection, encrypted installation tokens, owner-bound expiring one-use state, signed callback intake, ordered thread edits, revision-bound publishing and explicit safe partial retries. Added Facebook Page text publishing and durable X root/reply checkpoints. All 154 tests across 27 files, typecheck, build and responsive browser checks passed. A real GPT-6 Luna structured draft verified grounding/attribution (3,690 input / 251 output tokens), without saving or publishing. Deployed version 3ec20692-110a-48f6-be7f-02a445f75cdc and migration 0026; original 192 posts, 359 targets, 6 channels, 174 ideas and 73 media records retained. Production 24-hour scan completed (408 input / 12 output tokens), collected one new item and returned no qualifying findings. Five public sources failed (one 429 and four video-feed 404 responses), reported in Research. No profiles are opted in yet. Slack delivery and live OAuth authorization await the deployment operator’s one-time Slack application credentials; the live button shows this prerequisite. Temporary API validation credentials were removed. The deployed Slack Workflow and signed internal endpoint executed a harmless validation job; temporary job records were removed.
