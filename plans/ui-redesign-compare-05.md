# UI Redesign 05 Compare Experience

## Status

Plan 05 execution artifact.

Primary code changed:

- `apps/web/src/lib/public-read-models/output-rows.server.ts`
- `apps/web/src/lib/public-read-models/neutral-compare-page.server.ts`
- `apps/web/src/lib/public-read-models.server.ts`
- `apps/web/src/routes/r.$owner.$repo.compare.tsx`
- `apps/web/src/routes/r.$owner.$repo.compare.css`
- `apps/web/src/components/output-row.tsx`
- `apps/web/src/components/output-row.css`
- `apps/web/test/output-rows.test.ts`
- `apps/web/test/public-pages.test.ts`
- `apps/web/e2e/ui-functionality.spec.ts`

## Union Pairing

Neutral Compare Mode now builds a base/head union read model from measured `series_points` instead of deriving rows only from the head commit summary.

Rows are paired by:

- scenario
- environment
- entrypoint kind
- entrypoint key
- What's-counted lens

The row adapter is exposed as:

- `loadUnionPairOutputRows()`
- `unionPairOutputRowsFromPoints()`

## Row States

Union rows reuse shared `OutputRow` semantics through `UnionPairOutputRow`.

Supported pair states:

- `same`
- `added`
- `removed`
- `unavailable`
- `unsupported_lens`
- `missing_size`
- `invalid`

Gaps are explicit. Added, removed, unavailable, and missing size states do not become zero deltas.

## Compatibility

Compare Mode now surfaces compatibility at page and row level.

Compatibility labels:

- `exact`
- `partial`
- `exploratory`
- `invalid`

Exact rows require stored comparison evidence for the selected base/head. Same-key pairs without stored comparison evidence are `exploratory`. Added, removed, and unavailable rows are `partial`. Unsupported lens, missing size, and invalid rows are `invalid`.

Policy-grade language is tied only to exact rows. Partial, exploratory, and invalid rows are explicitly advisory.

## Compare UI

Neutral compare now uses:

- Compare presets
- Advanced base/head compare behind a `<details>` affordance
- Compatibility summary
- Base / Head / Diff perspective control
- Scenario groups
- Shared output row cards with comparison state badges
- Selected output evidence

Release candidate presets remain descriptive until release data exists.

## Tests

Updated `apps/web/test/output-rows.test.ts` coverage for:

- same rows
- changed rows
- added rows
- removed rows
- unavailable rows
- unsupported lens
- missing size
- exact compatibility
- partial compatibility
- exploratory compatibility
- invalid compatibility
- gaps are not zero-filled

Updated public and e2e coverage for Compare Mode headings, compatibility copy, and scenario group layout.

## Verification Results

- `pnpm web:typecheck` passed.
- `pnpm web:test` passed.
- `pnpm web:seed` passed.
- `pnpm web:test:e2e` passed.

## Handoff To Plan 06

Plan 06 can use `UnionPairOutputRow` as the stable compare pairing surface. Compare rows now preserve shared row semantics and expose explicit compatibility before any policy or expert visualizer changes.
