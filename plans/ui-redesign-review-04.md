# UI Redesign 04 Review Experience

## Status

Plan 04 execution artifact.

Primary code changed:

- `apps/web/src/routes/r.$owner.$repo.compare.tsx`
- `apps/web/src/routes/r.$owner.$repo.compare.css`
- `apps/web/src/lib/public-read-models/pr-compare-page.server.ts`
- `apps/web/src/lib/review-mode.ts`
- `apps/web/test/review-mode.test.ts`
- `apps/web/test/public-pages.test.ts`

## Review Mode

PR-scoped compare now renders a Review Mode decision surface instead of the neutral compare table-first page.

Structure:

- Verdict hero
- Why this verdict
- Top affected scenarios
- Scenario groups
- Selected output evidence
- Actions

The route remains `/r/$owner/$repo/compare?pr=...&base=...&head=...` for PR review contexts. Neutral compare behavior remains on the existing compare layout until Plan 05.

## Verdicts

Verdicts are produced by `reviewVerdict()` in `apps/web/src/lib/review-mode.ts` with this deterministic precedence:

- measurement failed
- incomplete
- missing baseline
- blocked policy
- needs decision
- no policy
- pass

The verdict hero shows both measurement state and policy state. `not_configured` remains non-enforcing, so changed outputs become `needs_decision` rather than fake policy blocking.

## Review Rows

PR review rows reuse the shared `OutputRow` read model through `reviewOutputRows` from `getPullRequestComparePageData()`.

Rows preserve:

- scenario
- output environment
- entrypoint kind and key
- What's counted lens
- selected size
- measurement state
- policy state
- evidence availability
- mini-viz

Review Mode emphasizes output, delta, policy state, mini-viz, and next action. Expanded rows keep the full measurement context.

## Evidence Actions

`canOpenReviewEvidence()` prevents Review Mode from opening a treemap evidence link unless selected detail and treemap frame evidence are available.

Unavailable evidence renders the explicit unavailable reason instead of a fake chart link.

## Scenario Groups

`shouldExpandReviewScenarioGroup()` expands only top-risk groups by default:

- `blocking`
- `regression`

Lower-risk groups are collapsed by default.

## Tests

Added `apps/web/test/review-mode.test.ts` coverage for:

- deterministic verdict precedence
- PR with no policy
- missing baseline verdict
- failed measurement verdict
- no fake policy blocking before policy exists
- unavailable evidence blocking evidence links
- top-risk group expansion and lower-risk collapse behavior

Updated public page coverage for PR Review Mode copy and guardrails:

- `Review PR #...`
- `Needs review`
- scenario group rendering
- `not_configured` policy explanation
- no `Blocked by policy` copy before policy exists
- no `Confidence` or `Sourcemap` UI copy

## Verification Results

- `pnpm web:typecheck` passed.
- `pnpm web:test` passed.
- `pnpm web:seed` passed.
- `pnpm web:test:e2e` passed.

## Handoff To Plan 05

Plan 05 may start from the existing neutral compare route. PR Review Mode now has scenario/output row semantics, deterministic review verdicts, honest evidence actions, and non-enforcing policy copy.
