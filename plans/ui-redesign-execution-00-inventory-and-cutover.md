# UI Redesign Execution 00: Inventory And Cutover

## Position In Chain

This is the first execution plan. Do not start `01-semantic-contracts-and-fixtures` until this inventory is complete and the cutover stance is recorded.

## Goal

Create the factual baseline for the scenario-centered UI redesign before any contracts or UI are changed.

This plan answers:

- What current routes, read models, components, tests, and seed data exist?
- Which current surfaces can be reused, replaced, or deleted?
- Which current behavior must be preserved semantically while changing the UI?
- How will the project cut over from the current filter-heavy UI to the new scenario-centered UI?

## North-Star Reference

Read `plans/ui-redesign-scenario-centered.md` before executing this plan.

Key invariant:

```text
Scenario -> Output -> What's counted -> Size -> Evidence
```

The redesign must not regress back to a generic filter-first UI over:

```text
scenario + env + entrypoint + lens + metric + tab
```

## Scope

Inventory these areas:

- Routes under `apps/web/src/routes`.
- Public read models under `apps/web/src/lib/public-read-models`.
- Current visualization components under `apps/web/src/components`.
- Current selected-series detail and treemap timeline behavior.
- Current tests under `apps/web/test` and `apps/web/e2e`.
- Local seed flow and seeded data coverage.
- GitHub PR/check/comment data paths.
- Current budget/policy placeholders.
- Current usage of `scenario`, `environment`, `entrypoint`, `entrypointKind`, `lens`, `metric`, and `tab`.

## Non-Goals

- Do not implement new UI.
- Do not change schemas.
- Do not delete old routes yet.
- Do not introduce redirects yet.
- Do not invent policy behavior.

## Deliverables

Create or update a short inventory note linked from this plan with:

- Current route map.
- Current read-model map.
- Current component map.
- Current test coverage map.
- Current seed-data state coverage.
- Current visualization data dependencies.
- Current policy/budget implementation state.
- Current GitHub check/comment flow.
- Gaps blocking the execution chain.

## Required Inventory Tables

### Route Inventory

For each route, record:

- Path.
- Purpose today.
- Search params.
- Loader/read model.
- User-facing concepts exposed.
- Future surface replacement.
- Keep, rewrite, or delete.

### Read Model Inventory

For each read model, record:

- Function name.
- Current input shape.
- Current output shape.
- Whether it preserves `scenario + environment + entrypoint + lens`.
- Whether it supports current/baseline/delta totals.
- Whether it supports history points.
- Whether it supports evidence/detail links.
- Whether it supports mini-viz data.

### State Fixture Matrix

Define the fixture/state matrix to be reused by later plans.

The matrix must include:

- complete measurement
- missing baseline
- failed upload
- failed build
- incomplete run
- unsupported lens
- missing size
- added output
- removed output
- unavailable evidence
- no policy
- not evaluated policy
- warning policy
- blocking policy
- accepted policy decision

## Cutover Stance

Record one explicit cutover mode before moving on.

Allowed modes:

- `replace-in-place`: rewrite existing public routes directly.
- `parallel-hidden`: add new routes hidden from nav, then swap nav once ready.
- `feature-flagged`: expose new surfaces behind an explicit flag.
- `redirected`: introduce new routes and redirect old routes when complete.

Recommended default:

```text
parallel-hidden during development, then replace-in-place before shipping. No long-term compatibility redirects are required because the product has not shipped.
```

The decision must include deletion criteria for old route/components after replacement.

## Regression Scope

This plan is the source of truth for the regression scope used by later plans.

Inventory current behavior for:

- scenario semantics
- environment semantics
- entrypoint semantics
- lens semantics
- raw/gzip/brotli semantics
- history behavior
- compare behavior
- review/PR behavior
- expert visualizer behavior
- policy/budget placeholder behavior

## Acceptance Criteria

- Current routes are mapped to future surfaces.
- Current read models are mapped to future contracts or gaps.
- Current tests are mapped to future regression suites.
- Fixture/state matrix exists and is referenced by later plans.
- Cutover mode is explicit.
- Deletion criteria for old UI are documented.
- No plan after this has to guess what current behavior exists.

## Required Commands

Run at least:

```bash
pnpm web:test
pnpm web:test:unit
pnpm web:typecheck
```

If e2e behavior is being inventoried, also run:

```bash
pnpm web:seed
pnpm web:test:e2e
```

## Global Guardrails

These apply to every execution plan after this one:

- Do not introduce confidence UI.
- Do not introduce sourcemap requirements or source-line attribution claims.
- Do not collapse missing/unavailable data into zero, empty, or success.
- Do not add a generic filter-first entry point.
- Do not ship table-first exploration as the primary user experience.
- Do not mix lenses in one chart.
- Do not hide `Output`, `What's counted`, or `Size` when they affect interpretation.

## Handoff To Plan 01

Plan 01 may start only after:

- Cutover mode is chosen.
- Fixture/state matrix exists.
- Current read-model gaps are known.
- Current route deletion/rewrite stance is known.
