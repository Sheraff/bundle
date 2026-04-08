# Bundle Workspace

This repo contains the V1 product workspace plus a local research lab that stays in the workspace intentionally.

## Layout

- `apps/`: product applications. Today this is `apps/web`, the hosted app and worker surface.
- `packages/`: shared product packages for contracts, the Vite plugin, and the GitHub Action.
- `research/`: local research harnesses and fixture apps. `research/stable-identity/` is intentionally kept in the workspace, but it is not shipped product code.
- root `*.md` files: product specs and implementation notes for V1.

## Root Commands

Use these from the repo root for product checks:

- `pnpm typecheck`: typechecks `@workspace/contracts`, `@workspace/vite-plugin`, `@workspace/github-action`, and `@workspace/web`.
- `pnpm test`: runs the product test suites for the same four workspace packages.
- `pnpm check`: runs both product typechecks and product tests.

Research commands stay separate so product checks do not run the lab unless requested:

- `pnpm research:test`
- `pnpm stable-identity:build-fixtures`
- `pnpm stable-identity:refresh`

## Docs

- Start with `docs/README.md` for the docs index.
- The normative V1 docs live at the repo root.
- `research/stable-identity/README.md` explains the stable-identity lab and fixture corpus.
