# UI Redesign Execution 09: GitHub And Release Integration

## Position In Chain

Start only after `08-policies-experience` acceptance checks pass.

This is the final integration plan for PR checks/comments and release-readiness review.

## Goal

Wire real policy evaluation and scenario-centered review state into GitHub and release workflows.

## Non-Goals

- Do not invent new policy semantics.
- Do not change scenario/output/lens identity.
- Do not add sourcemaps or confidence.

## GitHub Check/Comment Behavior

GitHub output should show:

- overall verdict
- top affected scenarios
- top output/lens rows
- blocking/warning policy outcomes
- measurement failures
- missing baselines
- link to hosted Review Mode

Conclusion mapping must be explicit:

- pass -> success
- blocking fail -> failure
- warning/no policy -> neutral or success by repo setting
- measurement failed -> failure or neutral by repo setting
- missing baseline -> neutral or failure by repo setting

## Idempotency And Retry

Define:

- check run identity
- comment identity
- idempotency key
- target SHA/ref
- repository ID
- PR number
- policy result version
- decision record ID when relevant

GitHub updates must be idempotent.

## Release Readiness

Release readiness is a Review preset:

```text
release candidate vs last release
release candidate vs main
release candidate vs tag
```

It should show:

- scenarios required for release
- blocking policy failures
- warnings
- accepted decisions
- missing measurements
- unavailable artifacts
- linkable/shareable report

## Final Regression Gate

Before considering the redesign chain complete, verify:

- Scenarios Home does not reintroduce filter-first UI.
- Review Mode is decision-first.
- Scenario Page is object-first.
- Compare Mode uses compatibility and union pairing.
- History uses fixed `What's counted` + `Size`.
- Expert Visualizer remains contextual.
- Policies are scenario-scoped and real.
- GitHub output reflects real policy state.
- No confidence UI exists.
- No sourcemap-required UI exists.
- Missing/unavailable data never appears as zero/success.

## Tests

Add tests for:

- GitHub check conclusion mapping.
- GitHub comment rendering.
- idempotent update behavior.
- retry behavior.
- auth/error handling.
- accepted decision overlay.
- release-readiness report.
- no fake policy state.

Run:

```bash
pnpm web:test
pnpm web:typecheck
pnpm github-action:test
pnpm github-action:typecheck
```

Add e2e coverage if the hosted review flow changes:

```bash
pnpm web:test:e2e
```

## Acceptance Criteria

- GitHub PR output is consistent with hosted Review Mode.
- Release-readiness review is supported as a preset.
- Check/comment behavior is idempotent and tested.
- Final regression gate passes.
- Old filter-first UI surfaces are removed or unreachable according to the cutover stance from Plan 00.
