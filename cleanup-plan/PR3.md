# PR3 - package boundaries and repo ergonomics

## Goal

Remove cross-package hidden coupling, keep research in the workspace, and make the root of the repo understandable and runnable.

## Guardrails

- [ ] Keep the research apps in `pnpm-workspace.yaml`.
- [ ] Do not change commit-group identity or the V1 summary model in this PR.
- [ ] Prefer narrower APIs and clearer docs over creating more packages.

## Vite plugin cleanup

- [ ] Stop deriving the artifact destination from `process.cwd()` in `packages/vite-plugin/src/bundle-tracker.ts`.
- [ ] Add an explicit artifact output option or other cwd-independent contract between the plugin and its callers.
- [ ] Keep multi-environment artifact aggregation deterministic and one-write-only after the contract change.
- [ ] Re-check plugin tests after the artifact-path contract change.

## GitHub Action cleanup

- [ ] Split `packages/github-action/src/run.ts` into smaller modules for scenario execution, synthetic source generation, artifact loading, envelope building, and upload orchestration.
- [ ] Remove `withWorkingDirectory` and `process.chdir` coupling once the plugin no longer depends on it.
- [ ] Make synthetic entry-file cleanup explicit; either delete generated files by default or keep them only behind an intentional debug behavior.
- [ ] Centralize repeated input and environment parsing helpers currently duplicated across `inputs.ts`, `github-context.ts`, and `upload.ts`.
- [ ] Centralize repeated `formatIssues` style helpers inside the package.
- [ ] Keep fixture-app and repo-synthetic behavior identical after the refactor.
- [ ] Re-check action tests after the split so the package still covers upload success, missing artifact failure, and synthetic scenario execution.

## Contracts package cleanup

- [ ] Keep `packages/contracts` as one package for now.
- [ ] Add subpath exports by domain instead of forcing every consumer through the giant `packages/contracts/src/index.ts` barrel.
- [ ] Group exports into clear domains such as shared primitives, plugin artifact, upload envelope, public routes, summaries, mutations, queues, and workflows.
- [ ] Update internal consumers to import from narrower subpaths where that improves clarity.
- [ ] Add tests or typecheck coverage that the intended public subpath exports stay stable.

## Root repo ergonomics

- [ ] Add a root `README.md` that explains `apps/`, `packages/`, `research/`, and the markdown specs at the repo root.
- [ ] Document that `research/stable-identity` stays in the workspace intentionally and is not product code.
- [ ] Add root scripts that represent the actual repo, not only the stable-identity harness.
- [ ] Introduce a clear root command surface for at least `check`, `test`, `typecheck`, `lint`, and `format`.
- [ ] Separate product-facing commands from research commands so product checks do not accidentally run the lab unless requested.
- [ ] Choose and wire a lint and format tool for the repo instead of leaving style checks undefined.
- [ ] Make sure CI can use the same root commands rather than relying on package-by-package tribal knowledge.
- [ ] Add a small root docs index or equivalent guidance that points to the normative V1 docs and distinguishes them from research and background notes.

## Final repo-shape checks

- [ ] Verify that root commands cover `@workspace/web`, `@workspace/contracts`, `@workspace/vite-plugin`, and `@workspace/github-action`.
- [ ] Verify that keeping research in the workspace does not make root product commands accidentally run the lab unless requested.
- [ ] Verify that commit-group identity remains `commit_groups (repository_id, commit_sha)` and that this cleanup only changes boundaries, not semantics.
