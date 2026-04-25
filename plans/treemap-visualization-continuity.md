# Treemap Visualization Continuity Plan

## Goal

Make the treemap timeline a reliable stability visualization, not just a size breakdown. Users should be able to scrub across commits and clearly understand which chunks stay stable, split, merge, appear, disappear, or move.

## Product Decisions

- Optimize for visual stability first.
- Prioritize continuity across chunks, modules, and assets, while preserving the current hierarchy for each frame.
- Use the latest frame, or compare head frame, as the canonical anchor layout.
- Replace the current scrubber layout with the continuity layout once validated; do not add a user-facing layout toggle in the first implementation.
- Keep cell area faithful to current byte values.
- Removed identities should fade during the transition, then disappear from geometry. They may remain visible in tables/details, but not as persistent ghost cells.
- Classify split, merge, added, removed, and moved states relative to the previous timeline frame.
- Avoid dashed outline encodings; they read as rendering artifacts during motion.
- Use subtle solid emphasis and plain detail tables for split/merge/move semantics in the first implementation.

## Current State

- Frame nodes lazy-load through `/api/v1/public/treemap-frame`.
- React Query keeps previous frame data visible while a requested frame loads.
- The scrubber uses deterministic per-frame layout and short D3 transitions between rendered rects.
- Stable identity exists for chunks/modules/assets, but the visualization does not yet explicitly explain split or merge relationships.

## Problems To Solve

- D3 treemap layout optimizes local space usage, not semantic continuity.
- New or removed nodes can force large unrelated reflows.
- Split/merge relationships are present in comparison data but not represented directly in the timeline treemap.
- The current animation shows motion, but it does not distinguish between stable movement, identity replacement, split, merge, and disappearance.
- A frame can be deterministic while still being hard to compare visually if the layout rebalances too much.

## Proposed Functionality

### Deterministic Timeline Layout

- Build a canonical identity universe for the selected series timeline.
- Sort identities with stable keys, not fetch order or currently loaded frame order.
- Use stable identity metadata across chunks, modules, and assets.
- Preserve the actual current-frame hierarchy when ownership changes, such as a module moving to a different chunk.
- Ensure any frame renders identically regardless of scrub path, reload, or cache state.

### Continuity-Oriented Layout Mode

- Use the latest frame for scenario timelines and the compare head frame for compare timelines as the anchor.
- Compute an anchor treemap from the anchor frame and canonical identity ordering.
- For each frame, preserve relative placement for stable identities where possible without violating current-frame byte-area accuracy.
- Use the largest selected-metric frame in the timeline as the visual capacity, so smaller frames occupy less than the full viewport instead of expanding to 100%.
- Preserve treemap validity first: rectangles for sibling leaves must never overlap.
- Use `d3.treemapResquarify` seeded from the anchor frame to preserve row orientation and reduce movement while still producing a valid treemap for every frame.
- Removed identities should animate out from their previous rendered region, then be removed from target geometry.
- Added identities should animate in from a small or faded state near their target region.
- Re-added identities should use stable ordering and identity metadata so they return near their prior/anchor neighborhood when possible.

### Split And Merge Semantics

- Classify changes by comparing each frame with the immediately previous timeline frame:
  - stable
  - added
  - removed
  - split from one prior chunk
  - merged from multiple prior chunks
  - renamed or moved with preserved module identity
- Treat moved modules as belonging to their current chunk; show movement through styling, titles, and detail rows rather than breaking hierarchy.
- Add unobtrusive stroke or opacity treatments for split, merge, and moved cells.
- Include hover/focus details showing source/target identities and byte deltas where available.

### Visual Encoding

- Keep the aesthetic minimal and functional.
- Use opacity or solid stroke style to distinguish added, removed, split, merged, and moved states.
- Do not use dashed outlines for semantic states.
- Avoid heavy color semantics until the data model is solid.
- Keep labels focused on chunk/module names and size values.
- Preserve accessibility via SVG titles and plain tables below the graph.
- Keep treemap cell area proportional to the selected metric for the current frame.

### Interaction

- Scrubber should support frame-by-frame movement and direct jumps.
- Direct jumps should animate from the currently rendered frame to the requested frame, but layout should not depend on the jump path.
- Add optional previous/next changed-frame controls if the timeline grows large.
- Keep URL state for branch/env/entrypoint/lens/metric/tab.
- Continuity layout should become the default scrubber behavior after validation.

## Implementation Phases

### Phase 1: Data Contract

- Extend timeline metadata with a canonical list of stable identities for the selected series.
- Include per-frame presence and values by identity.
- Include previous-frame relationship metadata for split, merge, added, removed, and moved states.
- Include current parent identity for each node so the layout can preserve current-frame hierarchy.
- Keep lazy frame node loading for heavy node details.

### Phase 2: Deterministic Layout Engine

- Extract treemap timeline layout into a dedicated pure function.
- Add unit tests proving frame layout is independent of scrub path and fetch order.
- Snapshot stable identities, parent relationships, and rect positions for representative timelines.
- Add tests for current hierarchy preservation when modules move between chunks.
- Add tests that cell area remains proportional to current-frame byte values.

### Phase 3: Continuity Layout

- Implement latest/head anchored continuity layout.
- Preserve stable identity neighborhoods across frames where possible.
- Add enter behavior for added identities and transition-only exit behavior for removed identities.
- Compare against the current deterministic D3 layout during validation, then replace the scrubber layout if continuity is clearer.

### Phase 4: Split/Merge UX

- Surface split/merge status in SVG titles and the detail tables.
- Add minimal visual treatment for split, merge, and moved cells.
- Add hover or focus details for source and target identities.

### Phase 5: Validation

- Add tests for deterministic layout across scrub paths.
- Add Playwright checks for lazy loading, stable controls, and transition behavior.
- Validate against real PR histories with additions, removals, splits, and merges.

## Non-Goals For The UI Functionality Pass

- Polished styling or brand-level visual design.
- Complex legends or dense annotations.
- Solving every pathological treemap packing case.
- Replacing the underlying stable identity model.

## Near-Term Patch Already Done

- The current scrubber now computes each frame layout from that frame's nodes only.
- It no longer uses history-sensitive `treemapResquarify` state.
- It no longer lets previously visited frames alter the selected frame layout.
- It keeps the existing short D3 transition for continuity.
