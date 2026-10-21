# Unheard MCP Server and Remote API Reference

This document includes only APIs that are callable remotely over HTTP with a secret key.

## Unheard MCP server

Connect MCP-compatible agents to `https://unheard.io/mcp`. The server identifies itself as **Unheard MCP server** and supports OAuth 2.1 discovery at `/.well-known/oauth-protected-resource/mcp`. Team API keys remain supported as bearer tokens.

The MCP tool namespace is `unheard_*`. Its content-calendar tools can list and read posts, create drafts or scheduled posts, replace existing posts and media, reschedule posts, send the exact saved snapshot for approval, and delete posts. Agents with this MCP connection do not need a signed-in browser for those workflows.

Use `unheard_content_calendar_read` for `list` and `get`. Use `unheard_content_calendar_write` for `create`, `update`, `schedule`, `requestApproval`, and `delete`. `requestApproval` takes `{ "id": "<post-id>" }`, updates that existing post to `awaiting_approval`, and delivers its saved snapshot to Telegram; it does not create a duplicate post.

## Recent Changes

### 2026-04-07: Platform Validation & Reddit Support
- Added comprehensive validation system in `/lib/validation.ts`
- Character limits now enforced: Twitter (280/4000), LinkedIn (3000), Reddit (40k)
- Media limits enforced: Twitter (4 images), LinkedIn (1 image or 10 carousel)
- Reddit platform support added with OAuth 2.0, subreddit posting, and flair selection
- Visual error indicators on channel avatars and platform tabs
- Save/Schedule/Publish disabled when validation errors exist

## Base URL

| Environment | URL |
| --- | --- |
| Production | `https://unheard.io` |

## Authentication

Users can create team API keys from Settings -> API Keys and use those keys with their agents.

Send on every request:

```http
Authorization: Bearer <team API key>
```

On auth failure, endpoints return:

```json
{ "error": "Unauthorized" }
```

Status: `401`

## Endpoints Overview

- `GET/POST /api/agent`
- `GET/POST/PATCH/DELETE /api/posts`
- `POST /api/posts/schedule`
- `GET/POST/PATCH/DELETE /api/ideas`
- `POST /api/ideas/convert-to-post`
- `POST /api/upload`
- `POST /api/ai`
- `POST /api/assistant`
- `GET /api/cron`

---

## Agent API

Endpoint: `/api/agent`

This is the preferred entry point for external agents that need to discover and operate app interfaces through a single HTTP API.

Authentication:

- Create a key in Settings -> API Keys.
- Send `Authorization: Bearer <team API key>`.
- The team/account is resolved from the key automatically.

### `GET /api/agent`

Returns the agent capability manifest: supported resources, actions, auth requirements, and existing specialized HTTP APIs.

Resources exposed:

- `posts`: `list`, `get`, `create`, `update`, `schedule`, `requestApproval`, `delete`
- `ideas`: `list`, `get`, `create`, `update`, `delete`, `setStatus`
- `brands`: `list`, `get`, `create`, `update`, `delete`, `setDefault`
- `channels`: `list`, `get`, `create`, `update`, `delete`, `setDefault`
- `templates`: `list`, `get`, `create`, `update`, `delete`
- `templateLibrary`: `list`, `get`, `create`, `update`, `delete`
- `rssFeeds`: `list`, `get`, `create`, `update`, `delete`
- `webhooks`: `list`, `get`, `create`, `update`, `delete`
- `bestTimePredictions`: `list`
- `teamMembers`: `list`
- `postComments`: `list`
- `postApprovals`: `get`
- `telegramChannels`: `list`, `create`, `delete`

### `POST /api/agent`

Invoke one resource action.

Body:

```json
{
  "resource": "brands",
  "action": "create",
  "input": {
    "name": "Founder voice",
    "voice": "Direct, practical",
    "audience": "B2B SaaS founders",
    "writing_prompt": "Avoid generic AI phrasing.",
    "is_default": true
  }
}
```

Response:

```json
{
  "ok": true,
  "result": {
    "id": "brand-id"
  }
}
```

Errors:

- `400` `{ "error": "Invalid input", "details": [...] }`
- `400` `{ "error": "Unsupported action: resource.action" }`
- `401` `{ "error": "Unauthorized" }`
- `401` `{ "error": "Invalid API key" }`
- `401` `{ "error": "API key revoked" }`

---

## Posts API

Endpoint: `/api/posts`

### `GET /api/posts`

List posts or fetch one post by id.

Query params:

- `id` (optional): if provided, returns one post
- `state` (optional, repeatable): e.g. `?state=draft&state=scheduled`
- `states` (optional, CSV): e.g. `?states=draft,scheduled`

Valid states for filtering: `draft | scheduled | awaiting_approval | publishing | published | failed`

Examples:

- `GET /api/posts`
- `GET /api/posts?id=<postId>`
- `GET /api/posts?state=scheduled`
- `GET /api/posts?states=draft,scheduled`

Responses:

- `200` `PostWithDetails[]` (list mode)
- `200` `PostWithDetails` (id mode)
- `404` `{ "error": "Not found" }` (id mode, missing)
- `400` `{ "error": "Invalid state(s): ..." }` (bad `state/states`)

### `POST /api/posts`

Create a draft or scheduled post.

Body:

```json
{
  "targets": [
    {
      "platform": "twitter",
      "content": "Post text",
      "reply_settings": "everyone",
      "as_carousel": false,
      "carousel_name": null,
      "thread": ["optional extra tweet"]
    }
  ],
  "media": [
    {
      "id": "uuid",
      "filename": "image.png",
      "path": "media/uuid.png",
      "url": "https://cdn.example.com/media/uuid.png",
      "type": "image"
    }
  ],
  "state": "scheduled",
  "publish_at": 1767139200000,
  "channel_group": "personal"
}
```

Rules:

- `targets` is required and must contain at least 1 target.
- Target `platform` must be one of the values returned by the channel/platform APIs.
- Reddit targets require `reddit_title`, `subreddit`, and `reddit_post_type` (`self` or `link`). Link posts also require `reddit_url`; `flair_id`, `nsfw`, and `spoiler` are optional.
- `state` must be `draft` or `scheduled`.
- If `state` is `scheduled` but `publish_at` is missing/null, post is stored as `draft`.
- `channel_group` is optional: `personal | company` (default: `personal`).
- With the team owner’s `auto_publish` OFF (default), scheduling requires approval. At `publish_at`, the post moves to `awaiting_approval` and the configured Telegram approver receives the exact profiles, copy, threads, and media.
- Only **Approve & publish** in the authenticated Telegram packet releases platform calls. Rejecting returns the post to draft; editing, rescheduling, or deleting invalidates the pending snapshot.

Responses:

- `201` `PostWithDetails`
- `400` `{ "error": "<validation error>" }`

### `PATCH /api/posts`

Update a post. Replaces all targets and media.

Body: same as POST plus `id`.

```json
{
  "id": "post-id",
  "targets": [{ "platform": "linkedin", "content": "Updated content" }],
  "state": "draft",
  "publish_at": null
}
```

Responses:

- `200` `PostWithDetails`
- `400` `{ "error": "<validation error>" }`
- `404` `{ "error": "Not found" }`

### `DELETE /api/posts`

Delete a post.

Body:

```json
{ "id": "post-id" }
```

Responses:

- `200` `{ "ok": true }`
- `400` `{ "error": "<validation error>" }`
- `404` `{ "error": "Not found" }`

### `POST /api/posts/schedule`

Schedule a generated post and close the linked idea.

Body:

```json
{
  "id": "post-id",
  "publish_at": 1772074949000,
  "media": [
    {
      "id": "uuid",
      "filename": "cover.png",
      "path": "media/cover.png",
      "url": "https://cdn.example.com/media/cover.png",
      "type": "image"
    }
  ]
}
```

Rules:

- `id` is required.
- `publish_at` is required (Unix ms).
- `media` is optional and appended to the post.
- This endpoint expects the convert flow (`post.id === idea.id`) so it can close the idea.

Responses:

- `200`
```json
{
  "postId": "post-id",
  "scheduledAt": "2026-02-26T03:02:29.000Z"
}
```
- `404` `{ "error": "Post not found" }`
- `404` `{ "error": "Idea not found for this post id" }`
- `400` validation errors

---

## Ideas API

Endpoint: `/api/ideas`

### `GET /api/ideas`

List ideas.

Response:

- `200` `Idea[]`

Notes:

- Sorted with open ideas first, then by `updated_at` descending.

### `GET /api/ideas?id=<ideaId>`

Get a single idea.

Responses:

- `200` `Idea`
- `404` `{ "error": "Not found" }`

### `POST /api/ideas`

Create an idea.

Body:

```json
{
  "text": "Idea text",
  "status": "open"
}
```

Rules:

- `text` required.
- `status` optional, allowed: `open | closed`.

Responses:

- `201` `Idea`
- `400` `{ "error": "text is required" }`
- `400` `{ "error": "status must be open or closed" }`

### `PATCH /api/ideas`

Update an idea.

Body:

```json
{
  "id": "idea-id",
  "text": "Updated idea text",
  "status": "closed"
}
```

Rules:

- `id` required
- `text` required
- `status` optional (`open | closed`)

Responses:

- `200` `Idea`
- `400` validation errors
- `404` `{ "error": "Not found" }`

### `DELETE /api/ideas`

Delete an idea.

Body:

```json
{ "id": "idea-id" }
```

Responses:

- `200` `{ "ok": true }`
- `400` `{ "error": "id is required" }`
- `404` `{ "error": "Not found" }`

### `POST /api/ideas/convert-to-post`

Convert one idea into generated post content using:

- matched template from idea text (e.g. `Templates: 006, 009`)
- default brand profile voice/audience/guidelines
- selected AI model (default: `gpt-4o-mini`)

Body:

```json
{
  "ideaId": "uuid",
  "model": "gpt-4o-mini",
  "cover": "meme",
  "cover_style": "pixel"
}
```

Rules:

- `ideaId` required.
- If `cover` is missing, no cover generation/suggestion is attempted.
- If `cover` is provided, the API generates one DALL-E cover image, uploads it, and attaches it to the draft post media (best effort).
- Creates or refreshes a draft post whose id is the same as `ideaId`.
- LinkedIn target stores full generated content.
- Twitter target stores first tweet + continuation `thread` (max 280 chars per chunk).

Response:

```json
{
  "content": "Full generated post text...",
  "thread": ["tweet 1", "tweet 2"],
  "id": "post-id",
  "templateUsed": "006-type-problem-solution",
  "media": [
    {
      "id": "uuid",
      "filename": "uuid.png",
      "path": "media/uuid.png",
      "url": "https://cdn.example.com/media/uuid.png",
      "type": "image"
    }
  ],
  "coverImageSuggestion": {
    "title": "....",
    "description": "....",
    "prompt": "DALL-E prompt..."
  }
}
```

Errors:

- `404` `{ "error": "Idea not found" }`
- `400` validation errors
- `500` `{ "error": "<message>" }`

---

## Upload API

Endpoint: `/api/upload`

### `POST /api/upload`

Upload image/video as `multipart/form-data`.

Form field:

- `file` (required)

Response:

```json
{
  "id": "uuid",
  "filename": "uuid.png",
  "path": "media/uuid.png",
  "url": "https://cdn.example.com/media/uuid.png",
  "type": "image"
}
```

Status codes:

- `200` success
- `400` `{ "error": "No file provided" }`

Use this object as an item in `media[]` for `/api/posts`.

---

## AI Generate API

Endpoint: `/api/ai`

### `POST /api/ai`

Generate post content as a streaming text response.

Body:

```json
{
  "prompt": "Write a post about async job retries",
  "platform": "linkedin",
  "tone": "engaging",
  "model": "gpt-5",
  "existingContent": "optional draft text",
  "brandProfileId": "optional-brand-id",
  "templateId": "optional-template-id"
}
```

Required fields:

- `prompt`
- `platform`
- `model`

Expected model values:

- `gpt-5`
- `gemini-flash`

Response:

- `200` streamed `text/plain; charset=utf-8` (chunked)

Errors:

- `400` `{ "error": "prompt, platform, and model are required" }`
- `500` `{ "error": "<message>" }`

---

## Assistant API (SSE, Tool Calling)

Endpoint: `/api/assistant`

### `POST /api/assistant`

Chat endpoint with AG-UI SSE stream + server tools.

Body:

```json
{
  "messages": [
    { "role": "user", "content": "Turn this idea into 3 drafts: ... " }
  ],
  "data": {
    "brandId": "optional-brand-id",
    "postContent": "optional-current-post-content"
  }
}
```

Response:

- `200` Server-Sent Events stream (`text/event-stream`) in AG-UI format

Configured tool set:

- `suggestPosts`
- `convertToTwitter`
- `suggestCoverImages`
- `generateCoverImage`
- `schedulePost`

Common tool result payload shapes:

- `suggestPosts`:
```json
{
  "suggestions": [
    { "templateName": "Problem -> Solution", "content": "...", "thread": [] }
  ]
}
```

- `convertToTwitter`:
```json
{ "content": "first tweet", "thread": ["second tweet"] }
```

- `suggestCoverImages`:
```json
{
  "suggestions": [
    { "title": "Idea", "description": "...", "prompt": "...", "type": "serious" }
  ]
}
```

- `generateCoverImage`:
```json
{
  "id": "uuid",
  "filename": "uuid.png",
  "path": "media/uuid.png",
  "url": "https://...",
  "type": "image",
  "title": "Cover title"
}
```

- `schedulePost`:
```json
{
  "postId": "uuid",
  "scheduledAt": "2026-03-01T17:00:00.000Z",
  "scheduledDisplay": "Sun, Mar 1, 12:00 PM"
}
```

---

## Cron Approval API

Endpoint: `/api/cron`

### `GET /api/cron`

Processes due scheduled posts (`publish_at <= now`). The team owner’s default-off `auto_publish` preference enables direct publishing; otherwise it creates and delivers Telegram approval packets.

Response:

```json
{ "due": 3, "queued": 3, "delivered": 3, "failed": 0 }
```

Status codes:

- `200` success

---

## Response Types

### `PostWithDetails`

```json
{
  "id": "uuid",
  "state": "scheduled",
  "channel_group": "personal",
  "publish_at": 1767139200000,
  "created_at": 1767135600000,
  "updated_at": 1767135600000,
  "targets": [
    {
      "id": "uuid",
      "post_id": "uuid",
      "platform": "twitter",
      "content": "text",
      "platform_post_id": null,
      "error": null,
      "reply_settings": "everyone",
      "as_carousel": false,
      "carousel_name": null,
      "thread": ["..."]
    }
  ],
  "media": [
    {
      "id": "uuid",
      "post_id": "uuid",
      "filename": "file.png",
      "path": "media/file.png",
      "url": "https://...",
      "type": "image"
    }
  ]
}
```

### `Idea`

```json
{
  "id": "uuid",
  "text": "idea text",
  "status": "open",
  "created_at": 1767135600000,
  "updated_at": 1767135600000
}
```

## Notes for External Agents

- This reference intentionally excludes server functions/internal utilities.
- All timestamps are Unix milliseconds unless otherwise noted.
- For `/api/assistant` and `/api/ai`, consume streaming responses (not a single final JSON payload).


## Scheduled Auto-Publishing

`GET /api/settings` returns `{ "auto_publish": false }`. `PATCH /api/settings` accepts `{ "auto_publish": true }` or `false`, authenticated by a session or team API key. The preference belongs to the current user / API key creator. No user ID is accepted. Default OFF. The toggle is under Settings → Notifications.

Posts belong to teams, not individual authors. Cron uses the existing system requester: the team owner, falling back to the first member. If that user's `auto_publish` is ON, due scheduled posts publish directly through the existing publisher with an atomic state claim. Otherwise Telegram approval is unchanged. Existing `awaiting_approval` posts still require approval.

For multi-platform video, upload one MP4 via multipart `POST /api/upload`, field `file`, and reuse its returned object in shared `media[]`. Supported IDs: `twitter | linkedin | instagram | facebook | youtube | reddit | discord | telegram`; Telegram has no direct social publisher, and Reddit supports text/link posting rather than native video uploads. Use `targets[].channel_id` for a specific Content Hub channel ID, or omit it for the platform/group default.

YouTube takes the first nonempty `content` line as its title (truncated to 100 characters), and the entire content as its description (sliced to 5000 characters). Respect the provider's 5000 UTF-8 byte description limit and avoid `<` and `>`. Privacy comes from channel credentials and defaults to private.

For a shared MP4, use H.264/AAC and 3–140 seconds; vertical or 16:9 can publish to all five video destinations. Prefer compressed files below 20 MB because the Worker buffers uploads and multiple publisher downloads; this is operational guidance, not an enforced application cap. Destination limits include X 512 MB/140 seconds, LinkedIn 75 KB–500 MB/3 seconds–30 minutes, Instagram Reels 1 GB/3 seconds–15 minutes (9:16 recommended, landscape supported). Upload does not inspect size/duration/codecs, and the HTTP posts API does not invoke the editor's `lib/validation.ts` checks. See the Content Hub skill API reference for the five-target payload and limits.
