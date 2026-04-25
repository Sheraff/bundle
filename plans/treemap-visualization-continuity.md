# Treemap Visualization Continuity Plan

## Goal

Make the treemap timeline a reliable stability visualization, not just a size breakdown. Users should be able to scrub across commits and clearly understand which chunks stay stable, split, merge, appear, disappear, or move.

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
- Use a consistent parent/child hierarchy for every frame where possible.
- Ensure any frame renders identically regardless of scrub path, reload, or cache state.

### Continuity-Oriented Layout Mode

- Pick an anchor frame, usually the selected head or latest frame.
- Compute an anchor treemap from the full identity universe.
- For each frame, preserve anchor regions for stable identities when possible.
- Represent removed identities as zero/faded cells rather than immediately reallocating all space.
- Represent new identities by growing into their assigned regions instead of causing a complete reflow.

### Split And Merge Semantics

- Use stable identity comparison metadata to classify changes:
  - stable
  - added
  - removed
  - split from one prior chunk
  - merged from multiple prior chunks
  - renamed or moved with preserved module identity
- Add unobtrusive markers or labels for split/merge events.
- Consider optional hover details showing source/target identities and byte deltas.

### Visual Encoding

- Keep the aesthetic minimal and functional.
- Use opacity or stroke style to distinguish added/removed/split/merged states.
- Avoid heavy color semantics until the data model is solid.
- Keep labels focused on chunk/module names and size values.
- Preserve accessibility via SVG titles and plain tables below the graph.

### Interaction

- Scrubber should support frame-by-frame movement and direct jumps.
- Direct jumps should animate from the currently rendered frame to the requested frame, but layout should not depend on the jump path.
- Add optional previous/next changed-frame controls if the timeline grows large.
- Keep URL state for branch/env/entrypoint/lens/metric/tab.

## Implementation Phases

### Phase 1: Data Contract

- Extend timeline metadata with a canonical list of stable identities for the selected series.
- Include per-frame presence and values by identity.
- Include split/merge relationships where available from stable identity matching.
- Keep lazy frame node loading for heavy node details.

### Phase 2: Deterministic Layout Engine

- Extract treemap timeline layout into a dedicated pure function.
- Add unit tests proving frame layout is independent of scrub path and fetch order.
- Snapshot stable identities, parent relationships, and rect positions for representative timelines.

### Phase 3: Continuity Layout

- Implement an anchor-frame layout mode.
- Preserve stable identity regions across frames where possible.
- Add simple enter/exit behavior for appeared/disappeared identities.
- Compare against standard D3 treemap layout and keep the one that best communicates stability.

### Phase 4: Split/Merge UX

- Surface split/merge status in SVG titles and the detail tables.
- Add minimal visual treatment for split/merge cells.
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
