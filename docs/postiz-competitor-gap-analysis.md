# Postiz competitor gap analysis for unheard.io

Date: 2026-04-07
Repo assessed: `content`

## What Postiz appears to offer

Based on `https://postiz.com/`, `https://postiz.com/agent`, and platform pages, Postiz positions itself as an AI-native, multi-platform social publishing system with these core capabilities:

### Core platform
- Multi-platform publishing across 25 to 30+ destinations
- Drafts, scheduled posts, published posts
- Cross-posting to multiple channels from one workflow
- Visual scheduling and content calendar
- Rich media upload support, including images, video, audio, docs
- AI content generation and editing assistance
- Canva-like creative tooling plus AI image generation
- Analytics at platform and post level
- Team collaboration and task delegation
- Auto actions based on milestones or triggers
- Public API plus automation integrations (n8n, Make, Zapier)
- Self-hosting and open-source positioning

### Agent/CLI layer
- CLI designed for automation and AI agents
- Structured JSON command output
- Integration discovery and dynamic platform settings discovery
- Post CRUD from CLI
- Upload API and reusable media URLs
- Analytics retrieval from CLI
- Human-in-the-loop positioning for sensitive actions

### Platform-specific capability examples
- X: threads, reply controls, community posting
- LinkedIn: personal/company posting, image carousels
- Reddit: subreddit targeting, flairs, post types, cross-posting
- YouTube: video uploads, thumbnail, visibility, tags, made-for-kids flags
- Instagram/TikTok/Pinterest/Facebook and many others are also represented in marketing
- Messaging/community/blog/newsletter surfaces like Discord, Slack, Telegram, Medium, Dev.to, WordPress, Listmonk, etc.

## What the current `content` repo already has

### Present today
- Draft, scheduled, published state model
- Visual calendar route
- AI writing assistant positioning on landing page
- Idea to post workflow
- Basic brand voices
- Templates settings
- Auto scheduling helper
- Agent-ready marketing language
- Twitter/X support
  - text posts
  - reply settings
  - thread support
- LinkedIn support
  - personal/company channels
  - carousel toggle and naming
- Channel settings UI
- Telegram publish notifications

### Important current limits visible in code
- Only two platforms are supported in core types: `twitter`, `linkedin`
- No generalized integration discovery layer
- No platform settings schema discovery or dynamic forms
- No public API for external automation beyond local app endpoints
- No CLI or machine-oriented contract layer
- No analytics dashboards or post/platform analytics retrieval
- No team roles, approvals, comments, or task delegation
- No inbox, engagement, listening, or audience workflows
- No reusable media library surface
- No broader social/channel matrix

## Competitor gaps that matter most

## P0, must-have to be a real Postiz competitor

### 1. Multi-platform architecture, not hard-coded two-platform support
- Generalize platform model beyond `twitter | linkedin`
- Create platform capability registry
- Store per-platform schemas and feature flags
- Render dynamic compose/settings forms per platform
- Support per-target validation rules

### 2. Channel and integration framework
- OAuth and token management per provider
- Integration discovery endpoint and UI
- Multiple accounts per platform
- Personal/company/community account variants
- Default account routing and health status

### 3. Media pipeline
- Upload service for image/video/document assets
- Reusable media library
- Validation by platform and media type
- Thumbnail support where needed
- Multi-asset attachments per target

### 4. Publish orchestration engine
- Cross-post fanout with per-target settings
- Per-platform publish adapters
- Robust retries, failure states, and partial success reporting
- Immediate publish vs scheduled publish vs draft
- Job logs and audit trail

### 5. Analytics
- Post-level analytics
- Channel/platform-level analytics
- Engagement and reach reporting
- Analytics refresh jobs and storage model
- Basic dashboard views

### 6. API and agent surface
- Stable public API for integrations, posts, analytics, uploads
- JSON-first contracts for automation
- CLI for create/list/delete/upload/analytics/discovery flows
- Agent-safe command design and docs

## P1, strong differentiation and adoption drivers

### 7. Collaboration and approvals
- Teams/workspaces
- Roles and permissions
- Review and approval states
- Internal comments and assignments
- Activity history

### 8. AI workflow expansion
- AI rewrite variants by platform
- Brand-aware content generation
- Suggested scheduling times
- AI image generation
- Campaign generation from one brief
- Agent-assisted multi-step publishing

### 9. Platform breadth
Add next wave support in phases:
- Reddit
- YouTube
- Instagram
- Facebook
- TikTok
- Pinterest
Then long-tail surfaces:
- Discord
- Slack
- Telegram
- Medium
- Dev.to
- Hashnode
- WordPress
- Newsletter channels

### 10. Platform-specific advanced settings
- Reddit flairs and post types
- YouTube thumbnail, tags, visibility, kids flags
- X communities and reply controls
- LinkedIn carousel, page posting
- Pinterest boards
- Instagram reels/stories/feed distinctions

### 11. Automation ecosystem
- Webhooks
- n8n/Make/Zapier recipes or connectors
- Event triggers and post lifecycle hooks
- Scheduled automation playbooks

## P2, excellent but not required for first parity milestone
- Social inbox and engagement management
- Auto-like/auto-comment style automations
- Content performance recommendations
- White-label / agency client portal
- Benchmarking and competitor tracking
- Campaign templates and content batching UI

## Recommended issue backlog

### Foundation
1. Generalize platform model and database schema beyond Twitter/LinkedIn
2. Build platform capability registry and dynamic settings schema system
3. Introduce integration discovery service and channel health model
4. Create shared publish job table, logs, and retryable execution engine
5. Build reusable media upload and asset library system
6. Design public API v1 for posts, uploads, integrations, analytics
7. Ship CLI v1 for agent and automation workflows

### Platform expansion
8. Add Reddit integration with subreddit flair and post-type support
9. Add YouTube integration with video upload, thumbnails, tags, and visibility
10. Add Instagram integration with feed/reel/story primitives
11. Add Facebook integration with page posting
12. Add TikTok integration with video publishing flow
13. Add Pinterest integration with board-aware posting

### Product surfaces
14. Build analytics data model and post analytics UI
15. Build channel analytics dashboard
16. Build collaboration model: teams, roles, approvals, comments
17. Add review states: draft, in_review, approved, scheduled, published, failed
18. Build activity log and audit history
19. Add media library UI and asset reuse in composer
20. Build platform-specific dynamic compose UI

### AI and automation
21. Expand AI writer into platform-aware campaign generator
22. Add AI image generation and creative asset flow
23. Add best-time scheduling recommendations
24. Add webhook/event system for post lifecycle
25. Add automation docs and integration examples for n8n/Make/Zapier

## Mapping to current repo reality

The fastest high-leverage move is not adding another single platform directly into the current hard-coded shape. The best first move is:

1. generalize platform definitions
2. generalize post target settings
3. create a registry-driven compose and publish layer
4. then add Reddit and YouTube as proof the abstraction works

That path avoids repainting the app every time a platform is added.

## Suggested first implementation slice

### First slice
Add a platform registry and expand the domain model from a hard-coded union to a shared `PlatformId` type.

Why this first:
- It unlocks every later platform addition
- It reduces repeated conditional logic across UI, storage, and publishing
- It is small enough to ship incrementally

### Concrete first tasks inside that slice
- Introduce `PlatformId` and `SUPPORTED_PLATFORMS`
- Replace inline `twitter | linkedin` unions where safe
- Add a central capability map for current platforms
- Prepare settings UI to render platform metadata from the registry
- Keep current functionality unchanged while enabling expansion

## Blockers encountered during this run
- OpenCode ACP session could not be used because the local gateway reports `pairing required`
- GitHub CLI is not installed in this environment, so issue creation could not be automated from here
- Workspace root is not itself the product repo; `content` appears to be the relevant repo

## Recommended next execution order
1. Land platform registry refactor
2. Add issue backlog to GitHub
3. Add Reddit adapter end-to-end
4. Add YouTube adapter end-to-end
5. Add analytics model and UI
6. Add public API + CLI
7. Add approvals/collaboration
