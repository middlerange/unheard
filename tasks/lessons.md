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
