# UI Redesign Execution 06: History Experience

## Position In Chain

Start only after `05-compare-experience` acceptance checks pass.

## Goal

Build first-class History Mode for scenario and repository timelines.

History answers:

```text
How did this scenario/output evolve over time?
```

## Non-Goals

- Do not generalize expert visualizer scrubber yet.
- Do not implement policy enforcement.
- Do not infer data for missing runs.

## History Scope

History always fixes:

- Scenario or repository scope.
- What's counted.
- Size.

History may vary:

- output selection
- branch selection
- tag/release markers
- run/ref selection

## UI Layout

Repository history:

- Scenario rollups.
- Branch/tag/release markers where data exists.
- Links to scenario detail.

Scenario history:

- Main branch by default.
- Branch multi-select.
- Output selection.
- One `What's counted` at a time.
- One `Size` at a time.

Line charts:

- cap visible lines
- switch to small multiples when needed
- gaps for missing data
- no zero-filling

## History States

History rows/points must distinguish:

- measured
- missing run
- failed run
- unsupported lens
- missing size
- stale point
- incompatible schema

## Tests

Add tests for:

- main branch history
- selected branch history
- multiple branches
- missing points as gaps
- incompatible lens/schema handling
- branch/tag marker display
- line cap/small multiple behavior where testable

## Acceptance Criteria

- History is understandable without exposing raw filters first.
- Charts never mix lenses.
- Size is visible.
- Missing data is not represented as zero.
- History links back to Scenario Page and Expert Visualizer with context.

## Handoff To Plan 07

Plan 07 may start only after:

- History point semantics are stable.
- Scenario/output/lens/size context can be deep-linked from history.
