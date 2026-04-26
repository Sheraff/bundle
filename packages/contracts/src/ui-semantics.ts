import * as v from "valibot"

import {
  DEFAULT_LENS_SLUG,
  nonEmptyStringSchema,
  nonNegativeIntegerSchema,
  positiveIntegerSchema,
} from "./shared.js"

const integerSchema = v.pipe(v.number(), v.integer())

export const uiTerminology = {
  scenario: {
    label: "Scenario",
    definition: "One reproducible bundle target your team tracks over time.",
  },
  output: {
    label: "Output",
    definition: "A build target measured inside a scenario, displayed as environment / entrypoint.",
  },
  whatsCounted: {
    label: "What's counted",
    definition: "The byte-counting lens used for an output.",
  },
  size: {
    label: "Size",
    definition: "The raw, gzip, or brotli byte metric displayed for a measurement.",
  },
  evidence: {
    label: "Evidence",
    definition: "The bundle details that explain where the bytes came from.",
  },
} as const

export type ScenarioId = string
export type EnvironmentKey = string
export type EnvironmentLabel = string
export type EntrypointKey = string
export type LensId = string
export type OutputRowId = string

export const entrypointKinds = ["entry", "dynamic-entry"] as const
export type EntrypointKind = (typeof entrypointKinds)[number]

export const sizeMetrics = ["raw", "gzip", "brotli"] as const
export type SizeMetric = (typeof sizeMetrics)[number]

export const scenarioIdSchema = nonEmptyStringSchema
export const environmentKeySchema = nonEmptyStringSchema
export const environmentLabelSchema = nonEmptyStringSchema
export const entrypointKeySchema = nonEmptyStringSchema
export const entrypointKindSchema = v.union(entrypointKinds.map((kind) => v.literal(kind)))
export const lensIdSchema = nonEmptyStringSchema
export const sizeMetricSchema = v.union(sizeMetrics.map((metric) => v.literal(metric)))
export const outputRowIdSchema = nonEmptyStringSchema

export const COMPARABLE_SERIES_KEY_INCLUDES_ENTRYPOINT_KIND = true as const

export const comparableSeriesKeySchema = v.strictObject({
  scenarioId: scenarioIdSchema,
  environmentKey: environmentKeySchema,
  entrypointKind: entrypointKindSchema,
  entrypointKey: entrypointKeySchema,
  lensId: lensIdSchema,
})

export type ComparableSeriesKey = v.InferOutput<typeof comparableSeriesKeySchema>

export function comparableSeriesKeyToString(key: ComparableSeriesKey) {
  return `series:${[
    key.scenarioId,
    key.environmentKey,
    key.entrypointKind,
    key.entrypointKey,
    key.lensId,
  ].map(encodeKeyPart).join(":")}`
}

export function outputRowIdFromComparableSeriesKey(key: ComparableSeriesKey): OutputRowId {
  return `output:${comparableSeriesKeyToString(key).slice("series:".length)}`
}

export const lensTraversalModes = [
  "direct",
  "initial",
  "async",
  "all-reachable",
  "all-output",
] as const
export const sharedChunkModes = ["full", "proportional", "unique-only", "separate"] as const

export type LensTraversalMode = (typeof lensTraversalModes)[number]
export type SharedChunkMode = (typeof sharedChunkModes)[number]

export const lensDefinitionSchema = v.strictObject({
  id: lensIdSchema,
  label: nonEmptyStringSchema,
  explanation: nonEmptyStringSchema,
  appliesToOutputKinds: v.pipe(v.array(entrypointKindSchema), v.nonEmpty()),
  includedAssetRules: v.array(nonEmptyStringSchema),
  excludedAssetRules: v.array(nonEmptyStringSchema),
  traversal: v.union(lensTraversalModes.map((mode) => v.literal(mode))),
  sharedChunkMode: v.union(sharedChunkModes.map((mode) => v.literal(mode))),
  includesHtmlBytes: v.boolean(),
  includesRuntime: v.boolean(),
  version: positiveIntegerSchema,
})

export type LensDefinition = v.InferOutput<typeof lensDefinitionSchema>

export const defaultLensDefinition = {
  id: DEFAULT_LENS_SLUG,
  label: "Entry JS + direct CSS",
  explanation: "Counts the selected entry JavaScript chunk and CSS directly imported by that entrypoint.",
  appliesToOutputKinds: ["entry", "dynamic-entry"],
  includedAssetRules: ["selected entry JavaScript chunk", "CSS directly imported by the selected entrypoint"],
  excludedAssetRules: ["asynchronous chunks", "assets not directly imported by the selected entrypoint"],
  traversal: "direct",
  sharedChunkMode: "full",
  includesHtmlBytes: false,
  includesRuntime: true,
  version: 1,
} as const satisfies LensDefinition

export const lensRegistry = [defaultLensDefinition] as const satisfies readonly LensDefinition[]

export const measurementStates = [
  "complete",
  "pending",
  "failed",
  "incomplete",
  "stale",
  "missing_baseline",
  "incompatible",
  "unsupported",
] as const
export const policyStates = [
  "not_configured",
  "not_evaluated",
  "pass",
  "warn",
  "fail_non_blocking",
  "fail_blocking",
  "accepted",
  "disabled",
  "not_applicable",
] as const
export const evidenceAvailabilityStates = ["available", "missing", "partial", "not_applicable", "error"] as const
export const comparisonStates = [
  "same",
  "added",
  "removed",
  "unavailable",
  "unsupported_lens",
  "missing_size",
  "invalid",
] as const
export const compatibilityStates = ["exact", "partial", "exploratory", "invalid"] as const

export const measurementStateSchema = v.union(measurementStates.map((state) => v.literal(state)))
export const policyStateSchema = v.union(policyStates.map((state) => v.literal(state)))
export const evidenceAvailabilityStateSchema = v.union(
  evidenceAvailabilityStates.map((state) => v.literal(state)),
)
export const comparisonStateSchema = v.union(comparisonStates.map((state) => v.literal(state)))
export const compatibilityStateSchema = v.union(compatibilityStates.map((state) => v.literal(state)))

export type MeasurementState = (typeof measurementStates)[number]
export type PolicyState = (typeof policyStates)[number]
export type EvidenceAvailabilityState = (typeof evidenceAvailabilityStates)[number]
export type ComparisonState = (typeof comparisonStates)[number]
export type CompatibilityState = (typeof compatibilityStates)[number]

export const miniVizSchema = v.pipe(
  v.variant("kind", [
    v.strictObject({
      kind: v.literal("delta-bar"),
      current: nonNegativeIntegerSchema,
      baseline: nonNegativeIntegerSchema,
      delta: integerSchema,
      threshold: v.optional(nonNegativeIntegerSchema),
      policySource: v.optional(nonEmptyStringSchema),
      unit: nonEmptyStringSchema,
    }),
    v.strictObject({
      kind: v.literal("sparkline"),
      points: v.pipe(
        v.array(v.strictObject({ x: nonEmptyStringSchema, value: nonNegativeIntegerSchema })),
        v.nonEmpty(),
      ),
      unit: nonEmptyStringSchema,
    }),
    v.strictObject({
      kind: v.literal("state-strip"),
      states: v.pipe(v.array(nonEmptyStringSchema), v.nonEmpty()),
    }),
    v.strictObject({
      kind: v.literal("status-chip"),
      state: nonEmptyStringSchema,
      reason: nonEmptyStringSchema,
    }),
    v.strictObject({
      kind: v.literal("none"),
      reason: nonEmptyStringSchema,
    }),
  ]),
  v.check(
    (miniViz) => miniViz.kind !== "delta-bar" || miniViz.threshold === undefined || Boolean(miniViz.policySource),
    "A delta-bar threshold requires a named policy source.",
  ),
)

export type MiniViz = v.InferOutput<typeof miniVizSchema>

export function buildDeltaMiniViz(input: {
  baseline: number | null | undefined
  current: number | null | undefined
  policySource?: string
  threshold?: number
  unit?: string
}): MiniViz {
  if (input.current === null || input.current === undefined) {
    return { kind: "none", reason: "Current size is unavailable." }
  }

  if (input.baseline === null || input.baseline === undefined) {
    return { kind: "none", reason: "Baseline size is unavailable." }
  }

  const base = {
    kind: "delta-bar" as const,
    baseline: input.baseline,
    current: input.current,
    delta: input.current - input.baseline,
    unit: input.unit ?? "bytes",
  }

  if (input.threshold === undefined || !input.policySource) return base

  return {
    ...base,
    policySource: input.policySource,
    threshold: input.threshold,
  }
}

export const semanticOutputFixtureSchema = v.strictObject({
  scenarioId: scenarioIdSchema,
  scenarioLabel: nonEmptyStringSchema,
  environmentKey: environmentKeySchema,
  environmentLabel: environmentLabelSchema,
  entrypointKind: entrypointKindSchema,
  entrypointKey: entrypointKeySchema,
  lensId: lensIdSchema,
  sizeMetric: sizeMetricSchema,
  currentBytes: v.optional(v.nullable(nonNegativeIntegerSchema)),
  baselineBytes: v.optional(v.nullable(nonNegativeIntegerSchema)),
  measurementState: measurementStateSchema,
  comparisonState: comparisonStateSchema,
  policyState: policyStateSchema,
  evidenceAvailability: evidenceAvailabilityStateSchema,
  compatibility: compatibilityStateSchema,
  miniViz: miniVizSchema,
})

export const semanticUiFixtureSchema = v.strictObject({
  id: nonEmptyStringSchema,
  title: nonEmptyStringSchema,
  description: nonEmptyStringSchema,
  rows: v.pipe(v.array(semanticOutputFixtureSchema), v.nonEmpty()),
})

export type SemanticOutputFixture = v.InferOutput<typeof semanticOutputFixtureSchema>
export type SemanticUiFixture = v.InferOutput<typeof semanticUiFixtureSchema>

export const canonicalUiFixtures = [
  fixture("single-output-complete", "One complete output", "One scenario with one environment, entrypoint, and lens.", [
    row({ currentBytes: 63, baselineBytes: 63 }),
  ]),
  fixture("multiple-environments", "Multiple environments", "One scenario with separate client and SSR outputs.", [
    row({ environmentKey: "client", environmentLabel: "client", entrypointKey: "src/main.ts" }),
    row({ environmentKey: "ssr", environmentLabel: "ssr", entrypointKey: "src/entry-server.ts" }),
  ]),
  fixture("multiple-entrypoints", "Multiple entrypoints", "One scenario with multiple outputs in one environment.", [
    row({ entrypointKey: "src/main.ts" }),
    row({ entrypointKey: "src/admin.ts", currentBytes: 42, baselineBytes: 40 }),
  ]),
  fixture("multiple-lenses", "Multiple lenses", "One output measured with more than one counting lens.", [
    row({ lensId: DEFAULT_LENS_SLUG }),
    row({ lensId: "all-js", currentBytes: 120, baselineBytes: 110 }),
  ]),
  fixture("missing-baseline", "Missing baseline", "A new comparable output without a baseline measurement.", [
    row({ baselineBytes: null, comparisonState: "unavailable", measurementState: "missing_baseline" }),
  ]),
  fixture("failed-upload", "Failed upload", "A scenario whose latest upload failed before processing.", [
    row({ comparisonState: "unavailable", evidenceAvailability: "error", measurementState: "failed", miniViz: statusMiniViz("failed", "Upload failed before measurement.") }),
  ]),
  fixture("failed-build", "Failed build", "A scenario whose build failed before a bundle artifact was produced.", [
    row({ comparisonState: "unavailable", evidenceAvailability: "error", measurementState: "failed", miniViz: statusMiniViz("failed", "Build failed before bundle output.") }),
  ]),
  fixture("incomplete-run", "Incomplete run", "A processed run with incomplete measurement data.", [
    row({ comparisonState: "unavailable", evidenceAvailability: "partial", measurementState: "incomplete", miniViz: statusMiniViz("incomplete", "Measurement data is incomplete.") }),
  ]),
  fixture("unsupported-lens", "Unsupported lens", "A selected lens that cannot apply to the output.", [
    row({ comparisonState: "unsupported_lens", evidenceAvailability: "not_applicable", measurementState: "unsupported", miniViz: statusMiniViz("unsupported", "This lens does not apply to the selected output.") }),
  ]),
  fixture("added-output", "Added output", "An output present in head but not baseline.", [
    row({ baselineBytes: null, comparisonState: "added", miniViz: statusMiniViz("added", "Output was added in the current revision.") }),
  ]),
  fixture("removed-output", "Removed output", "An output present in baseline but not head.", [
    row({ comparisonState: "removed", currentBytes: null, evidenceAvailability: "not_applicable", measurementState: "stale", miniViz: statusMiniViz("removed", "Output was removed in the current revision.") }),
  ]),
  fixture("unavailable-evidence", "Unavailable evidence", "A measured output whose detail evidence cannot be loaded.", [
    row({ evidenceAvailability: "missing", miniViz: statusMiniViz("missing", "Evidence is unavailable for this output.") }),
  ]),
  fixture("missing-size", "Missing size", "A measurement exists but the selected size value is unavailable.", [
    row({ comparisonState: "missing_size", currentBytes: null, evidenceAvailability: "partial", miniViz: statusMiniViz("missing_size", "Selected size metric is unavailable.") }),
  ]),
  fixture("no-policy", "No policy", "A measured output without a configured policy.", [
    row({ policyState: "not_configured" }),
  ]),
  fixture("not-evaluated-policy", "Not evaluated policy", "A configured policy that has not been evaluated for this row.", [
    row({ policyState: "not_evaluated", miniViz: statusMiniViz("not_evaluated", "Policy has not been evaluated yet.") }),
  ]),
  fixture("warning-policy", "Warning policy", "A policy warning that does not block the review.", [
    row({ currentBytes: 82, baselineBytes: 63, policyState: "warn", miniViz: buildDeltaMiniViz({ baseline: 63, current: 82, policySource: "gzip budget", threshold: 80 }) }),
  ]),
  fixture("blocking-policy", "Blocking policy", "A policy failure that blocks the review.", [
    row({ currentBytes: 96, baselineBytes: 63, policyState: "fail_blocking", miniViz: buildDeltaMiniViz({ baseline: 63, current: 96, policySource: "gzip budget", threshold: 80 }) }),
  ]),
  fixture("accepted-policy-decision", "Accepted policy decision", "A blocking or warning policy item accepted by a reviewer.", [
    row({ currentBytes: 96, baselineBytes: 63, policyState: "accepted", miniViz: statusMiniViz("accepted", "Policy failure was accepted.") }),
  ]),
] as const satisfies readonly SemanticUiFixture[]

export const forbiddenUiContractFieldNames = [
  "confidence",
  "confidenceScore",
  "requiresSourceMap",
  "sourceMap",
  "sourcemap",
  "sourceLine",
  "sourceColumn",
  "originalSourceLine",
  "lineNumber",
] as const

export function collectForbiddenUiContractFields(value: unknown, path = "$", matches: string[] = []) {
  if (!value || typeof value !== "object") return matches

  if (Array.isArray(value)) {
    value.forEach((item, index) => collectForbiddenUiContractFields(item, `${path}[${index}]`, matches))
    return matches
  }

  for (const [key, child] of Object.entries(value)) {
    const nextPath = `${path}.${key}`
    if (forbiddenUiContractFieldNames.includes(key as (typeof forbiddenUiContractFieldNames)[number])) {
      matches.push(nextPath)
    }
    collectForbiddenUiContractFields(child, nextPath, matches)
  }

  return matches
}

function fixture(id: string, title: string, description: string, rows: SemanticOutputFixture[]): SemanticUiFixture {
  return { id, title, description, rows }
}

function row(overrides: Partial<SemanticOutputFixture> = {}): SemanticOutputFixture {
  const currentBytes = overrides.currentBytes === undefined ? 83 : overrides.currentBytes
  const baselineBytes = overrides.baselineBytes === undefined ? 63 : overrides.baselineBytes

  return {
    scenarioId: "marketing-app",
    scenarioLabel: "Marketing app",
    environmentKey: "client",
    environmentLabel: "client",
    entrypointKind: "entry",
    entrypointKey: "src/main.ts",
    lensId: DEFAULT_LENS_SLUG,
    sizeMetric: "gzip",
    currentBytes,
    baselineBytes,
    measurementState: "complete",
    comparisonState: "same",
    policyState: "not_configured",
    evidenceAvailability: "available",
    compatibility: "exact",
    miniViz: buildDeltaMiniViz({ baseline: baselineBytes, current: currentBytes }),
    ...overrides,
  }
}

function statusMiniViz(state: string, reason: string): MiniViz {
  return { kind: "status-chip", state, reason }
}

function encodeKeyPart(value: string) {
  return encodeURIComponent(value)
}
