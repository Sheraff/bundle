# UI Redesign Execution 05: Compare Experience

## Position In Chain

Start only after `04-review-experience` acceptance checks pass.

## Goal

Build Compare Mode with real base/head union pairing and compatibility explanations.

Compare Mode answers:

```text
What changed between these two available measured artifacts?
```

## Non-Goals

- Do not compare unbuilt refs.
- Do not imply policy-grade comparison for partial/exploratory comparisons.
- Do not build final expert visualizer redesign.
- Do not implement policy enforcement.

## Entry Presets

Default compare should start from presets:

- PR base vs head.
- Current vs main.
- Release candidate vs last release.
- Run vs run.

Advanced compare exists behind an explicit affordance.

## Union Pairing Read Model

Build a base/head union read model.

Pair by comparable key:

```text
scenario + environment + entrypoint + lens
```

Use the `entrypointKind` decision from Plan 01.

Classify rows:

- same
- added
- removed
- unavailable
- unsupported_lens
- missing_size
- invalid

Current limitation:

- Do not claim removed support until this read model exists.

## Compatibility Labels

Compatibility classes:

- exact
- partial
- exploratory
- invalid

Policy-grade compare requires exact compatibility.

Partial/exploratory compare is advisory.

Compatibility explainer should show each dimension:

- scenario
- environment
- entrypoint
- What's counted
- Size
- build/config identity
- artifact availability

## UI Layout

- Preset/base-head selector.
- Scenario groups.
- Output rows with comparison state.
- Mini-viz for comparable rows.
- State pill for added/removed/unavailable rows.
- Selected row evidence action.

Mobile:

- Base / Head / Diff segmented control.
- Row-first layout.
- No forced side-by-side panes.

## Tests

Add tests for:

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
- gaps are not zeros

## Acceptance Criteria

- Compare Mode uses union pairing, not head-only derivation.
- Added/removed/unavailable are distinct.
- Compatibility is visible and inspectable.
- Policy-grade language appears only for exact comparisons.
- Existing PR Review behavior does not regress.

## Handoff To Plan 06

Plan 06 may start only after:

- Compare pairing semantics are stable.
- Compatibility labels are tested.
- Union rows reuse shared row semantics.
