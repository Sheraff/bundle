# UI Redesign Scope Trace Execution 03: Evidence, Policies, And Contextual Tools

## Position In Chain

Start after Execution 02 acceptance checks pass.

This slice completes the trace endpoint and keeps Compare/Timeline contextual.

## Goal

Make evidence, policies, compare, and timeline support trace claims without becoming competing dashboards.

## Non-Goals

- Do not add top-level Compare or Timeline navigation.
- Do not add command palette or keyboard shortcuts.
- Do not add density modes.
- Do not require sourcemaps.

## Evidence Endpoint

Evidence is the proof layer for a trace claim.

MVP evidence should be a focused route or focused page state opened from a specific scenario/output/count/size claim. It should not be a generic repository evidence dashboard.

It should show:

- trace claim summary
- what's counted boundary recap
- current and baseline context when available
- evidence availability
- assets table
- packages table
- unavailable reason when evidence is missing

Existing expert visualizations remain available when already supported:

- treemap for composition
- waterfall for cause
- graph for module/chunk relationships
- identity/compatibility detail when relevant

The claim summary and what's counted recap should remain visually primary above expert visualizations.

Evidence must not imply source-line attribution.

The evidence view must provide a clear return action to the originating trace.

## Evidence Summary Near Claims

Inline evidence summaries should remain lightweight.

Examples:

- Evidence available: chunks, modules, packages
- Evidence partial: no package attribution
- Evidence missing: baseline snapshot unavailable
- Evidence stale: last evidence from previous commit

## Policy Trace

Policies should appear as limits attached to trace claims.

Policy trace should show:

- sentence rule
- counted-scope sentence
- scope: scenario, output, size metric
- actual value
- threshold value
- result
- blocking or warning consequence
- policy version
- accepted decision when active
- link to edit/manage policy

Policy labels should use user-facing language like `Limit`, `Blocks merge`, and `Warns only`.

## Contextual Compare

Compare is an action from a trace claim.

Entry points:

- Compare this output with PR base
- Compare this output with main
- Compare this output with previous measurement
- Compare this output with custom measurement later, after the core trace flow is clear

Compare view should preserve:

- scenario
- output
- what's counted
- selected size metric
- base/head
- policy result when available
- evidence link

The first compare implementation can reuse existing compare data but must enter through a claim context.

## Contextual Timeline

Timeline is an action from a trace claim.

Timeline should show:

- selected scenario/output/count/size context
- current point
- baseline point when available
- missing data markers
- policy threshold or expected range when available
- evidence gaps when relevant

Do not make broad repository history the default Timeline surface in this slice.

Timeline is the major visualization in this view. Suppress duplicate claim-level mini-viz for the same history signal.

## Tests

Add or update tests for:

- evidence route/focused view requires a full trace context
- evidence unavailable reasons remain visible
- policy trace shows sentence rule, threshold, actual value, and consequence
- accepted decisions render in policy trace
- compare links preserve trace context
- timeline links preserve trace context
- evidence, policy, compare, and timeline views show the originating claim summary at the top
- focused evidence view has a return-to-trace action
- no sourcemap/source-line attribution claims
- no raw enum labels in evidence or policy trace UI

## Acceptance Criteria

- Evidence is opened from a claim and remains attached to that claim.
- Policy trace explains exactly why a claim passed, warned, failed, or was accepted.
- Compare and Timeline are contextual actions, not top-level mental models.
- Existing expert visualizations remain available from evidence.
- Missing evidence is explicit and never shown as success.
- Evidence and policy trace cannot render generic repository defaults without full trace context.
- The app still passes the crystal-clear acceptance test from `plans/ui-redesign-scope-trace.md`.
