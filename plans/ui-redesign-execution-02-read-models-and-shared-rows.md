# UI Redesign Execution 02: Read Models And Shared Rows

## Position In Chain

Start only after `01-semantic-contracts-and-fixtures` acceptance checks pass.

## Goal

Build the shared read-model layer that powers the redesigned UI surfaces.

This plan turns current summary/read-model data into scenario-centered `OutputRow` shapes without building the main UI yet.

## Key Principle

`OutputRow` is a view/read-model contract, not the canonical domain model.

The canonical semantics remain scenario/environment/entrypoint/lens/size and normalized snapshot/comparison data.

## Non-Goals

- Do not build final Review, Scenario, Compare, History, or Policy pages.
- Do not implement real policy evaluation.
- Do not implement union compare yet.
- Do not generalize expert visualizer frames.

## Deliverables

### Shared OutputRow Union

Define a discriminated union:

```ts
type OutputRow =
  | ReviewOutputRow
  | ScenarioLatestOutputRow
  | ScenarioHistoryOutputRow
  | CompareOutputRow
  | UnionPairOutputRow
```

Common fields:

- rowId
- seriesKey
- scenario
- environment
- entrypoint
- entrypointKind
- lens
- currentTotals
- baselineTotals when available
- deltaTotals when available
- selectedSize
- measurementState
- policyState
- miniViz
- evidenceAvailability

Mode-specific fields are allowed, but actions are derived by UI mode and should not be persisted on the row.

### Source Adapters

Build adapters from current data to `OutputRow` where possible:

- PR review summary rows.
- Neutral compare rows.
- Scenario latest rows.
- Scenario history rows.
- Repository/scenario catalog rows.

Each adapter must preserve:

```text
scenario + environment + entrypoint + lens
```

Do not collapse environments, entrypoints, or lenses in mapper code.

### Mini-Viz Data Loader

Add a batched recent-points loader for visible rows.

Inputs:

- series IDs or comparable keys.
- selected size.
- point limit.

Outputs:

- latest value.
- previous/baseline value when available.
- recent points when available.
- status if no mini-viz can be rendered.

### Evidence Availability Adapter

Add cheap evidence availability fields:

- selected detail available
- snapshot detail available
- comparison detail available
- treemap frame available
- graph/waterfall detail available
- unavailable reason

Do not load heavy evidence in list read models.

### Initial Read Models

Create or prepare server functions for:

- Review rows from existing PR data.
- Scenario list rows.
- Scenario detail current rows.
- Scenario history row inputs.

These may initially wrap existing read models, but the component layer should consume the new row shapes.

## Tests

Add mapper tests proving:

- scenario/environment/entrypoint/lens are preserved.
- raw/gzip/brotli totals map correctly.
- missing baseline does not become zero.
- unavailable evidence does not become success.
- policy placeholder states remain non-enforcing.
- mini-viz fallback works for missing/one-point/no-history states.
- canonical fixtures from Plan 01 are reused.

## Acceptance Criteria

- Shared `OutputRow` contract exists.
- At least PR review and scenario latest adapters exist.
- Mini-viz loader can produce delta-bar or status fallback for visible rows.
- Evidence availability is explicit.
- No UI surface consumes raw old rows directly when a new row adapter exists.

## Handoff To Plan 03

Plan 03 may start only after:

- Scenario list/detail rows can be produced.
- Mini-viz data can be produced or explicitly marked unavailable.
- Fixture matrix validates row mappers.
