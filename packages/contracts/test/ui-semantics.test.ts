import { describe, expect, it } from "vitest"
import * as v from "valibot"

import {
  COMPARABLE_SERIES_KEY_INCLUDES_ENTRYPOINT_KIND,
  buildDeltaMiniViz,
  canonicalUiFixtures,
  collectForbiddenUiContractFields,
  comparableSeriesKeySchema,
  comparableSeriesKeyToString,
  compatibilityStateSchema,
  compatibilityStates,
  comparisonStateSchema,
  comparisonStates,
  defaultLensDefinition,
  entrypointKinds,
  evidenceAvailabilityStateSchema,
  evidenceAvailabilityStates,
  lensDefinitionSchema,
  lensRegistry,
  measurementStateSchema,
  measurementStates,
  miniVizSchema,
  outputRowIdFromComparableSeriesKey,
  policyStateSchema,
  policyStates,
  semanticUiFixtureSchema,
  sizeMetrics,
  uiTerminology,
  type ComparableSeriesKey,
} from "../src/index.js"

describe("UI semantic terminology", () => {
  it("defines the user-facing product model labels", () => {
    expect(uiTerminology.scenario.label).toBe("Scenario")
    expect(uiTerminology.output.label).toBe("Output")
    expect(uiTerminology.whatsCounted.label).toBe("What's counted")
    expect(uiTerminology.size.label).toBe("Size")
    expect(uiTerminology.evidence.label).toBe("Evidence")
  })
})

describe("ComparableSeriesKey", () => {
  const key = {
    scenarioId: "marketing-app",
    environmentKey: "client",
    entrypointKind: "entry",
    entrypointKey: "src/main.ts",
    lensId: "entry-js-direct-css",
  } satisfies ComparableSeriesKey

  it("includes entrypoint kind in stable comparable identity", () => {
    expect(COMPARABLE_SERIES_KEY_INCLUDES_ENTRYPOINT_KIND).toBe(true)
    expect(v.safeParse(comparableSeriesKeySchema, key).success).toBe(true)
    expect(comparableSeriesKeyToString(key)).toBe(
      "series:marketing-app:client:entry:src%2Fmain.ts:entry-js-direct-css",
    )
  })

  it("keeps output row ids stable and kind-sensitive", () => {
    const dynamicKey = { ...key, entrypointKind: "dynamic-entry" } satisfies ComparableSeriesKey

    expect(outputRowIdFromComparableSeriesKey(key)).toBe(
      "output:marketing-app:client:entry:src%2Fmain.ts:entry-js-direct-css",
    )
    expect(outputRowIdFromComparableSeriesKey(dynamicKey)).not.toBe(outputRowIdFromComparableSeriesKey(key))
  })
})

describe("lens registry", () => {
  it("validates the default Entry JS + direct CSS lens", () => {
    expect(defaultLensDefinition.id).toBe("entry-js-direct-css")
    expect(defaultLensDefinition.label).toBe("Entry JS + direct CSS")
    expect(v.safeParse(lensDefinitionSchema, defaultLensDefinition).success).toBe(true)
  })

  it("contains unique validated lenses", () => {
    const ids = new Set<string>()

    for (const lens of lensRegistry) {
      expect(v.safeParse(lensDefinitionSchema, lens).success).toBe(true)
      expect(ids.has(lens.id)).toBe(false)
      ids.add(lens.id)
    }
  })
})

describe("state enums", () => {
  it("defines exact measurement, policy, evidence, comparison, and compatibility states", () => {
    expect(measurementStates).toEqual([
      "complete",
      "pending",
      "failed",
      "incomplete",
      "stale",
      "missing_baseline",
      "incompatible",
      "unsupported",
    ])
    expect(policyStates).toEqual([
      "not_configured",
      "not_evaluated",
      "pass",
      "warn",
      "fail_non_blocking",
      "fail_blocking",
      "accepted",
      "disabled",
      "not_applicable",
    ])
    expect(evidenceAvailabilityStates).toEqual(["available", "missing", "partial", "not_applicable", "error"])
    expect(comparisonStates).toEqual([
      "same",
      "added",
      "removed",
      "unavailable",
      "unsupported_lens",
      "missing_size",
      "invalid",
    ])
    expect(compatibilityStates).toEqual(["exact", "partial", "exploratory", "invalid"])
  })

  it("parses every exported state enum value", () => {
    for (const state of measurementStates) expect(v.safeParse(measurementStateSchema, state).success).toBe(true)
    for (const state of policyStates) expect(v.safeParse(policyStateSchema, state).success).toBe(true)
    for (const state of evidenceAvailabilityStates) expect(v.safeParse(evidenceAvailabilityStateSchema, state).success).toBe(true)
    for (const state of comparisonStates) expect(v.safeParse(comparisonStateSchema, state).success).toBe(true)
    for (const state of compatibilityStates) expect(v.safeParse(compatibilityStateSchema, state).success).toBe(true)
    expect(entrypointKinds).toEqual(["entry", "dynamic-entry"])
    expect(sizeMetrics).toEqual(["raw", "gzip", "brotli"])
  })
})

describe("mini-viz contract", () => {
  it("falls back instead of zero-filling missing current or baseline values", () => {
    expect(buildDeltaMiniViz({ baseline: 10, current: null })).toEqual({
      kind: "none",
      reason: "Current size is unavailable.",
    })
    expect(buildDeltaMiniViz({ baseline: undefined, current: 10 })).toEqual({
      kind: "none",
      reason: "Baseline size is unavailable.",
    })
  })

  it("requires a named policy source for threshold markers", () => {
    expect(v.safeParse(miniVizSchema, buildDeltaMiniViz({ baseline: 10, current: 15, threshold: 20 })).success).toBe(true)
    expect(
      v.safeParse(miniVizSchema, {
        kind: "delta-bar",
        baseline: 10,
        current: 15,
        delta: 5,
        threshold: 20,
        unit: "bytes",
      }).success,
    ).toBe(false)
    expect(
      v.safeParse(miniVizSchema, buildDeltaMiniViz({ baseline: 10, current: 15, policySource: "gzip budget", threshold: 20 })).success,
    ).toBe(true)
  })
})

describe("canonical UI fixtures", () => {
  it("serializes and validates every canonical fixture", () => {
    expect(canonicalUiFixtures.map((fixture) => fixture.id)).toEqual([
      "single-output-complete",
      "multiple-environments",
      "multiple-entrypoints",
      "multiple-lenses",
      "missing-baseline",
      "failed-upload",
      "failed-build",
      "incomplete-run",
      "unsupported-lens",
      "added-output",
      "removed-output",
      "unavailable-evidence",
      "missing-size",
      "no-policy",
      "not-evaluated-policy",
      "warning-policy",
      "blocking-policy",
      "accepted-policy-decision",
    ])

    for (const fixture of canonicalUiFixtures) {
      const serialized = JSON.parse(JSON.stringify(fixture))
      expect(v.safeParse(semanticUiFixtureSchema, serialized).success).toBe(true)
    }
  })

  it("does not introduce confidence, sourcemap, or source-line fields", () => {
    expect(collectForbiddenUiContractFields(canonicalUiFixtures)).toEqual([])
    expect(collectForbiddenUiContractFields(lensRegistry)).toEqual([])
    expect(collectForbiddenUiContractFields(uiTerminology)).toEqual([])
    expect(collectForbiddenUiContractFields({ row: { confidence: 0.7 } })).toEqual(["$.row.confidence"])
  })
})
