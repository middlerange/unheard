# GitHub Issues for unheard.io (Postiz Competitor)

This document contains all the GitHub issues needed to make unheard.io a competitive alternative to Postiz for early-stage startups.

---

## Issue #1: Platform Validation & Media Attachment Fixes

**Labels:** bug, validation, platforms  
**Priority:** High

### Current Issues
- [ ] **Block submission on character limit exceeded** — currently the char counter is informational only; save/schedule/publish should be disabled when content exceeds the platform limit (280/4000 Twitter, 3000 LinkedIn)
- [ ] **Twitter media count warning** — `twitter.ts` silently slices media to 4; should surface an error or warning to the user instead
- [ ] **LinkedIn non-carousel image limit** — LinkedIn non-carousel posts should only send 1 image; currently all uploaded images are sent, which can cause API errors
- [ ] **Per-platform media** — media is shared across platforms with no way to attach different images to Twitter vs LinkedIn

### Acceptance Criteria
- Character limits enforced before submission
- Clear error messages for validation failures
- Per-platform media attachment support

---

## Issue #2: Add Reddit Platform Support

**Labels:** feature, platform, reddit  
**Priority:** High

Reddit is a key platform for startups to engage with communities and get early traction. Add full Reddit support.

### Features
- [ ] OAuth 2.0 authentication with Reddit
- [ ] Post to subreddits with title + text/link
- [ ] Support for link posts vs text posts
- [ ] Subreddit validation and search
- [ ] Flair selection per subreddit
- [ ] Comment scheduling on own posts
- [ ] Reddit-specific character limits (40k for text posts)
- [ ] Cross-posting support

### API Reference
- Reddit API: https://www.reddit.com/dev/api/
- OAuth: https://github.com/reddit-archive/reddit/wiki/OAuth2

### Acceptance Criteria
- Connect Reddit account via OAuth
- Post to multiple subreddits
- Select flairs where required
- Schedule Reddit posts
- View post status in calendar

---

## Issue #3: Add Discord Platform Support

**Labels:** feature, platform, discord  
**Priority:** Medium

Discord is essential for startup community building. Add Discord webhook and bot support.

### Features
- [ ] Discord webhook integration (easy setup)
- [ ] Discord bot integration (advanced)
- [ ] Post to channels with rich embeds
- [ ] Support for @mentions and roles
- [ ] Thread creation in channels
- [ ] Scheduled announcements
- [ ] Role-based posting permissions

### API Reference
- Webhooks: https://discord.com/developers/docs/resources/webhook
- Bots: https://discord.com/developers/docs/topics/oauth2

### Acceptance Criteria
- Connect Discord via webhook URL or bot token
- Post rich content with embeds
- Support images and files
- Schedule Discord messages
- View in calendar

---

## Issue #4: Build Analytics Dashboard

**Labels:** feature, analytics, dashboard  
**Priority:** High

Postiz has comprehensive analytics. We need basic analytics to track content performance.

### Features
- [ ] Platform-level analytics (followers, impressions, engagement)
- [ ] Post-level analytics (likes, comments, shares, clicks)
- [ ] Time-series charts (daily/weekly/monthly views)
- [ ] Top performing posts
- [ ] Engagement rate calculations
- [ ] Export analytics data (CSV)
- [ ] Dark/light mode charts

### Platforms to Support
- [ ] Twitter analytics
- [ ] LinkedIn analytics
- [ ] Reddit analytics (when added)
- [ ] Discord analytics (when added)

### Acceptance Criteria
- View analytics per platform
- Compare post performance
- Export data
- Date range selection

---

## Issue #5: Cross-Posting with Per-Platform Customization

**Labels:** feature, cross-post, ux  
**Priority:** High

Currently platforms share the same content. Need smart cross-posting with per-platform customization.

### Features
- [ ] Per-platform content customization in single post
- [ ] Auto-adapt content length per platform
- [ ] Platform-specific media attachments
- [ ] Preview how post looks on each platform
- [ ] One-click publish to all connected platforms
- [ ] Selective platform publishing (toggle on/off)
- [ ] Cross-post scheduling (stagger posts by X minutes)

### UI Changes
- [ ] Platform tabs in post editor
- [ ] Character counters per platform
- [ ] Preview mode for each platform
- [ ] Platform toggle switches

### Acceptance Criteria
- Write once, customize per platform
- Visual preview before posting
- Stagger cross-posts to avoid spam detection
- Easy platform selection

---

## Issue #6: AI Content Assistant & Copilot Features

**Labels:** feature, ai, content  
**Priority:** Medium

Postiz has an AI Copilot. Enhance our AI features to match.

### Features
- [ ] AI-powered content suggestions based on trending topics
- [ ] Rewrite content for different platforms
- [ ] Generate thread hooks and continuations
- [ ] AI image generation (DALL-E integration)
- [ ] AI content templates library
- [ ] Brand voice training from past posts
- [ ] Engagement prediction (AI suggests best time)
- [ ] Hashtag recommendations

### UI Components
- [ ] AI suggestion panel
- [ ] One-click apply suggestions
- [ ] Template selector with AI preview
- [ ] Brand voice settings

### Acceptance Criteria
- Generate multiple content variations
- Platform-specific rewriting
- AI image generation workflow
- Save and reuse brand voice

---

## Issue #7: RSS Feed Auto-Posting

**Labels:** feature, automation, rss  
**Priority:** Medium

Automatically post new content from RSS feeds. Essential for content marketing.

### Features
- [ ] Add RSS feed sources (blog, podcast, YouTube)
- [ ] Auto-detect new items
- [ ] Customize post template for RSS items
- [ ] Select target platforms per feed
- [ ] Schedule frequency (immediate, daily digest, weekly)
- [ ] Filter by keywords/categories
- [ ] Deduplication detection

### Supported Feed Types
- [ ] WordPress/RSS 2.0
- [ ] Atom feeds
- [ ] Podcast feeds
- [ ] YouTube channel feeds

### Acceptance Criteria
- Add and manage RSS sources
- Preview before auto-posting
- Configure posting rules
- View RSS feed status

---

## Issue #8: Webhook Integration for External Automations

**Labels:** feature, api, webhooks, integration  
**Priority:** Medium

Webhooks allow integration with Zapier, Make.com, n8n, and custom workflows.

### Features
- [ ] Outgoing webhooks on events (post published, scheduled, failed)
- [ ] Webhook signature verification (HMAC)
- [ ] Retry logic for failed webhooks
- [ ] Webhook event log
- [ ] Custom headers support
- [ ] Filter webhooks by event type
- [ ] Test webhook endpoint

### Events to Support
- [ ] post.created
- [ ] post.scheduled
- [ ] post.published
- [ ] post.failed
- [ ] post.deleted
- [ ] media.uploaded

### Acceptance Criteria
- Configure webhook URLs
- Event filtering
- Delivery logs with retries
- Secure signature verification

---

## Issue #9: Team Collaboration & Approval Workflows

**Labels:** feature, team, collaboration  
**Priority:** Medium

For startup teams, collaboration features are essential.

### Features
- [ ] Multi-user support with roles (admin, editor, viewer)
- [ ] Post approval workflow (draft → review → approved → scheduled)
- [ ] Comments on posts (team discussion)
- [ ] @mentions in comments
- [ ] Activity feed / notifications
- [ ] Assign posts to team members
- [ ] Role-based permissions (who can post where)

### Roles
- [ ] Admin: full access
- [ ] Editor: create, edit, schedule
- [ ] Viewer: view only, comment

### Acceptance Criteria
- Invite team members
- Approval workflow enforced
- Comment and discuss posts
- Permission-based UI

---

## Issue #10: Add Telegram Platform Support

**Labels:** feature, platform, telegram  
**Priority:** Low

Telegram is popular in startup/tech communities. Add bot-based posting.

### Features
- [ ] Telegram bot integration
- [ ] Post to channels and groups
- [ ] Support for rich formatting (Markdown)
- [ ] Image and video posts
- [ ] Poll creation
- [ ] Scheduled messages
- [ ] Pin important messages

### API Reference
- https://core.telegram.org/bots/api

### Acceptance Criteria
- Connect Telegram bot
- Post to multiple channels
- Schedule messages
- View in calendar

---

## Issue #11: Post Templates Library

**Labels:** feature, templates, content  
**Priority:** Medium

Pre-built templates for common startup marketing posts.

### Templates to Include
- [ ] Product launch announcement
- [ ] Feature release
- [ ] Customer testimonial
- [ ] Behind the scenes / team post
- [ ] Industry insight / thought leadership
- [ ] Poll / engagement question
- [ ] Milestone celebration
- [ ] Tutorial / how-to
- [ ] AMA announcement
- [ ] Newsletter signup CTA

### Features
- [ ] Template browser with categories
- [ ] One-click apply template
- [ ] Custom template creation
- [ ] AI fills template with context
- [ ] Template favorites
- [ ] Platform-specific template variations

### Acceptance Criteria
- Browse and select templates
- AI auto-fills placeholders
- Save custom templates
- Template preview

---

## Issue #12: AI-Powered Best Time to Post

**Labels:** feature, ai, scheduling, analytics  
**Priority:** Low

AI-suggested optimal posting times based on audience activity.

### Features
- [ ] Analyze historical engagement data
- [ ] Suggest best times per platform
- [ ] Timezone-aware recommendations
- [ ] One-click schedule at suggested time
- [ ] Weekly schedule optimization
- [ ] Competitor posting time analysis
- [ ] Industry benchmark comparisons

### Data Sources
- [ ] Own post history
- [ ] Platform follower activity
- [ ] Industry benchmarks

### Acceptance Criteria
- AI suggests optimal times
- Visual heatmap of best times
- One-click apply suggestion
- Performance improvement tracking

---

## Implementation Roadmap

### Phase 1: Foundation (Weeks 1-2)
1. **Issue #1** - Platform Validation Fixes (critical bug fixes)
2. **Issue #5** - Cross-Posting Improvements (core UX)

### Phase 2: Platform Expansion (Weeks 3-4)
3. **Issue #2** - Reddit Platform (high-value for startups)
4. **Issue #3** - Discord Platform (community building)

### Phase 3: Insights & Automation (Weeks 5-6)
5. **Issue #4** - Analytics Dashboard (measure success)
6. **Issue #7** - RSS Auto-Posting (content marketing automation)

### Phase 4: Advanced Features (Weeks 7-8)
7. **Issue #6** - AI Content Assistant (productivity)
8. **Issue #8** - Webhooks (integration ecosystem)

### Phase 5: Team & Scale (Weeks 9-10)
9. **Issue #9** - Team Collaboration (multi-user)
10. **Issue #11** - Templates Library (content efficiency)

### Phase 6: Polish & Growth (Weeks 11-12)
11. **Issue #10** - Telegram (additional platform)
12. **Issue #12** - Best Time to Post (optimization)

---

## Competitive Differentiators for unheard.io

1. **Simpler than Postiz** - Focused on startup needs, not enterprise bloat
2. **Better AI** - More intelligent content adaptation per platform
3. **Startup-focused platforms** - Reddit, Discord, Telegram prioritized over Pinterest/Dribbble
4. **Faster setup** - OAuth flows streamlined, no complex configs
5. **Transparent pricing** - No per-seat pricing for small teams
6. **Open source option** - AGPL or MIT license for self-hosting

## How to Create These Issues in GitHub

1. Go to https://github.com/middlerange/content/issues
2. Click "New issue"
3. Copy-paste each issue title and body
4. Add appropriate labels
5. Or use GitHub CLI: `gh issue create --title "..." --body "..." --label "..."`
