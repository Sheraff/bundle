# UI Redesign Scope Trace

## Status

Accepted direction for the next UI simplification pass after the scenario-centered redesign chain.

This direction supersedes dashboard cleanup as the primary UX strategy. The goal is not to reorganize the same surfaces. The goal is to make the product understandable through one repeatable explanation flow.

## Product Promise

```text
For this scenario, this output counts these files, weighs this much, and here is the evidence.
```

That sentence is the UI model.

## Core Flow

Every important surface should lead users through the same trace:

```text
Scenario -> Output -> What's counted -> Size -> Evidence
```

This is not just the data model. It is the visible interaction model.

## Why This Exists

The current redesign follows the correct product model, but it still feels like several organized dashboards. Users can still struggle to answer:

- where am I?
- what object am I inspecting?
- what exactly is counted?
- how big is it?
- why should I trust this number?
- what should I do next?

Scope Trace makes the app a guided explanation path rather than a collection of reports.

## Main IA Decisions

- Scenario is the home inventory object, not a filter.
- Output is the main selectable object inside a scenario.
- What's counted is the visual and conceptual center of the scenario page.
- Size is the quantified claim for the selected output and counted scope.
- Evidence is attached to the claim, not presented as a detached expert appendix.
- Review is a decision summary over trace claims, not a separate dashboard universe.
- Compare and Timeline are contextual actions launched from a trace claim for now.
- Policies are limits attached to scenario/output/counting/size claims.
- Needs attention is an adaptive triage strip or digest, not primary navigation.

## Top-Level Navigation

Use fewer destinations during this pass:

```text
Home
Review
Scenarios
Policies
```

Contextual actions from trace claims:

- Compare this output
- Show timeline
- Inspect evidence
- Open policy trace

Do not make Compare or Timeline full peer destinations until the Scope Trace flow is clear.

## Home

Home should not be a giant Needs attention page.

MVP Home structure:

```text
Project status
Tracked scenarios
Quiet attention strip or attention digest
```

Latest review and recent measurements belong inside Project status unless they contain actionable changes.

For slow-moving repositories, Needs attention is often empty and should not create a dead surface.

Quiet state example:

```text
No bundle issues right now.
Latest measurement passed for 6 scenarios.
Last checked 12 minutes ago.
```

For high-volume repositories, Needs attention can be huge and should be grouped before it becomes a list.

Digest example:

```text
Needs decisions: 12
Blocking policy failures: 4
Measurement failures: 3
Missing baselines: 8
Repeated cause: @vendor/charting in 7 PRs
```

Group huge attention states by reason, impact, recurrence, and blast radius.

Scale rules:

- 0 items: show a quiet health receipt.
- 1-5 items: show a compact claim list.
- 6-49 items: show a digest first, then grouped rows.
- 50+ items: show grouped digest only by default, with no flat list.

## Scenario Page

The Scenario page is the core product surface.

It follows the trace exactly:

```text
Scenario header
Trace spine
Outputs selector
What's counted
Size
Evidence
Policy trace
```

Plural outputs are handled by the Outputs selector. A trace belongs to one selected output or output group.

Trace node questions:

- Scenario: what are we evaluating?
- Output: what result is in scope?
- What's counted: what is inside the boundary?
- Size: how large is it?
- Evidence: can we prove it?

## Review

Review answers:

```text
Can this PR or release proceed?
```

Review rows are trace claims, not generic findings.

Claim row example:

```text
Marketing app · client / index.html
Entry JS + direct CSS · gzip
+8.2 kB vs main · under 10 kB limit
Evidence available
Open trace
```

Every review claim links to the exact scenario/output/count/size/evidence position.

## Needs Attention

Needs attention should adapt to volume.

When empty:

```text
No attention needed
Reviewed 42 outputs across 8 scenarios · evidence current · checked 3m ago
```

When huge:

```text
Start here
1. Checkout: 6 blocking outputs · strong evidence
2. Search: size doubled · missing baseline
3. Billing: evidence stale for 9 outputs
```

Reason groups:

- blocking policy
- measurement failed
- missing baseline
- evidence missing or stale
- count boundary changed
- repeated cause
- high blast radius

Needs attention must point into trace claims. It must not become a second product model.

## Mini Data Viz

Mini data visualization should appear wherever it accelerates triage, comparison, or evidence judgment and there is no major visualization already answering the same question.

Rules:

- one mini-viz per unit
- one question per mini-viz
- suppress mini-viz when a major chart already answers the same thing
- red/green means outcome, not raw direction
- percent deltas must show baseline/current context nearby
- gauges or bullet bars require a real limit, target, or expected range
- no mini-viz if plain text is clearer

Suggested mapping:

- Scenario row: optional status distribution strip for changed, blocked, or trust-affecting scenarios
- Output row: optional delta or budget bar when it changes triage
- What's counted: included/excluded boundary bar when it clarifies scope
- Size claim: sparkline or bullet bar when there is a baseline, limit, or useful recent history
- Evidence: coverage or freshness bar when evidence affects trust
- Attention digest: blast-radius strip when many claims are grouped

Visual priority:

- active trace step gets first priority
- blocking or ambiguous claims get second priority
- quiet passing rows should usually use text only
- inactive trace nodes should use subdued text summaries

## What To Remove

- empty status groups on Home
- top-level Compare and Timeline for now
- equal-weight dashboard cards
- expert tabs before selecting an output
- mini-viz variety for its own sake
- generic filters before the user understands the trace
- pages where every section has equal visual weight
- Needs attention as a giant flat list

## Crystal-Clear Acceptance Test

Give a new user one repository with three scenarios and ask:

```text
Which files count toward the /dashboard initial load size, how big is it, and what proves that?
```

They pass only if they can answer in under 60 seconds:

- selected scenario
- selected output
- counted files or groups
- size metric and exact value
- evidence source

If they open a global dashboard, unrelated compare page, or ask what counted means, the UI is not clear enough.

Additional failure modes:

- counted files/groups are hidden behind a raw table-only view
- size is prominent before the count boundary is understandable
- evidence is detached from the selected scenario/output claim
- Home or Review does not provide one obvious action into the exact trace

## Canonical Trace Example

Example trace URL shape:

```text
/r/acme/widget/scenarios/dashboard?output=client%2Findex.html&lens=entry-js-direct-css&metric=gzip&trace=size
```

The implementation may use existing route/query conventions, but every trace link must preserve:

- scenario
- output/environment/entrypoint
- what's counted
- size metric
- active trace step
- baseline/head when relevant

## What's Counted Example

Boundary sentence:

```text
Entry JS + direct CSS counts JavaScript reachable from client / index.html plus CSS directly imported by those entry chunks.
```

Summary:

```text
Counted: 18 chunks, 142 modules, 3 CSS assets
Excluded: async route chunks, server-only modules, unrelated assets
```
