# UI Redesign Scope Trace Execution 02: Review Claims

## Position In Chain

Start after Execution 01 acceptance checks pass.

This slice makes Review a decision summary over trace claims.

## Goal

Rebuild Review so a PR or release decision is clear without learning a separate dashboard model.

## Non-Goals

- Do not rebuild Scenario page again in this slice.
- Do not add broad Compare or Timeline pages.
- Do not add command palette or keyboard shortcuts.
- Do not add density modes.

## Review Promise

Review answers:

```text
Can this PR or release proceed?
```

Every reason in Review must be a trace claim that can open the exact Scope Trace position.

## Verdict States

Use plain decision labels:

- Acceptable
- Needs decision
- Blocked
- Incomplete measurement

Mapping guidance:

- blocking policy failure -> Blocked
- measurement failure -> Incomplete measurement
- missing baseline -> Needs decision
- warning policy -> Needs decision
- no limit on changed output -> Needs decision
- accepted decision -> Acceptable only if no unresolved blocking or missing evidence remains
- complete measurements with passing policies -> Acceptable

Incomplete measurement is not acceptable. GitHub publication may still map it to failure or neutral later, but the Review UI must not call it Acceptable.

## Review Layout

Use this structure:

```text
Verdict
Why this verdict
Top trace claims
Conditional accepted decisions
Conditional missing or stale evidence
All changed claims grouped by scenario
```

Avoid rendering every scenario as equal weight at the top.

## Trace Claim Rows

Claim rows should read like a sentence.

Example:

```text
Marketing app · client / index.html
Entry JS + direct CSS · gzip
+8.2 kB vs main · under 10 kB limit
Evidence available
Open trace
```

Required visible fields:

- scenario
- output
- what's counted
- selected size metric
- current value
- baseline value when available
- delta when available
- policy result
- evidence state
- optional one mini-viz selected by Execution 00 rules for top, blocking, or ambiguous claims
- primary action: `Open trace`

Primary action should be singular. Secondary actions can appear inside trace or evidence detail.

## Grouping

Default grouping order:

- blocking policy failures
- measurement failures
- missing baselines
- warning or non-blocking policy failures
- no limit on changed output
- accepted decisions
- improvements
- unchanged claims omitted or collapsed

Within each group, sort by policy severity, absolute selected-size delta, scenario name, and output name.

For high-volume reviews, show a digest before full rows.

Digest examples:

- 4 blocking policy failures across 3 scenarios
- 8 changed outputs without limits
- 3 measurement failures
- repeated cause: `@vendor/charting` in 7 claims

For quiet reviews, show what was checked.

Example:

```text
Acceptable
Reviewed 8 trace claims across 3 scenarios.
All measured outputs have current evidence and passing limits.
```

## Actions

Recommended actions should be concrete:

- Open trace

Secondary actions available from trace or evidence detail:

- Inspect evidence
- Compare this output
- Show timeline
- Open policy trace
- Accept with note
- Fix measurement setup

Do not show generic action cards that do not move the decision forward.

## Tests

Add or update tests for:

- verdict state mapping
- trace claim row construction
- review grouping order
- high-volume digest fixture
- `Open trace` URLs preserving scenario/output/count/size/evidence context
- accepted decision rendering
- missing evidence rendering
- no raw enum labels in Review
- unchanged or collapsed claims do not render mini-viz by default

## Acceptance Criteria

- A user can determine PR/release acceptability from Review without visiting another page.
- Every blocking or warning reason has an exact trace link.
- Review uses the same claim row vocabulary as Scenario page outputs.
- Huge reviews show a digest before rows.
- Quiet reviews clearly say what was checked.
- Compare and Timeline appear only as contextual actions on claims.
- No unresolved claim appears only in a collapsed group.
