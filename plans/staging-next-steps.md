# Staging Next Steps

## Immediate

1. Make the Vite plugin consumable outside this workspace.
   - Choose the public package name.
   - Remove workspace-only package assumptions.
   - Add a build output for the package.
   - Publish or otherwise expose a testable install path.

2. Make the GitHub Action consumable by version.
   - Keep packaged `dist/index.js` committed.
   - Create a staging tag or release channel.
   - Update snippets to avoid depending on moving `main` once the flow stabilizes.

3. Replace the temporary real package-build smoke workaround with a normal package install.
   - Install the published Chunk Scope Vite plugin in `Sheraff/bundle-test`.
   - Remove the second checkout and esbuild bundling step.
   - Keep running the action with `command: pnpm build`.
   - Keep verifying D1, R2, queues, repository page, PR comment, and check run.

4. Add deployment scripts.
   - `staging:build` should set `CLOUDFLARE_ENV=staging`.
   - `staging:deploy` should build and deploy with the staging environment.
   - Add a script or document for staging verification queries.

## Product UX

1. Improve the app install and repository enablement pages.
2. Add a setup guide for the GitHub App and workflow snippet.
3. Show latest upload, queue, and publication status on repository settings.
4. Show publication failures from `github_publications` in the UI.
5. Replace remaining internal `bundle` resource/package names when the final package names are chosen.

## Reliability

1. Add automated tests for PR publication when the uploaded run SHA differs from the PR head SHA.
2. Add a test for PKCS#8 private-key validation or a clearer startup/config error.
3. Add observability around queue retries and terminal publication failures.
4. Decide how to handle failed/stale publish queue messages after permission fixes.
5. Add a cleanup/reset path for staging smoke-test data if it becomes noisy.
