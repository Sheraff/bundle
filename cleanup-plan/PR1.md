# PR1 - apps/web seam extraction and test support

## Goal

Behavior-preserving cleanup of the `apps/web` ingestion entrypoints and the copied test support code.

## Guardrails

- [ ] Do not change commit-group identity or commit-group semantics.
- [ ] Do not change upload endpoint contracts, queue message shapes, or DB schema in this PR.
- [ ] Keep existing worker behavior and public page behavior intact while shrinking the hotspot files.

## apps/web shared helpers

- [ ] Create `apps/web/src/db/select-one.ts` and migrate repeated `selectOne` helpers out of `api/uploads.ts`, `refresh-summaries.ts`, `publish-github.ts`, and any other touched copies.
- [ ] Create `apps/web/src/shared/format-issues.ts` and migrate repeated Valibot issue formatting helpers out of touched files.
- [ ] Create `apps/web/src/shared/sha256-hex.ts` and remove the duplicate hashing helper from `api/uploads.ts` and `publish-github.ts`.
- [ ] Review the remaining tiny helper duplication in `apps/web` and only keep local helpers when they are truly file-local and clearer in place.

## Worker entrypoint cleanup

- [ ] Extract the queue `kind` dispatch switch from `apps/web/src/index.ts` into `apps/web/src/queues/dispatch-message.ts`.
- [ ] Keep `apps/web/src/index.ts` as the Worker composition layer: Hono app setup, upload route registration, React Start handoff, error handling, and workflow exports.
- [ ] Keep unknown queue message logging and acknowledgement behavior intact after the extraction.

## Upload ingestion cleanup

- [ ] Keep `apps/web/src/api/uploads.ts` as the HTTP route layer only.
- [ ] Move upload request orchestration into `apps/web/src/uploads/accept-upload.ts`.
- [ ] Move raw artifact and envelope text building plus R2 writes into `apps/web/src/uploads/raw-upload-storage.ts`.
- [ ] Move repository, scenario, pull request, and commit-group upsert logic into `apps/web/src/uploads/persist-scenario-run.ts`.
- [ ] Move dedupe lookup plus rollback cleanup into the upload service area so insert, raw-write, queueing, and cleanup rules live together.
- [ ] Move the accepted-response builder out of the route file so response shaping is not mixed into persistence logic.
- [ ] Keep the synchronous ingest contract unchanged: authenticate, validate, persist raw upload, create or attach relational rows, enqueue normalize, return `202`.
- [ ] Re-check failure cleanup so raw object deletion and scenario-run rollback stay behaviorally identical after the extraction.

## Web test support cleanup

- [ ] Create `apps/web/test/support/pipeline-harness.ts` and move the repeated queue-spy and queue-drain logic out of `public-pages.test.ts`, `publish-github.test.ts`, and `summaries.test.ts`.
- [ ] Create `apps/web/test/support/request-helpers.ts` and move repeated Worker request helpers there.
- [ ] Create `apps/web/test/support/builders.ts` and move repeated `buildEnvelope`, `buildCiContext`, `buildSimpleArtifact`, and `size` helpers there.
- [ ] Create `apps/web/test/support/db-helpers.ts` for repeated `countRows`, simple row lookups, and straightforward seed helpers where duplication is obvious.
- [ ] Migrate repeated upload and envelope helpers out of `upload.test.ts`, `normalize-runs.test.ts`, `derive-runs.test.ts`, `public-pages.test.ts`, `publish-github.test.ts`, and `summaries.test.ts`.
- [ ] Keep per-test-file data builders only where the artifact shape is intentionally specialized, such as the complex comparison-shape fixtures in `comparisons.test.ts`.
- [ ] Remove dead helper code after the shared support files are adopted.

## Verification

- [ ] Run the web test suite after the refactor.
- [ ] Confirm that no HTTP, queue, or schema behavior changed.
- [ ] Confirm that `apps/web/src/index.ts`, `apps/web/src/api/uploads.ts`, and the touched test files are materially smaller and easier to scan.
