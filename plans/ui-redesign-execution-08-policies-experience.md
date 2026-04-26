# UI Redesign Execution 08: Policies Experience

## Position In Chain

Start only after `07-expert-visualizer-experience` acceptance checks pass.

## Goal

Implement real scenario-scoped policies, evaluation, and policy UI.

Policies should be visible in context on Review, Scenario, Compare, and History surfaces.

## Non-Goals

- Do not wire final GitHub check/comment behavior yet.
- Do not add asset-class policies unless aggregate comparison items exist.
- Do not imply enforcement before evaluation exists.

## Policy Model

Minimum fields:

- policyId
- repositoryId
- scenarioId
- optional environment
- optional entrypoint
- optional lens / What's counted
- required Size metric
- operator
- threshold
- severity
- blocking
- enabled
- policy version
- created/updated timestamps

Policy result fields:

- policyId
- comparison/run context
- actual value
- threshold
- result
- severity
- message
- evaluatedAt

Accepted decision fields:

- owner/actor
- reason
- scope
- optional expiry
- related policy/result

## Policy UI

Scenario-first list.

Rule builder reads like a sentence:

```text
Block if gzip size for Entry JS + direct CSS on client / index.html grows by more than 10 KB.
```

Policy consequence labels:

- Blocks merge
- Warns only
- No enforcement
- Not evaluated

Policy cells should open details:

- rule name
- scope
- size metric
- threshold
- enforcement mode
- matching reason
- inherited/broad/exact scope

## Integration With Existing Rows

Update shared rows to show real policy evaluation.

Do not collapse policy and measurement state.

Policy state must remain separate from measurement state.

## Tests

Add tests for:

- scenario-wide policy
- output-scoped policy
- lens-scoped policy
- size-metric policy
- pass
- warn
- non-blocking fail
- blocking fail
- disabled policy
- accepted decision
- expired accepted decision
- missing data cannot evaluate policy

## Acceptance Criteria

- Real policy evaluation exists.
- Policy UI can create/edit scenario-scoped policies.
- Policy results appear in Review/Scenario/Compare rows.
- No fake blocking remains.
- Policy state is distinct from measurement state.

## Handoff To Plan 09

Plan 09 may start only after:

- Policy evaluation is deterministic.
- Policy result rows exist.
- Accepted decision records exist if needed.
- UI surfaces display real policy outcomes.
