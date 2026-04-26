# UI Redesign 08 Policies Experience

## Status

Plan 08 execution artifact.

Primary code changed:

- `apps/web/src/db/schema.ts`
- `apps/web/drizzle/0006_modern_luckman.sql`
- `apps/web/drizzle/meta/_journal.json`
- `apps/web/drizzle/meta/0006_snapshot.json`
- `apps/web/src/policies.ts`
- `apps/web/src/materialize-comparison.ts`
- `apps/web/src/routes/r.$owner.$repo.settings.tsx`
- `apps/web/src/routes/r.$owner.$repo.scenarios.$scenario.tsx`
- `apps/web/test/setup.ts`
- `apps/web/test/policies.test.ts`

## Policy Model

Added persisted policy tables:

- `policies`
- `policy_results`
- `accepted_policy_decisions`

Policy fields include scenario scope, optional environment/entrypoint/lens scope, size metric, operator, threshold, severity, blocking, enabled, and version.

Policy results persist actual value, threshold, result, severity, message, and evaluation timestamp per comparison.

Accepted decisions persist actor, reason, scope, optional expiry, and related policy/result/comparison links.

## Evaluation

`evaluatePoliciesForComparison()` deterministically evaluates matching policies during comparison materialization.

Supported operators:

- `delta_greater_than`
- `total_greater_than`

Supported result states:

- `pass`
- `warn`
- `fail_non_blocking`
- `fail_blocking`
- `disabled`
- `accepted`
- `not_evaluated`

Comparison `budgetState` is now driven by real policy result aggregation. Shared rows continue to expose policy state separately from measurement state.

## Settings UI

Repository settings now include Scenario Policies:

- policy list
- scenario-scoped policy creation form
- sentence-style rule display
- consequence labels: Blocks merge, Warns only, No enforcement

Versioned edits are represented by creating a new policy version row in this pass; full inline editing can build on the persisted model.

## Accepted Decisions

Accepted decisions are honored when active and ignored after expiry. Active accepted decisions convert matching failures to `accepted` for that policy result.

## Tests

Added `apps/web/test/policies.test.ts` coverage for:

- scenario-wide policy evaluation
- pass
- warn
- non-blocking fail
- blocking fail
- disabled policy
- accepted decision
- expired accepted decision
- missing data cannot evaluate policy

Updated test cleanup to include policy tables.

## Verification Results

- `pnpm web:typecheck` passed.
- `pnpm web:test` passed.
- `pnpm web:seed` passed and applied `0006_modern_luckman.sql` locally.
- `pnpm web:test:e2e` passed.

## Handoff To Plan 09

Plan 09 can publish GitHub checks/comments from real `policy_results` and comparison `budgetState` values rather than placeholders.
