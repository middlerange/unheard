# HTTP fallback and media

Use the same deployment as the MCP connection. Configure these environment variables locally or in the agent client's secret store:

```sh
export CONTENT_HUB_BASE_URL="https://content.example.com"
# Set CONTENT_HUB_API_KEY through your secret manager or a private local environment.
```

Never commit the key. The examples require a shell that already has `CONTENT_HUB_API_KEY` set; do not print its value. All API requests use `Authorization: Bearer ${CONTENT_HUB_API_KEY}`. Timestamps are Unix **milliseconds**.

## Discover and invoke

```sh
curl --fail-with-body "${CONTENT_HUB_BASE_URL%/}/api/agent" \
  -H "Authorization: Bearer ${CONTENT_HUB_API_KEY}"
```

Discovery returns available resources/actions and endpoint information. Invoke actions with `POST /api/agent`; successful responses are `{ "ok": true, "result": ... }`:

```sh
curl --fail-with-body "${CONTENT_HUB_BASE_URL%/}/api/agent" \
  -H "Authorization: Bearer ${CONTENT_HUB_API_KEY}" \
  -H "Content-Type: application/json" \
  --data '{"resource":"channels","action":"list","input":{}}'
```

Useful invocations:

| Resource | Action | Input |
| --- | --- | --- |
| `ideas` | `list` | `{}` |
| `ideas` | `create` | `{ "text": "Idea text" }` |
| `ideas` | `setStatus` | `{ "id": "idea-id", "status": "open" }` or `"closed"` |
| `posts` | `list` | `{ "states": ["draft", "scheduled"] }` (omit `states` for all) |
| `posts` | `get` | `{ "id": "post-id" }` |
| `posts` | `schedule` | `{ "id": "post-id", "publish_at": <future Unix ms> }` |
| `posts` | `requestApproval` | `{ "id": "post-id" }` |
| `brands`, `templates`, `channels` | `list` | `{}` |
| `postApprovals` | `get` | `{ "id": "post-id" }` |

For `posts.create`, use a payload such as:

```json
{
  "resource": "posts",
  "action": "create",
  "input": {
    "state": "draft",
    "publish_at": null,
    "targets": [
      { "platform": "linkedin", "channel_id": "channel-id-from-list", "content": "Draft copy" }
    ],
    "media": []
  }
}
```

`posts.update` uses the same input plus the post `id`. It is a **full replacement**, including `targets` and `media`. Start from `posts.get`, carry forward intended `channel_group`, `template_id`, `writing_prompt`, `idea_id`, and `brand_id`, and send every desired target and media record. Targets accept `platform`, `channel_id`, `content`, `reply_settings`, `as_carousel`, `carousel_name`, `thread`, and platform-specific fields where applicable. Do not copy database target IDs or publishing/error fields into target inputs. For media assigned to a channel, preserve routing using `target_channel_id`; shared media has no target. Prefer the `schedule` action for scheduling alone, because it preserves all existing relations.

## Upload media

```sh
curl --fail-with-body "${CONTENT_HUB_BASE_URL%/}/api/upload" \
  -H "Authorization: Bearer ${CONTENT_HUB_API_KEY}" \
  -F "file=@/absolute/path/to/asset.mp4"
```

The upload returns `id`, `filename`, `path`, `url`, and `type`. Include these fields in `media` when creating/updating a post. Preserve the returned `path` and `url`; do not construct storage URLs. Uploading an asset does not create or publish a post. Validate the destination platform's media requirements before scheduling.

OAuth access tokens work on `/mcp` and `/api/agent`, but `/api/upload` and `/api/ideas/convert-to-post` require a team API key (or an app session). An OAuth-only connection needs a team API key for these HTTP operations.

## Optional AI idea conversion

`POST /api/ideas/convert-to-post` accepts `{ "ideaId": "idea-id" }`, with optional `model`, `cover` (`"meme"` or `"serious"`), and `cover_style`. It requires the deployment's AI provider configuration and may incur provider charges. The response includes the resulting draft `id`, `content`, `thread`, and media. Use `posts.schedule` through `/api/agent` (or the MCP schedule action) for the returned post.

The separate legacy `/api/posts/schedule` endpoint requires a converted idea with the same ID as the post. Do not use it for arbitrary drafts. Use `/api/agent` scheduling instead.

## Failures and verification

An HTTP `401` means missing/invalid credentials; `403` can indicate insufficient scope. Verify the origin and the API key's deployment/team before retrying. Validation errors include the failing fields; fix the payload rather than repeating it. After an uncertain create/schedule/approval result, read back first. After saving, fetch the post and check state, `publish_at`, target channel IDs, copy, and media; report a failed or awaiting-approval state accurately.
