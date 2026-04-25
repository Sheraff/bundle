# Staging Improvement Plan

Chunk Scope is still pre-production with no users. These tasks should optimize for the cleanest implementation rather than backwards compatibility. Breaking internal package names, smoke-test workflow shape, staging data, and unpublished interfaces is acceptable.

Status: completed on staging. Remaining later work is limited to registry publication, PKCS#8 config validation, staging data cleanup, and final internal `bundle` naming cleanup.

## Goals

1. Make the real Vite package-build smoke test representative of a normal consumer setup.
2. Make staging deploys safe and repeatable.
3. Make setup and operational status visible without direct D1 queries.
4. Improve GitHub publication reliability and observability.
5. Remove known CI/runtime deprecation warnings for the Chunk Scope action.

## Tasks

1. Add safe staging deployment scripts.
   - Add `staging:build` that always sets `CLOUDFLARE_ENV=staging`.
   - Add `staging:deploy` that builds and deploys staging.
   - Add `staging:verify` for health, D1, and publication checks.
   - Add a deploy guard that verifies generated Wrangler config points at staging resources.

2. Package the Vite plugin.
   - Choose the public package name.
   - Add compiled JS and declaration output.
   - Export built files instead of TypeScript source.
   - Remove workspace-only assumptions where possible.
   - Validate consuming the package from outside the monorepo.

3. Version the GitHub Action.
   - Keep packaged `dist/index.js` committed.
   - Create a staging release channel or tag.
   - Update snippets and smoke workflows to stop depending on moving `main` once the channel exists.

4. Replace the smoke workaround.
   - Install the packaged Chunk Scope Vite plugin in `Sheraff/bundle-test`.
   - Import the plugin by package name from `vite.config.ts`.
   - Remove the second checkout and esbuild bundling step.
   - Keep running the action with `command: pnpm build`.
   - Re-validate push and PR smoke paths.

5. Improve setup UX and repository status UI.
   - Add a GitHub App setup guide with exact URLs, permissions, and events.
   - Improve repository enablement copy and workflow snippet.
   - Show latest upload, processing, and publication status on repository settings.
   - Link to workflow run, PR comment, check run, and public compare pages when available.

6. Add publication observability.
   - Add structured logs for publish queue handling.
   - Include repository, PR, surface, selected summary SHA, PR head SHA, and external publication IDs.
   - Make stale or superseded publish messages explicit no-ops.
   - Surface terminal publication errors in repository settings.

7. Move the GitHub Action runtime to Node 24.
   - Update action metadata.
   - Verify the bundled action runs under Node 24.
   - Re-run the smoke workflows and confirm our action no longer contributes a Node 20 deprecation warning.

## Acceptance Criteria

- `Sheraff/bundle-test` uses a normal package install for the Vite plugin.
- The smoke workflow uses a stable action ref.
- Push and PR smoke workflows pass.
- Staging records processed scenario runs and published PR comment/check rows for the latest PR head.
- Repository settings show actionable setup/status information without manual D1 queries.
- Staging can be built, deployed, and verified with scripts.
- Web tests, typecheck, package builds, and smoke checks pass.
