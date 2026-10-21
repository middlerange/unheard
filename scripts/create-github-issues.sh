#!/bin/bash
# Create GitHub issues for unheard.io content platform
# Usage: ./create-github-issues.sh

REPO="middlerange/content"
API_URL="https://api.github.com/repos/$REPO/issues"

# Helper function to create an issue
create_issue() {
  local title="$1"
  local body="$2"
  local labels="$3"
  
  curl -s -X POST \
    -H "Authorization: token $GITHUB_TOKEN" \
    -H "Accept: application/vnd.github.v3+json" \
    -H "Content-Type: application/json" \
    -d "{
      \"title\": \"$title\",
      \"body\": \"$body\",
      \"labels\": [$labels]
    }" \
    "$API_URL"
  
  echo ""
}

# Issue 1: Platform Validation Fixes (from existing backlog)
BODY1='$(cat <<'EOF'
## Platform Validation Fixes

### Current Issues
- [ ] **Block submission on character limit exceeded** — currently the char counter is informational only; save/schedule/publish should be disabled when content exceeds the platform limit (280/4000 Twitter, 3000 LinkedIn)
- [ ] **Twitter media count warning** — `twitter.ts` silently slices media to 4; should surface an error or warning to the user instead
- [ ] **LinkedIn non-carousel image limit** — LinkedIn non-carousel posts should only send 1 image; currently all uploaded images are sent, which can cause API errors
- [ ] **Per-platform media** — media is shared across platforms with no way to attach different images to Twitter vs LinkedIn

### Acceptance Criteria
- Character limits enforced before submission
- Clear error messages for validation failures
- Per-platform media attachment support

**Priority:** High
**Labels:** bug, validation, platforms
EOF
)'

create_issue "Platform Validation & Media Attachment Fixes" "$BODY1" '"bug","validation","platforms"'

echo "Created Issue 1: Platform Validation Fixes"

# Issue 2: Reddit Integration
BODY2='$(cat <<'EOF'
## Reddit Integration for Startup Marketing

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

**Priority:** High
**Labels:** feature, platform, reddit
EOF
)'

create_issue "Add Reddit Platform Support" "$BODY2" '"feature","platform","reddit"'

echo "Created Issue 2: Reddit Integration"

# Issue 3: Discord Integration
BODY3='$(cat <<'EOF'
## Discord Integration for Community Building

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

**Priority:** Medium
**Labels:** feature, platform, discord
EOF
)'

create_issue "Add Discord Platform Support" "$BODY3" '"feature","platform","discord"'

echo "Created Issue 3: Discord Integration"

# Issue 4: Analytics Dashboard
BODY4='$(cat <<'EOF'
## Analytics Dashboard for Performance Tracking

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

**Priority:** High
**Labels:** feature, analytics, dashboard
EOF
)'

create_issue "Build Analytics Dashboard" "$BODY4" '"feature","analytics","dashboard"'

echo "Created Issue 4: Analytics Dashboard"

# Issue 5: Cross-Posting Improvements
BODY5='$(cat <<'EOF'
## Cross-Posting & Content Adaptation

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

**Priority:** High
**Labels:** feature, cross-post, ux
EOF
)'

create_issue "Cross-Posting with Per-Platform Customization" "$BODY5" '"feature","cross-post","ux"'

echo "Created Issue 5: Cross-Posting"

# Issue 6: AI Content Assistant
BODY6='$(cat <<'EOF'
## AI Content Assistant (Copilot)

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

**Priority:** Medium
**Labels:** feature, ai, content
EOF
)'

create_issue "AI Content Assistant & Copilot Features" "$BODY6" '"feature","ai","content"'

echo "Created Issue 6: AI Assistant"

# Issue 7: RSS Auto-Posting
BODY7='$(cat <<'EOF'
## RSS Feed Auto-Posting

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

**Priority:** Medium
**Labels:** feature, automation, rss
EOF
)'

create_issue "RSS Feed Auto-Posting" "$BODY7" '"feature","automation","rss"'

echo "Created Issue 7: RSS Auto-Posting"

# Issue 8: Webhooks
BODY8='$(cat <<'EOF'
## Webhook Integration for External Automations

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

**Priority:** Medium
**Labels:** feature, api, webhooks, integration
EOF
)'

create_issue "Webhook Integration for External Automations" "$BODY8" '"feature","api","webhooks","integration"'

echo "Created Issue 8: Webhooks"

# Issue 9: Team Collaboration
BODY9='$(cat <<'EOF'
## Team Collaboration & Approval Workflows

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

**Priority:** Medium
**Labels:** feature, team, collaboration
EOF
)'

create_issue "Team Collaboration & Approval Workflows" "$BODY9" '"feature","team","collaboration"'

echo "Created Issue 9: Team Collaboration"

# Issue 10: Telegram Integration
BODY10='$(cat <<'EOF'
## Telegram Integration

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

**Priority:** Low
**Labels:** feature, platform, telegram
EOF
)'

create_issue "Add Telegram Platform Support" "$BODY10" '"feature","platform","telegram"'

echo "Created Issue 10: Telegram"

# Issue 11: Post Templates Library
BODY11='$(cat <<'EOF'
## Post Templates Library

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

**Priority:** Medium
**Labels:** feature, templates, content
EOF
)'

create_issue "Post Templates Library" "$BODY11" '"feature","templates","content"'

echo "Created Issue 11: Templates"

# Issue 12: Best Time to Post
BODY12='$(cat <<'EOF'
## Best Time to Post (AI-Powered Scheduling)

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

**Priority:** Low
**Labels:** feature, ai, scheduling, analytics
EOF
)'

create_issue "AI-Powered Best Time to Post" "$BODY12" '"feature","ai","scheduling","analytics"'

echo "Created Issue 12: Best Time to Post"

echo ""
echo "==================================="
echo "All 12 GitHub issues created!"
echo "==================================="
