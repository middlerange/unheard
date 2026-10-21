# Content Hub — Build Session Notes

## What We Built

A bare-bones full-stack app to draft, schedule, and post content to Twitter and LinkedIn.
No auth, single user, SQLite database, local disk for media.

**Stack:** TanStack Start v1.161.1 + SQLite (better-sqlite3) + shadcn/ui + TipTap + OpenAI/Gemini

---

## Project Structure

```
app/
  routes/
    __root.tsx          # Root layout with sidebar + HTML shell
    index.tsx           # Redirects to /calendar
    calendar.tsx        # Monthly calendar view (default)
    drafts.tsx          # Drafts list view
    api/
      upload.ts         # Media upload endpoint
      ai.ts             # AI generation endpoint (streaming)
  server-fns/
    posts.ts            # CRUD server functions (createServerFn)
  styles/
    globals.css         # Tailwind v4 + oklch dark theme + TipTap styles

lib/
  db.ts                 # SQLite schema, typed helpers
  twitter.ts            # Twitter OAuth 1.0a posting
  linkedin.ts           # LinkedIn posting (image + carousel support)
  publisher.ts          # Fans out to Twitter + LinkedIn
  scheduler.ts          # node-cron every minute
  ai.ts                 # OpenAI GPT-4o + Gemini Flash streaming

components/
  post-modal/
    PostModal.tsx        # Main create/edit dialog
    TwitterSettings.tsx  # Reply settings, premium thread toggle
    LinkedInSettings.tsx # Carousel toggle
    SchedulePicker.tsx   # Date/time picker
    MediaUpload.tsx      # File upload with preview
  calendar/
    CalendarView.tsx     # Monthly grid with dayjs
    PostCard.tsx         # Mini post card in day cell
  editor/
    PostEditor.tsx       # TipTap editor with char count
  ai/
    AIPanel.tsx          # Prompt + tone + model switcher + streaming output

scripts/
  scheduler.ts          # Standalone entry: calls startScheduler()
```

---

## TanStack Start v1 — Critical Setup

### Config file MUST be `vite.config.mts` (not `.ts`)
The plugin is ESM-only and fails when loaded via `require`. `.mts` forces ESM.

```typescript
// vite.config.mts
import { tanstackStart } from '@tanstack/react-start/plugin/vite';
import { defineConfig } from 'vite';
import viteTsConfigPaths from 'vite-tsconfig-paths';
import viteReact from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  server: { port: 3000 },
  plugins: [
    tailwindcss(),
    viteTsConfigPaths({ projects: ['./tsconfig.json'] }),
    tanstackStart({ srcDirectory: 'app' }),
    viteReact(),
  ],
});
```

### Package.json scripts
```json
"scripts": {
  "dev": "concurrently \"vite dev\" \"tsx scripts/scheduler.ts\"",
  "build": "vite build",
  "start": "node .output/server/index.mjs"
}
```
Use `vite dev` not `vinxi dev`. Scheduler runs as a separate process via `tsx` (not bun).

### Root route uses `shellComponent` (not `component`)
```typescript
export const Route = createRootRoute({
  head: () => ({ meta: [...], links: [{ rel: 'stylesheet', href: appCss }] }),
  shellComponent: Shell,   // <-- not `component`
});

function Shell({ children }) {
  return (
    <html lang="en" className="dark">
      <head><HeadContent /></head>
      <body>
        <Scripts />
      </body>
    </html>
  );
}
```

### Server functions: `.inputValidator()` NOT `.validator()`
```typescript
import { createServerFn } from '@tanstack/react-start';

export const getPosts = createServerFn({ method: 'GET' })
  .inputValidator((d: { states?: string[] } | undefined) => d ?? {})
  .handler(async ({ data }) => {
    return listPostsWithDetails(data.states);
  });
```

### API routes: use `createFileRoute` with `server.handlers`
NOT `createAPIFileRoute` (old alpha API that no longer exists).

```typescript
export const Route = createFileRoute('/api/upload')({
  server: {
    handlers: {
      POST: async ({ request }) => { ... }
    }
  },
});
```

### No `'use server'` directive needed
`createServerFn` handles bundling automatically.

---

## SQLite + better-sqlite3

ABI mismatch: better-sqlite3 compiles for Node.js ABI 141, Bun expects ABI 127 — incompatible.

- Vite dev server runs under Node.js → works fine
- Scheduler must run with `tsx` (Node.js), not `bun`
- Any one-off scripts: run with `node -r tsx/register` or `tsx`

---

## Environment Variables

```env
# Twitter — Bearer Token CANNOT post. Need OAuth 1.0a credentials.
TWITTER_API_KEY=
TWITTER_API_SECRET=
TWITTER_ACCESS_TOKEN=
TWITTER_ACCESS_TOKEN_SECRET=
TWITTER_PREMIUM=false
VITE_TWITTER_PREMIUM=false   # Client-side Vite convention (not NEXT_PUBLIC_)

# LinkedIn — needs w_member_social scope
LINKEDIN_ACCESS_TOKEN=

# AI
OPENAI_API_KEY=
GEMINI_API_KEY=
```

### Twitter note
Bearer Token is app-only/read-only. To post tweets you need OAuth 1.0a:
- API Key + API Secret (from developer.twitter.com app settings)
- Access Token + Access Token Secret (from "Keys and Tokens" tab)

---

## Packages That Don't Work / Gotchas

| Package | Issue |
|---------|-------|
| `nitro` (standalone) | Its Vite plugin crashes with `Cannot read properties of undefined (reading 'meta')` — do not use `nitro/vite` |
| `vinxi` | Installed as transitive dep but don't use directly — use `vite dev` |
| `@tanstack/react-start/config` | Doesn't exist in v1. Use `@tanstack/react-start/plugin/vite` |
| `createAPIFileRoute` | Old alpha API, removed. Use `createFileRoute` with `server.handlers` |

---

## Errors Encountered and Fixed

| Error | Cause | Fix |
|-------|-------|-----|
| `@tanstack/react-start/config` not found | Wrong import path | Use `@tanstack/react-start/plugin/vite` |
| ESM-only package error | `vite.config.ts` loaded as CJS | Rename to `vite.config.mts` |
| `nitro/vite` crashes | Broken standalone package | Remove it; run scheduler with `tsx` separately |
| `createAPIFileRoute` not found | Old alpha API | Use `createFileRoute` with `server.handlers` |
| `.validator() is not a function` | Wrong method name | Use `.inputValidator()` |
| better-sqlite3 ABI mismatch | Bun vs Node.js ABI difference | Run scripts with `tsx` (Node.js) |
| `useRouter is not defined` | Removed import but left usage | Remove the `const router = useRouter()` line |
| `process.env.NEXT_PUBLIC_*` undefined | Next.js convention in Vite | Use `import.meta.env.VITE_*` |

---

## First Commit

```
e6d5841 — initial commit: TanStack Start app with calendar, drafts, post modal, AI panel
48 files changed
```

---

## What Still Needs Testing

1. Twitter posting with real OAuth 1.0a credentials
2. LinkedIn posting — verify `w_member_social` scope on your access token
3. LinkedIn carousel (image-to-PDF conversion)
4. AI streaming in AIPanel
5. Media upload + attach to posts
6. Scheduler triggering on due posts

---

## Source Reference

Postiz codebase analyzed at: `/Users/mukesh/Downloads/postiz-app`
(Used as reference for LinkedIn carousel + UI patterns)
