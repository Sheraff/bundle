# Staging Deployment Runbook

This runbook captures the first successful Chunk Scope staging deployment and smoke-test flow.

## Current Staging

- Worker origin: `https://chunk-scope-web-staging.me-b16.workers.dev`.
- Worker name: `chunk-scope-web-staging`.
- Cloudflare account ID: `b16d4b5f4dd69d536206d7e39acb71c9`.
- D1 database: `chunk-scope-staging`.
- Raw uploads bucket: `chunk-scope-staging-raw-uploads`.
- Cache bucket: `chunk-scope-staging-cache`.
- GitHub App slug: `chunk-scope-staging`.
- GitHub App installation used for smoke tests: `126820371`.
- Smoke-test repository: `Sheraff/bundle-test`.

## Cloudflare Resources

Provision these resources before deploy:

- D1: `chunk-scope-staging`.
- R2: `chunk-scope-staging-raw-uploads`.
- R2: `chunk-scope-staging-cache`.
- Queue: `chunk-scope-staging-normalize-run`.
- Queue: `chunk-scope-staging-derive-run`.
- Queue: `chunk-scope-staging-schedule-comparisons`.
- Queue: `chunk-scope-staging-materialize-comparison`.
- Queue: `chunk-scope-staging-refresh-summaries`.
- Queue: `chunk-scope-staging-publish-github`.
- Workflow: `chunk-scope-staging-commit-group-settlement`.
- Workflow: `chunk-scope-staging-pr-publish-debounce`.

The workflows are provisioned/attached by Worker deploy when present in `apps/web/wrangler.jsonc`.

## GitHub App Configuration

Create a GitHub App named `Chunk Scope Staging`.

Use these URLs:

- Homepage URL: `https://chunk-scope-web-staging.me-b16.workers.dev`.
- Callback URL: `https://chunk-scope-web-staging.me-b16.workers.dev/api/v1/auth/github/callback`.
- Setup URL: `https://chunk-scope-web-staging.me-b16.workers.dev/api/v1/github/setup`.
- Webhook URL: `https://chunk-scope-web-staging.me-b16.workers.dev/api/v1/github/webhooks`.

Required repository permissions:

- Metadata: read.
- Contents: read.
- Pull requests: read/write.
- Issues: read/write.
- Checks: read/write.

Important: GitHub may not prompt after changing app permissions. Verify the installed app permission actually changed to `pull_requests: write` before testing PR publication.

Recommended webhook events:

- Repository.
- Pull request.
- Installation and installation repositories if they appear in the GitHub App UI.

## Secrets

Configure these Cloudflare secrets on `--env staging`:

- `GITHUB_APP_PRIVATE_KEY`.
- `GITHUB_APP_CLIENT_SECRET`.
- `GITHUB_WEBHOOK_SECRET`.
- `SESSION_SIGNING_SECRET`.
- `AUTH_ENCRYPTION_KEY`.
- `UPLOAD_TOKEN_SIGNING_SECRET`.

Generate app-owned secrets with random values:

```bash
openssl rand -base64 48 | pnpm --dir apps/web exec wrangler secret put SESSION_SIGNING_SECRET --env staging
openssl rand -base64 48 | pnpm --dir apps/web exec wrangler secret put AUTH_ENCRYPTION_KEY --env staging
openssl rand -base64 48 | pnpm --dir apps/web exec wrangler secret put UPLOAD_TOKEN_SIGNING_SECRET --env staging
```

Convert the GitHub App private key to PKCS#8 before uploading. The Octokit JWT library rejects PKCS#1 keys in Workers.

```bash
tmp=$(mktemp)
openssl pkcs8 -topk8 -nocrypt -in /path/to/github-app.private-key.pem -out "$tmp"
pnpm --dir apps/web exec wrangler secret put GITHUB_APP_PRIVATE_KEY --env staging < "$tmp"
rm -f "$tmp"
```

## Migrations

D1 migrations live in `apps/web/drizzle`, not Wrangler's default `migrations` directory.

Each D1 binding in `wrangler.jsonc` must include:

```jsonc
"migrations_dir": "drizzle"
```

Apply remote staging migrations with:

```bash
pnpm --dir apps/web exec wrangler d1 migrations list DB --env staging --remote
pnpm --dir apps/web exec wrangler d1 migrations apply DB --env staging --remote
```

## Build And Deploy

The Cloudflare Vite plugin reads Wrangler environments at build time. Always set `CLOUDFLARE_ENV=staging` for staging builds and deploys.

```bash
CLOUDFLARE_ENV=staging pnpm --filter @workspace/web build
CLOUDFLARE_ENV=staging pnpm --dir apps/web exec wrangler deploy --env staging
```

If `CLOUDFLARE_ENV=staging` is omitted during build, the generated `dist/server/wrangler.json` uses top-level resources and deploy can accidentally provision/use production-shaped resource names.

## Pre-Deploy Checks

Run these before deployment:

```bash
pnpm --filter @workspace/web typecheck
pnpm --filter @workspace/web test
pnpm --filter @workspace/web build
pnpm --filter @workspace/github-action typecheck
pnpm --filter @workspace/github-action test
pnpm --filter @workspace/github-action build
```

## Smoke-Test Workflow

The smoke-test repository currently uses `Sheraff/bundle/packages/github-action@main`.

Minimal required permissions:

```yaml
permissions:
  contents: read
  id-token: write
```

Minimal required environment:

```yaml
env:
  BUNDLE_API_ORIGIN: https://chunk-scope-web-staging.me-b16.workers.dev
```

Current smoke-test mode uses a tiny Vite app in `Sheraff/bundle-test`. Until the Vite plugin is published, the workflow checks out this repository, bundles the plugin source with esbuild, imports that local bundle from `vite.config.ts`, then runs `pnpm build` through the GitHub Action command mode. This validates the real package-build path plus OIDC, upload auth, raw object persistence, D1 persistence, queue processing, page rendering, PR summaries, PR comments, and checks.

## Verification Commands

Health and OAuth redirect:

```bash
curl -sS https://chunk-scope-web-staging.me-b16.workers.dev/healthz
curl -sS -o /dev/null -w '%{http_code} %{redirect_url}\n' \
  'https://chunk-scope-web-staging.me-b16.workers.dev/api/v1/auth/github/start'
```

D1 checks:

```bash
pnpm --dir apps/web exec wrangler d1 execute DB --env staging --remote \
  --command 'SELECT owner, name, enabled, visibility FROM repositories;'

pnpm --dir apps/web exec wrangler d1 execute DB --env staging --remote \
  --command 'SELECT id, status, scenario_id, commit_sha, pull_request_id, uploaded_at FROM scenario_runs ORDER BY uploaded_at DESC LIMIT 5;'

pnpm --dir apps/web exec wrangler d1 execute DB --env staging --remote \
  --command 'SELECT COUNT(*) AS count FROM series_points;'

pnpm --dir apps/web exec wrangler d1 execute DB --env staging --remote \
  --command 'SELECT surface, status, external_url, published_head_sha, last_error_code, last_error_message FROM github_publications ORDER BY updated_at DESC LIMIT 5;'
```

R2 raw object check:

```bash
pnpm --dir apps/web exec wrangler r2 object get \
  chunk-scope-staging-raw-uploads/raw/scenario-runs/<scenario-run-id>/artifact.json \
  --remote \
  --file /tmp/chunk-scope-artifact.json
```

PR check:

```bash
gh pr view 1 --repo Sheraff/bundle-test --json comments,statusCheckRollup,headRefOid,url
```

## Debugging Publication

Tail the staging Worker while triggering the publish debounce workflow:

```bash
pnpm --dir apps/web exec wrangler tail chunk-scope-web-staging --format json
```

Manual trigger shape:

```bash
pnpm --dir apps/web exec wrangler workflows trigger chunk-scope-staging-pr-publish-debounce \
  '{"schemaVersion":1,"kind":"PrPublishDebounceWorkflow","repositoryId":"<repository-id>","pullRequestId":"<pull-request-id>","orchestrationKey":"manual-<timestamp>"}' \
  --id manual-pr-publish-<timestamp>
```

Known publication failure modes from first staging:

- PKCS#1 GitHub App private key causes `Private Key is in PKCS#1 format, but only PKCS#8 is supported`.
- Missing `pull_requests: write` causes `Resource not accessible by integration` on PR comment creation.
- GitHub Actions `pull_request` runs may upload the merge commit SHA while PR publication is keyed to the PR head SHA. The publisher now falls back to the latest PR summary for the PR.

## Cleanup

The first failed staging deploy accidentally created top-level R2 buckets because the build used the default environment:

- `bundle-raw-uploads`.
- `bundle-cache`.

They were empty and deleted with:

```bash
pnpm --dir apps/web exec wrangler r2 bucket delete bundle-raw-uploads
pnpm --dir apps/web exec wrangler r2 bucket delete bundle-cache
```
