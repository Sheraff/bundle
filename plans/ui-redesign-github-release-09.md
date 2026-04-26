# UI Redesign 09 GitHub And Release Integration

## Status

Plan 09 execution artifact. This completes the ordered UI redesign plan chain.

Primary code changed:

- `apps/web/src/lib/policy-state.ts`
- `apps/web/src/summaries/pr-review-summary-builder.ts`
- `apps/web/src/github/render-check-run.ts`
- `apps/web/src/github/render-comment.ts`
- `apps/web/src/github/render-shared.ts`
- `apps/web/src/github/types.ts`
- `apps/web/src/github-api.ts`
- `apps/web/src/lib/release-readiness.ts`
- `apps/web/src/routes/r.$owner.$repo.compare.tsx`
- `packages/contracts/src/public-routes.ts`
- `apps/web/test/github-rendering.test.ts`
- `apps/web/e2e/ui-functionality.spec.ts`

## GitHub Output

GitHub check/comment rendering now reflects real policy states from Plan 08 instead of legacy placeholder budget states.

Check conclusion mapping:

- blocking policy failure -> `failure`
- measurement failure -> `failure`
- warning/non-blocking/not-evaluated policy outcome -> `neutral`
- missing baseline/missing scenario -> `neutral`
- no matching policy with complete measurements -> `success`
- all evaluated policies passing -> `success`
- pending summary -> in-progress check without conclusion

Comments and checks now include:

- hosted Review Mode link
- top affected scenario/output/lens rows
- blocking policy outcomes
- warning policy outcomes
- accepted policy decisions
- missing baselines and measurement gaps
- explicit no-policy messaging when no policy matched

## Review Summary

PR review summaries now map `fail-blocking`, `fail-non-blocking`, `warn`, `accepted`, and `not-evaluated` policy states into scenario review states. A blocking policy can fail the PR review even when byte deltas alone would not have produced an old-style blocking regression.

## Idempotency And Retry

Existing idempotency behavior remains in place:

- maintained PR comment identity uses `<!-- bundle-review:pr:<pullRequestId> -->`
- check run identity uses the stored publication row plus check name/head SHA behavior
- payload hash plus published head SHA skips no-op publishes
- stale comment/check IDs are recovered or recreated
- terminal and retryable GitHub failures are persisted and tested

## Release Readiness

Added a release-readiness report model and Compare Mode preset support:

- `preset=release-main` is linkable/shareable today for release candidate vs main.
- `release-last-release` and `release-tag` targets are modeled and intentionally report unavailable release metadata until release/tag data exists.
- Report counts blocking policies, warnings, accepted decisions, missing measurements, and unavailable artifacts explicitly.

## Tests

Added coverage for:

- GitHub check conclusion mapping
- GitHub comment rendering
- accepted policy decision overlay
- no fake policy enforcement when no policy matched
- release-readiness report counts
- e2e release-readiness preset rendering

Existing publish tests continue to cover idempotent updates, stale publication recovery, retry behavior, and auth/error handling.

## Final Regression Gate

Checked redesign constraints:

- Scenarios Home remains scenario-first.
- Review Mode remains decision-first.
- Scenario Page remains object-first.
- Compare Mode uses compatibility and union pairing.
- History uses fixed What's counted + Size controls.
- Expert Visualizer remains contextual.
- Policies are scenario-scoped and real.
- GitHub output reflects real policy state.
- No confidence UI was found in route/component surfaces.
- Sourcemap/source-line UI remains an explicit unavailable attribution note, not a requirement.
- Missing/unavailable data remains explicit and is not treated as zero/success.

## Verification Results

- `pnpm web:typecheck` passed.
- `pnpm web:test` passed: 20 files, 184 tests.
- `pnpm contracts:typecheck` passed.
- `pnpm contracts:test` passed: 3 files, 34 tests.
- `pnpm web:seed` passed.
- `pnpm web:test:e2e` passed: 4 tests.
- `pnpm github-action:typecheck` passed.
- `pnpm github-action:test` passed: 1 file, 4 tests.
