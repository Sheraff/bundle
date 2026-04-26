# UI Redesign 06 History Experience

## Status

Plan 06 execution artifact.

Primary code changed:

- `apps/web/src/lib/public-read-models/scenario-page.server.ts`
- `apps/web/src/lib/public-read-models/repository-history.server.ts`
- `apps/web/src/lib/public-read-models/output-rows.server.ts`
- `apps/web/src/routes/r.$owner.$repo.history.tsx`
- `apps/web/src/routes/r.$owner.$repo.scenarios.$scenario.tsx`
- `apps/web/src/routes/repo-shared.css`
- `apps/web/test/public-read-models.test.ts`
- `apps/web/test/public-pages.test.ts`
- `apps/web/e2e/ui-functionality.spec.ts`

## Defaults

Repository and scenario history now default to `main` when `main` has measured data. If `main` is unavailable, history falls back to the most recently measured branch.

Explicit branch selection remains respected.

## Repository History

Repository history now starts from History Mode context instead of raw filters.

Sections:

- History mode summary
- Branch markers
- Timeline controls
- Compare builder
- Scenario rollups
- Branch evolution

Scenario rollups summarize outputs and measured points, and link back to scenario history with branch, What's-counted, and size context.

Branch markers are shown from measured branch data. Tag and release markers remain explicitly reserved until release data exists.

## Scenario History

Scenario pages now present history as first-class output evolution.

History fixes:

- scenario
- branch
- What's counted
- size

The chart caps visible output lines to keep the timeline readable. Extra lines remain available as output rows below the chart.

## History Point Semantics

Scenario history points now carry an explicit `state: "measured"` marker in `ScenarioHistoryOutputRow.points`.

Missing selected-size values are filtered out rather than zero-filled. Missing runs, failed runs, unsupported lenses, missing sizes, stale points, and incompatible schemas are documented in the History States legend as non-zero gap/status conditions.

## Tests

Updated coverage for:

- main branch default history
- explicit selected branch history
- measured point state markers
- missing history not represented as zero-filled points
- repository History Mode sections
- scenario History Mode sections
- e2e navigation through scenario rollups and branch evolution

## Verification Results

- `pnpm web:typecheck` passed.
- `pnpm web:test` passed.
- `pnpm web:seed` passed.
- `pnpm web:test:e2e` passed.

## Handoff To Plan 07

Plan 07 can build expert visualizer improvements on top of stable history deep-links and explicit scenario/output/lens/size context.
