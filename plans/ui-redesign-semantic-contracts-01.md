# UI Redesign 01 Semantic Contracts And Fixtures

## Status

Plan 01 execution artifact.

Primary code contract:

```text
packages/contracts/src/ui-semantics.ts
```

## User-Facing Terminology

Canonical product chain:

```text
Scenario -> Output -> What's counted -> Size -> Evidence
```

Definitions:

- Scenario: one reproducible bundle target your team tracks over time.
- Output: a build target measured inside a scenario, displayed as environment / entrypoint.
- What's counted: the byte-counting lens used for an output.
- Size: the raw, gzip, or brotli byte metric displayed for a measurement.
- Evidence: the bundle details that explain where the bytes came from.

Avoid these as primary UI labels:

- series
- metric when referring to raw/gzip/brotli
- lens when a non-expert label can say What's counted

## Identity Stance

Future comparable identity includes entrypoint kind:

```text
scenarioId + environmentKey + entrypointKind + entrypointKey + lensId
```

Decision:

```text
COMPARABLE_SERIES_KEY_INCLUDES_ENTRYPOINT_KIND = true
```

Why:

- The UI model treats Output as environment / entrypoint.
- The artifact model distinguishes `entry` and `dynamic-entry` entrypoint kinds.
- If two outputs have the same key but different kinds, treating them as one comparable subject would be ambiguous.

Current schema note:

- Current persisted `series` uniqueness does not include `entrypointKind`.
- No schema migration is made in Plan 01.
- Current normalized snapshots already reject duplicate entrypoint keys within one environment, which prevents same-run key/kind collisions in existing data.
- Later schema/read-model work should migrate persisted comparable identity to the future contract if needed.

Stable string forms:

- `comparableSeriesKeyToString()` returns `series:<scenario>:<environment>:<entrypointKind>:<entrypointKey>:<lens>` with URI-encoded parts.
- `outputRowIdFromComparableSeriesKey()` returns the same stable parts with an `output:` prefix.
- Size is deliberately excluded from comparable identity and row identity.

## Lens Registry

The `LensDefinition` contract is defined in `packages/contracts/src/ui-semantics.ts`.

Minimum current registry:

```text
Entry JS + direct CSS
```

Default lens properties:

- `id`: `entry-js-direct-css`
- `label`: `Entry JS + direct CSS`
- `traversal`: `direct`
- `sharedChunkMode`: `full`
- `includesHtmlBytes`: `false`
- `includesRuntime`: `true`
- applies to `entry` and `dynamic-entry`

## State Enums

Measurement states:

- `complete`
- `pending`
- `failed`
- `incomplete`
- `stale`
- `missing_baseline`
- `incompatible`
- `unsupported`

Policy states:

- `not_configured`
- `not_evaluated`
- `pass`
- `warn`
- `fail_non_blocking`
- `fail_blocking`
- `accepted`
- `disabled`
- `not_applicable`

Evidence availability states:

- `available`
- `missing`
- `partial`
- `not_applicable`
- `error`

Comparison states:

- `same`
- `added`
- `removed`
- `unavailable`
- `unsupported_lens`
- `missing_size`
- `invalid`

Compatibility states:

- `exact`
- `partial`
- `exploratory`
- `invalid`

Adapter note:

- Existing persisted values such as `not-configured` must be mapped at read-model boundaries before surfaces consume these UI semantics.

## Mini-Viz Contract

`MiniViz` is typed data, not component configuration.

Kinds:

- `delta-bar`
- `sparkline`
- `state-strip`
- `status-chip`
- `none`

Rules:

- Exact numbers remain visible separately.
- Missing current or baseline values produce `kind: "none"` rather than zero-filled visuals.
- Threshold markers are valid only with a named `policySource`.

## Canonical Fixtures

Canonical fixtures are exported as `canonicalUiFixtures`.

Fixture IDs:

- `single-output-complete`
- `multiple-environments`
- `multiple-entrypoints`
- `multiple-lenses`
- `missing-baseline`
- `failed-upload`
- `failed-build`
- `incomplete-run`
- `unsupported-lens`
- `added-output`
- `removed-output`
- `unavailable-evidence`
- `missing-size`
- `no-policy`
- `not-evaluated-policy`
- `warning-policy`
- `blocking-policy`
- `accepted-policy-decision`

## Negative Guardrails

The contract exports `collectForbiddenUiContractFields()` and `forbiddenUiContractFieldNames` to prevent canonical fixtures/contracts from introducing:

- confidence fields
- sourcemap-required fields
- source-line attribution fields

Sourcemaps can be mentioned only as unsupported or future context, not as a v1 requirement.

## Acceptance Evidence

- Terminology is documented and exported.
- `ComparableSeriesKey` and `OutputRowId` are defined and tested.
- Entrypoint kind identity stance is explicit.
- Lens registry contract includes the current default lens.
- State enums are explicit and tested.
- Mini-viz contract is explicit and tested.
- Canonical fixtures exist and serialize through their schema.
- Negative guardrail checks exist for confidence/sourcemap/source-line fields.

## Verification Results

- `pnpm contracts:test` passed.
- `pnpm contracts:typecheck` passed.
