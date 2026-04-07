# PR2 - summaries, GitHub publication, and public read cleanup

## Goal

Split the summary, publication, and public-read hotspots into explicit modules without changing V1 behavior.

## Guardrails

- [ ] Keep commit-group identity as `commit_groups (repository_id, commit_sha)`.
- [ ] Keep neutral commit-group summaries separate from PR review summaries.
- [ ] Preserve current settlement, reopen, inherited, missing, failed, and acknowledgement semantics.

## Summary refresh decomposition

- [ ] Extract the queue entrypoints `handleRefreshSummariesQueue`, `handleRefreshSummariesMessage`, and `enqueueRefreshSummaries` out of `apps/web/src/refresh-summaries.ts` into a focused queue module.
- [ ] Extract `refreshSummariesForCommitGroup` orchestration into a summary service module.
- [ ] Extract active-run selection and rerun visibility rules into `apps/web/src/summaries/active-run-policy.ts`.
- [ ] Extract commit-group summary building out of `buildCommitGroupSummary` into a dedicated builder module.
- [ ] Extract PR review summary building out of `buildPrReviewSummary` into a dedicated builder module.
- [ ] Extract comparison-loading and inherited-source lookup helpers out of the main summary file.
- [ ] Extract `upsertCommitGroupSummary` and `upsertPrReviewSummary` into a persistence module.
- [ ] Extract workflow scheduling for commit-group settlement and PR publish debounce into a thin orchestration helper.
- [ ] Extract sort, ordering, and review-state helpers into smaller modules or keep them co-located with the builders if that is clearer; do not leave them all piled into one 1300-line file.
- [ ] Centralize the mapping from summary JSON to scalar projection columns so the stored JSON and relational counters cannot drift independently.
- [ ] Keep `settledAt` replay idempotency behavior unchanged for already-settled summaries.

## GitHub publication decomposition

- [ ] Extract the queue entrypoints `handlePublishGithubMessage` and `enqueuePublishGithub` into `apps/web/src/github/publish-queue.ts`.
- [ ] Extract `publishGithubForPullRequest` orchestration into a dedicated service module.
- [ ] Extract PR comment payload building into `apps/web/src/github/render-comment.ts`.
- [ ] Extract aggregate check payload building into `apps/web/src/github/render-check-run.ts`.
- [ ] Extract publication row loading, upserting, and retry bookkeeping into `apps/web/src/github/persist-publication.ts`.
- [ ] Extract error classification and reusable formatting helpers out of the main publication module.
- [ ] Keep payload-hash no-op suppression, comment marker recovery, retryable failure handling, and terminal failure handling intact.

## Public read-model and route cleanup

- [ ] Split `apps/web/src/lib/public-read-models.server.ts` by page concern instead of keeping repository, scenario, and compare reads in one file.
- [ ] Introduce separate app-facing compare read functions for neutral compare and PR-scoped compare instead of one mixed read path.
- [ ] Keep neutral compare acknowledgement-neutral and PR compare acknowledgement-aware.
- [ ] Extract shared status, delta, badge, and visible-row presentation helpers used across `r.$owner.$repo.index.tsx`, `r.$owner.$repo.compare.tsx`, and `r.$owner.$repo.scenarios.$scenario.tsx`.
- [ ] Remove or isolate placeholder compare-detail copy until real treemap, graph, and waterfall payloads exist.
- [ ] Keep URL-driven page state intact while reducing route-file noise.

## Test coverage cleanup

- [ ] Add focused tests for active-run selection, quiet-window settlement, inherited vs missing behavior, and newer-failed-rerun visibility.
- [ ] Add focused tests for PR review ordering and acknowledgement overlay behavior.
- [ ] Add focused tests for GitHub publication no-op, update, retryable failure, terminal failure, and stale publication ID recovery paths.
- [ ] Add public route and read tests for invalid search params, nonexistent repositories or scenarios, missing compare pairs, missing branches, and deterministic selection or ordering edge cases.
