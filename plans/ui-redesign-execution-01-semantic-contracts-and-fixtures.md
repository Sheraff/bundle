# UI Redesign Execution 01: Semantic Contracts And Fixtures

## Position In Chain

Start only after `00-inventory-and-cutover` acceptance checks pass.

This plan defines the semantic contracts that every later UI surface must use.

## Goal

Create stable language, identities, states, and fixtures for the scenario-centered UI.

This plan prevents later surfaces from reintroducing old filter semantics or inconsistent row models.

## Core Invariant

All fixtures and contracts must follow:

```text
Scenario -> Output -> What's counted -> Size -> Evidence
```

## Non-Goals

- Do not build major UI pages.
- Do not implement full policy evaluation.
- Do not implement compare union pairing.
- Do not generalize expert visualizers.

## Deliverables

### User-Facing Terminology Contract

Define and document UI labels:

- Scenario
- Output
- What's counted
- Size
- Evidence

Required definitions:

```text
Scenario: one reproducible bundle target your team tracks over time.
Output: a build target measured inside a scenario, displayed as environment / entrypoint.
What's counted: the byte-counting lens used for an output.
Size: raw, gzip, or brotli byte metric.
```

### Identity Contracts

Define:

- `ScenarioId`
- `EnvironmentKey`
- `EnvironmentLabel`
- `EntrypointKey`
- `EntrypointKind`
- `LensId`
- `SizeMetric`
- `ComparableSeriesKey`
- `OutputRowId`

Open decision to settle here:

```text
Does entrypointKind participate in ComparableSeriesKey?
```

Recommended decision:

```text
Include entrypointKind in future comparable identity unless the current data proves entrypoint keys cannot collide across kinds.
```

If schema migration is deferred, document that `entrypointKind` is metadata for now and add a test proving current keys do not collide.

### Lens Registry Contract

Define a registry shape for `What's counted`.

Minimum fields:

```ts
type LensDefinition = {
  id: string
  label: string
  explanation: string
  appliesToOutputKinds: string[]
  includedAssetRules: string[]
  excludedAssetRules: string[]
  traversal: "direct" | "initial" | "async" | "all-reachable" | "all-output"
  sharedChunkMode: "full" | "proportional" | "unique-only" | "separate"
  includesHtmlBytes: boolean
  includesRuntime: boolean
  version: number
}
```

Acceptance requires at least the current default lens:

```text
Entry JS + direct CSS
```

### State Enums

Define exact enum values for:

Measurement state:

- complete
- pending
- failed
- incomplete
- stale
- missing_baseline
- incompatible
- unsupported

Policy state:

- not_configured
- not_evaluated
- pass
- warn
- fail_non_blocking
- fail_blocking
- accepted
- disabled
- not_applicable

Evidence availability:

- available
- missing
- partial
- not_applicable
- error

Comparison state:

- same
- added
- removed
- unavailable
- unsupported_lens
- missing_size
- invalid

Compatibility:

- exact
- partial
- exploratory
- invalid

### Mini-Viz Contract

Define `miniViz` as typed data, not view-specific configuration.

Minimum shape:

```ts
type MiniViz =
  | { kind: "delta-bar"; current: number; baseline: number; delta: number; threshold?: number; unit: string }
  | { kind: "sparkline"; points: Array<{ x: string; value: number }>; unit: string }
  | { kind: "state-strip"; states: string[] }
  | { kind: "status-chip"; state: string; reason: string }
  | { kind: "none"; reason: string }
```

Rules:

- Mini-viz never replaces exact numbers.
- Missing or unavailable data must not render as zero.
- A threshold marker requires a named policy source.

### Fixture Matrix

Create canonical fixtures reused by plans 02-09.

Required fixtures:

- one scenario with one environment, one entrypoint, one lens
- one scenario with multiple environments
- one scenario with multiple entrypoints
- one scenario with multiple lenses
- missing baseline
- failed upload
- incomplete run
- unsupported lens
- added output
- removed output
- unavailable evidence
- no policy
- warning policy
- blocking policy
- accepted policy decision

### Negative Guardrails

Add tests or checks ensuring no UI/data contract introduces:

- confidence fields
- sourcemap-required fields
- source-line attribution assumptions

Sourcemaps may appear only as explicitly unsupported/future context.

## Tests

Add contract tests for:

- comparable key stability
- row key stability
- lens registry validation
- state enum exhaustiveness
- mini-viz fallback behavior
- fixture serialization
- no confidence/sourcemap fields

## Acceptance Criteria

- All identity contracts are documented and tested.
- Lens registry contract exists and includes the current default lens.
- State enums are explicit.
- Mini-viz contract is explicit.
- Canonical fixtures exist and can be reused by later plans.
- No later plan needs to invent terminology or row-state semantics.

## Handoff To Plan 02

Plan 02 may start only after:

- Output row identity and state contracts exist.
- Fixture matrix exists.
- Mini-viz contract exists.
- EntrypointKind identity stance is documented.
