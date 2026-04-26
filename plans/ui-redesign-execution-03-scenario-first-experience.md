# UI Redesign Execution 03: Scenario-First Experience

## Position In Chain

Start only after `02-read-models-and-shared-rows` acceptance checks pass.

## Goal

Build the first user-facing scenario-centered experience:

- Scenarios Home
- Scenario Page
- first-run/setup states
- shared output-row presentation
- mini-viz baseline behavior

This plan proves the core product model before PR review, compare, history, expert visualizer, or policy enforcement is expanded.

## Non-Goals

- Do not build full PR Review Mode.
- Do not build union compare.
- Do not build real policy enforcement.
- Do not redesign full Expert Visualizer.

## Scenarios Home

Default app landing page.

User goal:

```text
What scenarios exist, where did they come from, and what needs attention?
```

Sections:

- Needs attention
- Recently changed
- Uncovered / no policy
- Stale / missing
- Healthy

Each card/row shows:

- Scenario name.
- Source/kind.
- Policy coverage.
- Latest status.
- Environment count.
- Output count.
- What's-counted count.
- Last run.
- Exactly one labeled mini-viz or deterministic status chip.

Support card/list density toggle.

## First-Run Setup State

Empty state must explain:

```text
Scenarios are what Chunk Scope tracks.
Each scenario can produce outputs, and each output can be measured using one or more byte-counting modes.
```

Setup flow:

- Detected captured Vite scenarios.
- Add synthetic export scenarios.
- Choose tracked scenarios.
- Confirm outputs.
- Choose default `What's counted`.
- Optionally add policy.
- Run first measurement.

Each step must be labeled as:

- Detected
- Selected
- Configured

## Scenario Page

Canonical object page for one scenario.

Default layout:

```text
Scenario summary
Recommended next action
Current outputs
History module
Policies context
Expert actions
```

Current Outputs default row columns:

- Output
- Current
- Delta
- Policy state
- Mini-viz
- Primary action

Expanded row shows:

- What's counted.
- Size.
- Baseline.
- Measurement state.
- Effective policy scope.
- Evidence availability.
- Expert links.

History module:

- Fixed `What's counted` and `Size`.
- Main branch by default.
- Branch add/select support where data exists.
- Line cap and small multiples to prevent chart spaghetti.
- Missing points render as gaps.

## Mini-Viz Acceptance

Every scenario card and output row must render one primary visual signal or an explicit status chip.

Allowed:

- Delta bar.
- Delta bar with threshold marker.
- Sparkline when history is sufficient.
- State strip when run state is the primary signal.
- Status chip when visual data is unavailable or misleading.

## Responsive Behavior

- Scenario cards become single-column on mobile.
- Output rows become grouped cards on mobile.
- Expanded row details become accordions or bottom sheets.
- History module collapses below outputs.

## Tests

Add tests for:

- no scenarios
- configured scenario with no runs
- failed latest run
- missing baseline
- multiple environments
- multiple entrypoints
- multiple lenses
- mini-viz fallback
- mobile landmark/order expectations where e2e coverage exists

## Acceptance Criteria

- A user can explain what a scenario is from the UI alone.
- Scenario Home is not a generic dashboard.
- Scenario Page shows outputs without hiding environment/entrypoint/lens semantics.
- Mini-viz appears or has explicit fallback.
- No generic filter-first entry point exists.
- No confidence or sourcemap UI exists.

## Handoff To Plan 04

Plan 04 may start only after:

- Scenario Home/Page are usable with shared rows.
- Output row visual grammar is proven.
- First-run and degraded states are represented.
