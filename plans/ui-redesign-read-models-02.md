# UI Redesign 02 Read Models And Shared Rows

## Status

Plan 02 execution artifact.

Primary code:

```text
apps/web/src/lib/public-read-models/output-rows.server.ts
```

## OutputRow Contract

The shared read-model union is exported from `apps/web/src/lib/public-read-models.server.ts`.

Union members:

- `ReviewOutputRow`
- `ScenarioLatestOutputRow`
- `ScenarioHistoryOutputRow`
- `CompareOutputRow`
- `UnionPairOutputRow`

Common fields include:

- `rowId`
- `seriesKey`
- `scenario`
- `environment`
- `entrypoint`
- `entrypointKind`
- `lens`
- `currentTotals`
- `baselineTotals`
- `deltaTotals`
- `selectedSize`
- `measurementState`
- `policyState`
- `miniViz`
- `evidenceAvailability`
- `comparisonState`
- `compatibility`

Rows are view/read-model contracts. They are not persisted domain records.

## Source Adapters

Implemented adapters:

- `reviewOutputRowsFromSummary()`
- `reviewOutputRowsFromReviewedRows()`
- `scenarioLatestOutputRowsFromFreshScenario()`
- `scenarioHistoryOutputRowsFromSeries()`
- `compareOutputRowsFromNeutralRows()`
- `outputRowsFromCanonicalFixtures()`

The adapters preserve:

```text
scenario + environment + entrypointKind + entrypoint + lens
```

Existing persisted budget states are mapped into Plan 01 policy states at the read-model boundary. For example, `not-configured` becomes `not_configured` and remains non-enforcing.

## Mini-Viz Loader

Implemented:

```text
loadOutputRowMiniVizData()
```

Inputs:

- repository id
- series ids
- selected size
- point limit

Outputs:

- latest value
- previous value when available
- recent points
- typed `MiniViz`
- explicit unavailable fallback when no points exist

Ordering note:

- Recent points order by `measuredAt` descending with `createdAt` as a tie-breaker so same-timestamp uploads do not make baseline appear latest.

## Evidence Availability

Rows now expose cheap evidence availability without loading heavy evidence:

- selected detail availability
- snapshot detail availability
- comparison detail availability
- treemap frame availability
- graph detail availability
- waterfall detail availability
- unavailable reason

Failed rows become `error`, missing rows stay `missing`, and unavailable evidence is not treated as success.

## Tests

Added:

```text
apps/web/test/output-rows.test.ts
```

Coverage:

- scenario/environment/entrypoint/lens preservation
- raw/gzip/brotli total mapping
- missing baseline does not become zero
- unavailable evidence remains explicit
- policy placeholder states remain non-enforcing
- mini-viz fallback for no-history and one-point cases
- Plan 01 canonical fixtures are reused by row mappers

## Verification Results

- `pnpm web:test` passed.
- `pnpm web:typecheck` passed.
