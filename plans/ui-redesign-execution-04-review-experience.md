# UI Redesign Execution 04: Review Experience

## Position In Chain

Start only after `03-scenario-first-experience` acceptance checks pass.

## Goal

Build PR/release Review Mode using the scenario/output row model proven in Plan 03.

Review is a decision surface, not a generic table page.

## Non-Goals

- Do not implement real policy enforcement unless Plan 08 is complete.
- Do not wire final GitHub check/comment behavior yet.
- Do not build full union compare.
- Do not build generalized expert visualizer behavior.

## Review Mode Purpose

Answer:

- Can this PR/release proceed from a bundle perspective?
- Which scenarios are affected?
- Which outputs changed?
- What should be inspected or acted on next?

## Layout

Default structure:

```text
Verdict hero
Why this verdict
Top affected scenarios
Scenario groups
Selected output evidence
Actions
```

Do not start with a dense table.

Top risks expanded by default.
Other scenario groups collapsed with meaningful summaries.

## Verdict States

Use deterministic precedence:

```text
measurement failed
incomplete
missing baseline
blocked policy
needs decision
no policy
pass
```

Show both:

- Measurement state.
- Policy state.

Do not synthesize risk ranking or verdicts without source data.

## Review Rows

Rows reuse `OutputRow`, but Review Mode changes emphasis.

Default row priority:

- Output
- Delta
- Policy state
- Mini-viz
- Action

Expanded row shows full context:

- What's counted.
- Size.
- Current.
- Baseline.
- Measurement state.
- Effective policy scope.
- Evidence availability.

## Evidence Actions

Selected row can:

- Open detail/evidence action.
- Open scenario page.
- Open compare preset.
- Open policy context.

If evidence is unavailable, show reason. Do not open fake charts.

## Release Review Preset

Add release readiness as a Review preset, not a separate dashboard:

- release candidate vs last release
- release candidate vs main
- release candidate vs tag

This can remain read-only/advisory until policy enforcement and GitHub integration exist.

## Tests

Add tests for:

- PR with changed outputs.
- PR with no policy.
- PR with missing baseline.
- PR with failed measurement.
- PR with unavailable evidence.
- Top risks expanded and lower-risk groups collapsed.
- No fake policy blocking.
- No confidence/sourcemap UI.

## Acceptance Criteria

- Review Mode clearly answers what changed and what action is next.
- Review Mode reuses shared rows without flattening scenario/output/lens semantics.
- Verdict hero does not imply enforcement before policy exists.
- Evidence actions are honest about availability.
- GitHub final behavior remains out of scope until Plan 09.

## Handoff To Plan 05

Plan 05 may start only after:

- Review Mode uses shared rows correctly.
- Review states are deterministic and tested.
- No fake policy blocking remains.
