# Release process

The public repository is [middlerange/unheard](https://github.com/middlerange/unheard).
Its initial commit is a clean source snapshot, with no private repository history,
local accounts, exports, environments, personal brand prompts, or recordings.

## Verify a release

```sh
npm ci
npm test
npm run build
npm run typecheck
```

Unit tests include an empty-database migration check using Python 3 and SQLite.
They need no Cloudflare or social provider credentials. CI runs these checks on
pull requests and pushes.

Before sharing a deployment template, verify a fresh Cloudflare deployment using
the README button: new resources, migrations, signup, setup, media upload, and a
provider connection. Real publishing needs your own test account and provider
permissions. Build and local Worker checks do not prove provider authorization.

## Export a source snapshot

From a development checkout:

```sh
python3 scripts/export-release.py /tmp/unheard-source.zip
# Or supply a new directory instead of a ZIP path.
```

The exporter uses an explicit source allowlist, copies no Git history, and refuses
to overwrite an existing output. It includes the app, migrations, portable skill,
configuration, unit tests, and parameterized login smoke test. It excludes local
state, account databases, exports, private notes, recordings, and legacy automation.
Review the resulting files before publishing; its basic credential checks are not
a complete secret scanner. It reads saved files, including uncommitted changes.

## Deployment smoke tests

The browser checks require an explicit origin and never default to a production
service:

```sh
E2E_BASE_URL=http://localhost:3003 npm run test:e2e
```

The default login checks do not create accounts or posts. An optional sign-in check
runs only when `E2E_TEST_EMAIL` and `E2E_TEST_PASSWORD` name an existing test account.
In GitHub Actions, run **Manual deployment smoke test** with your test deployment
origin. Set those repository secrets only when you want authenticated checks.
