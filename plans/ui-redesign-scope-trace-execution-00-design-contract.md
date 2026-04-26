# UI Redesign Scope Trace Execution 00: Design Contract

## Position In Chain

Start this before changing route layouts. This plan defines the shared contract for the Scope Trace implementation.

## Goal

Create a concrete UI/design contract that makes the Scope Trace model reusable across Home, Review, Scenario, and Policies without reintroducing dashboard clutter.

## Non-Goals

- Do not implement the full visual redesign in this slice.
- Do not add command palette or keyboard shortcuts.
- Do not add density modes.
- Do not redesign mobile beyond trivial responsive safety.
- Do not make Compare or Timeline top-level destinations.

## Deliverables

- Define a `TraceClaim` UI/read-model shape.
- Define a `TraceSpine` presentation contract.
- Define user-facing state labels for existing measurement, policy, compatibility, evidence, and review states.
- Define the mini-viz vocabulary and mapping rules.
- Define shared claim row/card anatomy.
- Define empty and huge Needs attention states.
- Add fixture examples that exercise slow-moving library and high-volume repository cases.

## Proposed Implementation Locations

- `packages/contracts/src/ui-semantics.ts`: shared labels, trace state enums, mini-viz vocabulary updates when they are cross-package contracts.
- `apps/web/src/lib/scope-trace.ts`: web-only trace claim helpers, trace URL helpers, and mini-viz selection rules.
- `apps/web/src/lib/public-read-models/scope-trace.server.ts`: server read models for trace claims and attention digests.
- `apps/web/src/components/scope-trace.tsx`: trace spine, trace claim row, and boundary summary components.
- `apps/web/test/scope-trace.test.ts`: unit coverage for labels, claim fixtures, URL preservation, and mini-viz selection.

## Trace Claim Contract

A trace claim is the central unit used by Review, Needs attention, and Scenario output summaries.

Required-for-linking fields:

- `scenarioId`
- `scenarioSlug`
- `scenarioLabel`
- `environmentKey`
- `entrypointKey`
- `entrypointKind`
- `outputLabel`
- `lensId`
- `lensLabel`
- `sizeMetric`
- `traceStep`
- `traceUrl`

Required-for-display fields:

- `claimSentence`
- `countRuleSentence`
- `includedSummary`
- `excludedSummary`
- `currentValueBytes`
- `baselineValueBytes`
- `deltaBytes`
- `deltaPercent`
- `policyResult`
- `policyLimitBytes`
- `policyVersion`
- `measurementState`
- `evidenceState`
- `evidenceSummary`
- `miniViz`
- `primaryActionLabel`

Measurement states should be deterministic and concrete:

- complete
- missing baseline
- measurement failed
- non-comparable
- not measured

Evidence states should be separate:

- available
- evidence missing
- evidence stale
- partial evidence
- unavailable

Avoid a generic confidence concept.

## Trace Spine Contract

Trace spine nodes:

- Scenario
- Output
- What's counted
- Size
- Evidence

Each node has:

- label
- question
- current value
- state
- optional mini-viz only if it answers the node question and no major visualization is present

Node questions:

- Scenario: what are we evaluating?
- Output: what result is in scope?
- What's counted: what is inside the boundary?
- Size: how large is it?
- Evidence: can we prove it?

The spine is orientation, not a broad filter bar. It should not become a second dashboard.

Canonical trace URL parameters:

- `output`: stable output label or encoded environment/entrypoint pair
- `env`: environment key when needed for existing routes
- `entrypoint`: entrypoint key when needed for existing routes
- `lens`: what's counted identifier
- `metric`: selected size metric
- `trace`: active trace step, one of `output`, `counted`, `size`, `evidence`, `policy`
- `base`: baseline SHA when relevant
- `head`: head SHA when relevant
- `claim`: claim identifier when Review or Needs attention links to a specific claim

## State Label Map

Create a single user-facing label map for raw states.

Examples:

- `fail_blocking` -> `Blocks merge`
- `fail_non_blocking` -> `Fails limit`
- `not_configured` -> `No limit set`
- `not_evaluated` -> `Not evaluated`
- `missing_baseline` -> `No baseline yet`
- `same` -> `Comparable`
- `unsupported_lens` -> `Unsupported count`

Acceptance requires no raw enum labels in normal UI text.

## Mini-Viz Vocabulary

Allowed mini-viz types:

- status distribution strip
- delta bar
- threshold or budget bar
- sparkline
- included/excluded boundary bar
- evidence coverage or freshness bar
- blast-radius strip

Rules:

- Use at most one mini-viz per scenario row, output row, trace node, or claim row.
- Do not show a mini-viz if plain text is clearer.
- Do not show a mini-viz when a major chart nearby answers the same question.
- Do not color positive/negative direction as good/bad without policy or outcome context.
- Show exact numbers next to visual summaries.

Selection priority:

| Claim state | Mini-viz |
| --- | --- |
| blocking or warning limit with threshold | threshold or budget bar |
| missing or stale evidence affects trust | evidence coverage or freshness bar |
| counted boundary changed or is central | included/excluded boundary bar |
| recent comparable history is the point | sparkline |
| grouped digest with many affected claims | blast-radius strip |
| quiet passing row | no mini-viz by default |

Page-level rule:

- selected trace claim gets visual priority
- blocking or ambiguous claims may show a mini-viz
- quiet supporting rows should use text only
- major charts suppress duplicate mini-viz for the same concept
- dense lists suppress mini-viz unless the row is changed, blocked, or trust-affecting
- boundary bars must show exact included/excluded counts adjacent to the visual

## Needs Attention Contract

Needs attention is not primary navigation.

Quiet state fields:

- reviewed scenario count
- reviewed output count
- latest checked timestamp
- evidence freshness summary
- optional latest change summary

Huge digest fields:

- group reason
- affected claim count
- severity
- highest impact scenario/output
- repeated cause summary when available
- primary action

Reason groups:

- blocking policy
- measurement failed
- missing baseline
- evidence missing or stale
- count boundary changed
- repeated cause
- high blast radius

Scale rules:

- 0 items: quiet health receipt
- 1-5 items: compact claim list
- 6-49 items: digest first, grouped rows after
- 50+ items: grouped digest only by default

## Tests

Add unit tests for:

- state label mapping
- trace claim fixture construction
- mini-viz selection rules
- Needs attention quiet state
- Needs attention huge digest grouping
- trace URLs preserving scenario/output/count/size/evidence context
- plain text winning over mini-viz when no visual is useful
- major chart suppressing duplicate mini-viz
- red/green outcome color only appearing with outcome context

## Acceptance Criteria

- Scope Trace vocabulary is defined in code or a shared UI helper with tests.
- Trace claim fixtures cover passing, warning, blocking, missing baseline, missing evidence, and non-comparable cases.
- Mini-viz rules are deterministic and tested.
- Needs attention has both quiet and huge digest examples.
- No implementation plan depends on raw enum labels in user-facing UI.
- The contract doc links back to `plans/ui-redesign-scope-trace.md`.
- A quiet repository fixture, high-volume repository fixture, and blocking PR fixture each produce one clear first action.
