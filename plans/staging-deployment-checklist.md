# Staging Deployment Checklist

This checklist covers the first staging deployment for internal smoke tests.

1. Decide the staging origin.
   - Use either a `workers.dev` URL or a custom staging domain.

2. Add `env.staging` to `apps/web/wrangler.jsonc`.

3. Provision staging Cloudflare resources.
   - D1 database.
   - R2 bucket for `RAW_UPLOADS_BUCKET`.
   - R2 bucket for `CACHE_BUCKET`.
   - Six Queues.
   - Two Workflows.

4. Fill `env.staging` Cloudflare bindings.
   - `vars`.
   - `d1_databases`.
   - `r2_buckets`.
   - `queues`.
   - `workflows`.

5. Create and configure a GitHub App for staging.
   - App name, for example `Bundle Staging`.
   - Homepage URL: `${PUBLIC_APP_ORIGIN}`.
   - Callback URL: `${PUBLIC_APP_ORIGIN}/api/v1/auth/github/callback`.
   - Webhook URL: `${PUBLIC_APP_ORIGIN}/api/v1/github/webhooks`.
   - Generate and record a staging webhook secret.
   - Generate and record a staging private key.
   - Record the client ID and generate a client secret.
   - Record the app slug.
   - Record the app ID.

6. Configure GitHub App permissions.
   - Repository metadata: read.
   - Repository contents: read.
   - Pull requests: read.
   - Issues: read/write, for PR comments.
   - Checks: read/write, for check runs.

7. Configure GitHub App webhook events.
   - Installation.
   - Installation repositories.
   - Repository.
   - Pull request, if PR metadata updates need to be synced from webhooks.

8. Fill `env.staging.vars`.
   - `PUBLIC_APP_ORIGIN`.
   - `GITHUB_APP_ID`.
   - `GITHUB_APP_CLIENT_ID`.
   - `GITHUB_APP_SLUG`.
   - `GITHUB_OIDC_AUDIENCE`.

9. Configure staging secrets with `wrangler secret put --env staging`.
   - `GITHUB_APP_PRIVATE_KEY`.
   - `GITHUB_APP_CLIENT_SECRET`.
   - `GITHUB_WEBHOOK_SECRET`.
   - `SESSION_SIGNING_SECRET`.
   - `AUTH_ENCRYPTION_KEY`.
   - `UPLOAD_TOKEN_SIGNING_SECRET`.

10. Apply D1 migrations to the remote staging database with `--env staging`.

11. Regenerate Worker types for staging config if needed.

12. Run local pre-deploy checks.
   - Web typecheck.
   - Web tests.
   - Web build.
   - GitHub Action typecheck, test, and build.

13. Deploy the staging Worker with `wrangler deploy --env staging`.

14. Smoke-test the deployed Worker.
   - `GET /healthz`.
   - GitHub OAuth login start.
   - GitHub OAuth callback after installing or logging in.
   - GitHub webhook delivery from the App settings page, if available.

15. Build and package the GitHub Action.
   - Ensure `packages/github-action/dist/index.js` is current.
   - Make it reachable from the public test repo via a repo/path/ref or published action location.

16. Install the staging GitHub App on the public test repo.

17. Log into the staging Bundle app and enable the public test repo.

18. Add a simple workflow to the public test repo.
   - `permissions: contents: read`.
   - `permissions: id-token: write`.
   - `BUNDLE_API_ORIGIN: ${PUBLIC_APP_ORIGIN}`.
   - `BUNDLE_OIDC_AUDIENCE` only if different from `PUBLIC_APP_ORIGIN`.

19. Trigger the test repo workflow.

20. Verify end-to-end results.
   - OIDC token exchange succeeds.
   - Upload endpoint accepts the run.
   - Raw upload lands in R2.
   - Metadata lands in D1.
   - Queues and workflows process the run.
   - Repository pages render data.
   - PR comment and check publication works, if running on a PR.
