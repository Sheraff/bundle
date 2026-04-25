# Staging User-Flow Feedback

This captures first-pass feedback from exercising the full staging flow with `Sheraff/bundle-test`.

## What Worked

- GitHub App setup URL redirected into Chunk Scope after installation.
- OAuth login completed and created a staging session.
- Installation sync discovered the selected repository.
- Repository enablement worked from the installation page.
- OIDC upload auth worked from GitHub Actions with no repository secret.
- Upload persistence worked across D1 and R2.
- Queue processing reached `processed` status.
- Public repository page rendered the uploaded data.
- PR review publication produced a maintained PR comment and check run after permissions and key format were fixed.

## Friction

- GitHub App creation is easy to misconfigure because setup URL, callback URL, webhook URL, permissions, and events are spread across the form.
- GitHub App permission changes may not prompt immediately. Installation permissions must be verified after changing app permissions.
- GitHub App private keys downloaded from GitHub may need conversion to PKCS#8 before Workers publication can create installation tokens.
- The staging deploy can accidentally use top-level resource names unless `CLOUDFLARE_ENV=staging` is set during the web build.
- The current app UI is functionally correct but visually raw.
- The repository settings page snippet previously used placeholder action syntax and old product naming.
- There is no single command that performs the staging deploy safely.
- Publication failures are visible in Worker tail logs but not surfaced in the UI.

## UX Punch List

1. Add a staging deploy script that always sets `CLOUDFLARE_ENV=staging`.
2. Add a GitHub App setup guide page with exact permissions and URLs.
3. Show a repository setup checklist after app install.
4. Improve the repository enablement page copy and layout.
5. Surface upload status and last publication error in repository settings.
6. Show the exact workflow snippet for the current deploy channel.
7. Add first-class product naming across public pages, admin pages, comments, and checks.
8. Add a smoke-test command or script that verifies D1, R2, queues, workflows, and GitHub publication rows.

## Product Naming Notes

- User-facing staging name is `Chunk Scope`.
- The codebase still has internal package names and some historical resource names using `bundle`.
- Hidden PR comment markers currently keep `bundle-review` for backward-compatible maintained comment lookup.

## Real Package-Build Smoke Test

The real package-build flow now runs in `Sheraff/bundle-test`: the consuming repository runs Vite with the Chunk Scope Vite plugin and then calls the GitHub Action in command mode.

Because `@workspace/vite-plugin` is still private and workspace-scoped, the smoke workflow temporarily checks out `Sheraff/bundle`, bundles `packages/vite-plugin/src/index.ts` with esbuild, and imports the generated `.chunk-scope/vite-plugin.mjs` from `vite.config.ts`.

Required before this can become a normal consumer setup:

1. Rename/publish the Vite plugin package under the final package name.
2. Publish or tag a consumable GitHub Action ref.
3. Configure the test app to install and use the published Chunk Scope Vite plugin directly.
4. Keep the action in command mode with `command: pnpm build`.
