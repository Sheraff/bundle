# UI Redesign 07 Expert Visualizer Experience

## Status

Plan 07 execution artifact.

Primary code changed:

- `apps/web/src/components/selected-series-detail.tsx`
- `apps/web/src/components/selected-series-detail.css`
- `apps/web/src/routes/r.$owner.$repo.compare.tsx`
- `apps/web/src/routes/r.$owner.$repo.scenarios.$scenario.tsx`
- `apps/web/test/public-pages.test.ts`
- `apps/web/e2e/ui-functionality.spec.ts`

## Contextual Expert Mode

The existing selected-series detail renderer is now wrapped in an `Expert visualizer` contextual mode.

The visualizer receives context from Scenario Page, Review Mode, Compare Mode, and History Mode entry paths where available:

- scenario
- environment
- entrypoint
- What's counted
- size
- current ref
- optional baseline ref

The visualizer is still opened from output rows and detail tabs. It is not a top-level nav item.

## Intent Rail

The expert mode now includes an intent rail:

- Where size lives: Treemap
- What changed: Bundle waterfall
- How modules connect: Module graph
- Which assets/packages changed: Tables

This reframes the existing visualizations without removing current tabs or chart functionality.

## Preserved Visualizations

Existing visualizations remain in place:

- Treemap
- Graph
- Waterfall
- Assets
- Packages
- Budget
- Identity

The treemap history scrubber still appears only in the treemap path when timeline frame data exists. Graph and waterfall do not show unsupported scrubber controls.

## Attribution Limits

Expert mode now shows an attribution banner with explicit scope:

```text
Module-level attribution only. Source-line attribution is unavailable because sourcemaps are not uploaded in V1.
```

Attribution states are surfaced as full, partial, or unavailable depending on mode and evidence availability.

## Tests

Updated coverage for:

- expert context rendering from scenario and compare entries
- intent rail copy
- attribution limit copy
- treemap still rendering
- graph and waterfall still rendering
- existing selected detail tabs preserving context

## Verification Results

- `pnpm web:typecheck` passed.
- `pnpm web:test` passed.
- `pnpm web:seed` passed.
- `pnpm web:test:e2e` passed.

## Handoff To Plan 08

Plan 08 can build policy/budget semantics without depending on the previous tab-first expert mental model. Expert evidence now has contextual framing and explicit attribution limits.
