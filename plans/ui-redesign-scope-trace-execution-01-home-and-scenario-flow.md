# UI Redesign Scope Trace Execution 01: Home And Scenario Flow

## Position In Chain

Start after Execution 00 acceptance checks pass.

This slice makes the primary product flow obvious: pick a scenario, select an output, follow the trace to counted bytes, size, and evidence.

## Goal

Rebuild Home and Scenario pages around the Scope Trace model.

## Non-Goals

- Do not rebuild Review in this slice.
- Do not add top-level Compare or Timeline.
- Do not add command palette, keyboard shortcuts, or density modes.
- Do not build advanced evidence visualizations beyond the selected trace endpoint.

## Home Structure

Home should use this MVP order:

```text
Project status
Tracked scenarios
Quiet attention strip or attention digest
```

Home should avoid empty operational groups.

Latest review and recent measurements should live inside Project status unless they contain actionable changes.

Tracked scenario rows should answer:

- what scenario is this?
- what was the latest review or measurement state?
- what changed recently?
- is anything blocking trust?
- where do I enter the trace?

Scenario row fields:

- scenario name
- source kind
- representative output summary, selected deterministically by current blocker, largest selected-size delta, then most recent measurement
- selected size metric value
- change from baseline when available
- limit result when available
- evidence state
- optional one mini-viz selected by Execution 00 rules for changed, blocked, or trust-affecting scenarios
- primary action: `Open trace`

## Home Needs Attention Behavior

For quiet repositories, show a small health receipt instead of an empty section.

Example:

```text
No bundle issues right now.
Latest measurement passed for 6 scenarios.
Last checked 12 minutes ago.
```

For high-volume repositories, show a digest before any list. Do not render a flat list by default for 50 or more attention claims.

Example:

```text
Start here
1. Checkout: 6 blocking outputs · strong evidence
2. Search: size doubled · missing baseline
3. Billing: evidence stale for 9 outputs
```

## Scenario Page Structure

Scenario page should use this order:

```text
Scenario header
Outputs selector
Trace spine for selected output
What's counted
Size
Evidence
Policy trace
```

The page should feel like one selected output trace, not a dashboard of all possible details.

If no output has been selected, choose a default output deterministically by current blocker, largest selected-size delta, then first stable output label. The default active trace step should be What's counted (`trace=counted` or equivalent) so the boundary is central before users interpret size. The trace spine should show incomplete output state only when there is no measured output.

## Outputs Selector

The Outputs selector handles plural outputs.

Requirements:

- group outputs by environment
- show output label and entrypoint kind
- show current selected size value
- show delta when available
- show limit result when available
- show evidence state
- may show one mini-viz per output row when it answers the row's primary triage question
- suppress mini-viz for quiet unchanged rows
- selecting an output updates the trace context
- selected output remains visually obvious

## What's Counted Step

This is the core inspection surface.

The counted boundary must be the dominant content block after output selection. It should appear before size interpretation and include a plain-language boundary sentence.

It should show:

- counted groups or files
- excluded groups when available
- rule/lens sentence explaining why those bytes count
- included/excluded mini-viz when useful
- exact included and excluded counts next to any boundary mini-viz
- unsupported or missing count state when applicable

Avoid presenting this as a generic raw table first. Raw tables can follow the boundary explanation.

## Size Step

This should show:

- exact current raw/gzip/brotli values
- selected size metric as the primary value
- baseline value when available
- delta bytes and percentage when available
- policy limit or expected range when available
- one mini-viz unless a major chart is present

## Evidence Step

This should show:

- evidence availability summary
- evidence source categories: asset, chunk, module, package, unknown, unavailable
- direct action to inspect evidence
- honest unavailable reason

Evidence is attached to the selected claim. Do not show generic expert tabs before output selection.

## Policy Trace Step

This should show:

- matching policy or no limit state
- sentence rule
- policy result
- threshold and actual value
- accepted decision when active
- link to policy management

## Tests

Add or update tests for:

- Home quiet attention state
- Home huge attention digest fixtures
- scenario rows linking to trace context
- output selection preserving scenario/output/count/size context
- no empty scenario groups rendered by default
- no raw enum labels on Home and Scenario pages
- selected output mini-viz presence when useful and suppression for quiet non-selected rows

## Acceptance Criteria

- Home communicates project state without depending on Needs attention being populated.
- Home works for a quiet repository and a high-volume digest fixture.
- Scenario page visibly follows Scenario -> Output -> What's counted -> Size -> Evidence.
- Output selection is the primary scenario-page interaction.
- What's counted is more visually prominent than generic metadata.
- A user can understand the counted boundary before interpreting the size value.
- Evidence is attached to the selected output claim.
- Compare and Timeline remain contextual actions only.
