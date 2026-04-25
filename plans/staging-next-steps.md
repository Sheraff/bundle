# Staging Next Steps

## Completed

1. Made the Vite plugin consumable outside this workspace.
   - Public package name: `@chunk-scope/vite-plugin`.
   - Build output: `packages/vite-plugin/dist/index.js` and declarations.
   - The package can be installed from the `staging` branch with `git+https://github.com/Sheraff/bundle.git#staging&path:packages/vite-plugin`.
   - A packed tarball was validated in a temporary external project.

2. Made the GitHub Action consumable by staging channel.
   - Packaged `packages/github-action/dist/index.js` is committed.
   - `staging` branch is the staging release channel.
   - Workflow snippets and `Sheraff/bundle-test` use `Sheraff/bundle/packages/github-action@staging`.

3. Replaced the temporary real package-build smoke workaround with a normal package install.
   - `Sheraff/bundle-test` installs `@chunk-scope/vite-plugin` from the `staging` branch.
   - The second checkout and esbuild bundling step were removed.
   - The smoke workflow still runs the action with `command: pnpm build`.
   - Push and PR smoke workflows passed.

4. Added deployment scripts.
   - `pnpm staging:build` sets `CLOUDFLARE_ENV=staging`.
   - `pnpm staging:deploy` builds, validates generated Wrangler config, and deploys staging.
   - `pnpm staging:verify` checks health, repositories, latest scenario runs, and publication rows.

## Product UX Completed

1. Added `/app/setup` with GitHub App URLs, permissions, webhook events, and workflow permissions.
2. Added an admin link to the setup guide.
3. Expanded repository settings with setup checklist, workflow snippet, latest uploads, and latest publication rows.
4. Publication rows show status, external links, published head SHA, and error code/message.

## Reliability Completed

1. Added automated coverage for PR check publication when PR head changes.
2. Fixed PR check publication bookkeeping so the D1 row advances to the latest head/check run.
3. Added structured publish queue logs for message handling, selected summaries, skipped current surfaces, PR comments, and check runs.
4. Moved the GitHub Action runtime to Node 24.
5. Confirmed smoke workflows no longer list the Chunk Scope action in GitHub's Node 20 deprecation warning.

## Remaining Later Work

1. Publish the Vite plugin to the final package registry when ready; staging currently uses a Git subdirectory dependency.
2. Add a PKCS#8 private-key validation test or clearer startup/config error.
3. Add a cleanup/reset path for staging smoke-test data if it becomes noisy.
4. Replace remaining internal `bundle` resource/package names when final package names are chosen.
