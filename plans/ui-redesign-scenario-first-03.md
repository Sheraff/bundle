# UI Redesign 03 Scenario-First Experience

## Status

Plan 03 execution artifact.

Primary code changed:

- `apps/web/src/routes/r.$owner.$repo.index.tsx`
- `apps/web/src/routes/r.$owner.$repo.scenarios.$scenario.tsx`
- `apps/web/src/components/output-row.tsx`
- `apps/web/src/components/output-row.css`
- `apps/web/src/routes/repo-shared.css`

## Scenario Home

The repository public landing route now presents scenario groups instead of a filter-first overview.

Sections:

- Needs attention
- Recently changed
- Uncovered / no policy
- Stale / missing
- Healthy

Each scenario card shows:

- scenario name
- source kind
- latest state
- policy coverage
- environment count
- output count
- What's-counted count
- last run
- current selected size
- selected-size delta
- one `MiniViz` signal or explicit status chip

The page still exposes branch, What's counted, and Size controls because they affect interpretation, but they are scoped under `What this page is measuring` rather than presented as a generic filter entry point.

Density toggle:

- `cards`
- `list`

## First-Run State

When no scenarios exist, the repository page explains:

```text
Scenarios are what Chunk Scope tracks.
Each scenario can produce outputs, and each output can be measured using one or more byte-counting modes.
```

Setup steps are labeled:

- Detected
- Selected
- Configured

## Scenario Page

The scenario route now centers the canonical object page around:

- Scenario summary
- Measurement context
- Recommended next action
- Current outputs
- History module
- Policies context
- Expert evidence

Current output cards consume `latestOutputRows` from the Plan 02 row adapter and show:

- Output
- Current
- Delta
- Policy state
- Mini-viz
- Primary evidence action
- Expanded measurement details

History consumes `historyOutputRows` and keeps What's counted and Size fixed for the chart and output cards.

Expert evidence remains contextual and is opened from output rows. Full expert visualizer redesign is deferred to Plan 07.

## Mini-Viz Behavior

The shared `MiniVizView` renders:

- delta bars
- sparklines
- state strips
- status chips
- explicit no-data fallbacks

Exact current/delta/baseline numbers remain visible outside the mini-viz.

## Verification Results

- `pnpm web:test` passed.
- `pnpm web:typecheck` passed.
- `pnpm web:seed` passed.
- `pnpm web:test:e2e` passed.
- Manual Playwright responsive smoke passed at mobile width for scenario home and scenario page with no console errors.

Test retargeting:

- Public page assertions now target scenario-first route copy.
- E2E now uses scenario-first headings and the output-row `Inspect evidence` action.
