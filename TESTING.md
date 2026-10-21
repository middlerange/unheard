# Testing Guide

## Test Stack

- **Unit Tests**: Vitest (`npm run test`)
- **E2E Tests**: Expect (AI-powered browser testing) (`npm run test:e2e`)
- **Legacy E2E**: Playwright (kept as fallback) (`npm run test:e2e:playwright`)

## Quick Start

```bash
# Unit tests only
npm run test

# E2E with Expect (CI mode - headless)
npm run test:e2e

# E2E with Expect (local - headed, with browser visible)
npm run test:e2e:local

# All tests
npm run test:all
```

## Why Expect?

We switched from Playwright to [Expect](https://github.com/millionco/expect) because:

1. **No brittle selectors** - AI reads your code changes and tests intelligently
2. **Auto-adapts to UI changes** - No more fixing broken selectors after refactor
3. **Broader coverage** - Tests performance (INP, LCP), security, design, and completeness
4. **Faster** - No unnecessary video/screenshot overhead
5. **Agent-native** - Built for AI-assisted workflows

## How Expect Works

1. Reads your git changes (diff)
2. Generates a test plan based on what changed
3. Spawns subagents to test in a real browser (Playwright under the hood)
4. Reports issues so you (or your agent) can fix them

## Legacy Playwright Tests

The old Playwright tests are in `/e2e/` and can still be run:

```bash
npm run test:e2e:playwright
npm run test:e2e:ui      # With UI mode
npm run test:e2e:debug   # Debug mode
```

We're migrating these to Expect over time. If Expect misses an edge case, you can:
1. Run the legacy Playwright test
2. Add a custom Expect flow
3. File an issue with the Expect team

## Configuration

- `.expectrc.json` - Expect configuration
- `playwright.config.ts` - Legacy Playwright configuration

## CI/CD

GitHub Actions runs Expect in CI mode on every PR:
- Headless browser
- No cookie extraction
- 30-minute timeout
- Auto-approves test plan

See `.github/workflows/expect.yml`
