import { canonicalUiFixtures } from "@workspace/contracts"
import { env } from "cloudflare:workers"
import { describe, expect, it } from "vitest"

import {
  getPullRequestComparePageData,
  getScenarioPageData,
  loadOutputRowMiniVizData,
  miniVizFromRecentPoints,
  outputRowsFromCanonicalFixtures,
  reviewOutputRowsFromSummary,
  scenarioLatestOutputRowsFromFreshScenario,
  unionPairOutputRowsFromPoints,
  type UnionPairComparisonMeta,
  type UnionPairSeriesPoint,
} from "../src/lib/public-read-models.server.js"
import { buildCiContext, buildEnvelope, buildSimpleArtifact, size } from "./support/builders.js"
import { createPipelineHarness } from "./support/pipeline-harness.js"

const baseSha = "0123456789abcdef0123456789abcdef01234567"
const headSha = "1111111111111111111111111111111111111111"
const prHeadSha = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"

describe("output row read models", () => {
  it("maps scenario latest rows without collapsing scenario/output/lens context", async () => {
    const harness = createPipelineHarness()
    await seedBranchComparison(harness)

    const data = await getScenarioPageData(env, {
      owner: "acme",
      repo: "widget",
      scenario: "fixture-app-cost",
      branch: "main",
      lens: "entry-js-direct-css",
      metric: "gzip",
    })
    expect(data.latestFreshScenario).toBeTruthy()

    const rows = scenarioLatestOutputRowsFromFreshScenario(data.latestFreshScenario!, "gzip")
    expect(rows).toHaveLength(1)
    expect(rows[0]).toEqual(
      expect.objectContaining({
        comparisonState: "same",
        entrypointKind: "entry",
        kind: "scenario-latest",
        measurementState: "complete",
        policyState: "not_configured",
        selectedSize: "gzip",
      }),
    )
    expect(rows[0]?.seriesKey).toEqual({
      scenarioId: data.latestFreshScenario?.scenarioId,
      environmentKey: "default",
      entrypointKind: "entry",
      entrypointKey: "src/main.ts",
      lensId: "entry-js-direct-css",
    })
    expect(rows[0]?.currentTotals).toEqual({ raw: 160, gzip: 53, brotli: 44 })
    expect(rows[0]?.baselineTotals).toEqual({ raw: 133, gzip: 53, brotli: 44 })
    expect(rows[0]?.deltaTotals).toEqual({ raw: 27, gzip: 0, brotli: 0 })
    expect(rows[0]?.miniViz).toEqual({ kind: "delta-bar", current: 53, baseline: 53, delta: 0, unit: "bytes" })
    expect(rows[0]?.evidenceAvailability).toEqual(
      expect.objectContaining({
        selectedDetailAvailable: true,
        snapshotDetailAvailable: true,
        state: "available",
      }),
    )
  })

  it("does not zero-fill missing baselines", async () => {
    const harness = createPipelineHarness()
    await harness.acceptUpload(
      buildEnvelope({
        artifact: buildSimpleArtifact({ scenarioId: "new-scenario" }),
        git: { branch: "main", commitSha: baseSha },
        ci: buildCiContext("9100"),
      }),
    )
    await harness.processUploadPipeline()

    const data = await getScenarioPageData(env, {
      owner: "acme",
      repo: "widget",
      scenario: "new-scenario",
      branch: "main",
      lens: "entry-js-direct-css",
      metric: "gzip",
    })
    const rows = scenarioLatestOutputRowsFromFreshScenario(data.latestFreshScenario!, "gzip")

    expect(rows[0]?.measurementState).toBe("missing_baseline")
    expect(rows[0]?.comparisonState).toBe("unavailable")
    expect(rows[0]?.baselineTotals).toBeNull()
    expect(rows[0]?.deltaTotals).toBeNull()
    expect(rows[0]?.currentTotals?.gzip).toBe(53)
    expect(rows[0]?.miniViz).toEqual({ kind: "none", reason: "Baseline size is unavailable." })
  })

  it("maps PR review rows with review state and non-enforcing policy placeholders", async () => {
    const harness = createPipelineHarness()
    await seedPrComparison(harness)

    const data = await getPullRequestComparePageData(env, {
      owner: "acme",
      repo: "widget",
      search: { pr: 42, base: baseSha, head: prHeadSha },
    })
    expect(data.latestReviewSummary).toBeTruthy()

    const rows = reviewOutputRowsFromSummary(data.latestReviewSummary!, "raw")

    expect(rows).toHaveLength(1)
    expect(rows[0]).toEqual(
      expect.objectContaining({
        comparisonState: "same",
        kind: "review",
        measurementState: "complete",
        policyState: "not_configured",
        reviewState: "regression",
        selectedSize: "raw",
      }),
    )
    expect(rows[0]?.miniViz).toEqual({ kind: "delta-bar", current: 160, baseline: 133, delta: 27, unit: "bytes" })
    expect(rows[0]?.evidenceAvailability.comparisonDetailAvailable).toBe(true)
  })

  it("loads batched recent-point mini-viz data with explicit fallbacks", async () => {
    const harness = createPipelineHarness()
    await seedBranchComparison(harness)

    const data = await getScenarioPageData(env, {
      owner: "acme",
      repo: "widget",
      scenario: "fixture-app-cost",
      branch: "main",
      lens: "entry-js-direct-css",
      metric: "raw",
    })
    const row = scenarioLatestOutputRowsFromFreshScenario(data.latestFreshScenario!, "raw")[0]
    expect(row?.seriesId).toBeTruthy()

    const miniVizData = await loadOutputRowMiniVizData(env, {
      pointLimit: 5,
      repositoryId: data.repository.id,
      selectedSize: "raw",
      seriesIds: [row?.seriesId ?? "", "missing-series"],
    })

    expect(miniVizData.get(row?.seriesId ?? "")).toEqual(
      expect.objectContaining({
        latestValue: 160,
        previousValue: 133,
        status: "available",
      }),
    )
    expect(miniVizData.get(row?.seriesId ?? "")?.miniViz.kind).toBe("sparkline")
    expect(miniVizData.get("missing-series")).toEqual({
      miniViz: { kind: "none", reason: "No recent points are available." },
      reason: "No recent points are available.",
      status: "unavailable",
    })
    expect(miniVizFromRecentPoints([])).toEqual({ kind: "none", reason: "No recent points are available." })
    expect(miniVizFromRecentPoints([{ commitSha: headSha, measuredAt: "2026-04-07T12:00:00.000Z", value: 160 }])).toEqual({
      kind: "status-chip",
      reason: "Only one point is available.",
      state: "single_point",
    })
  })

  it("reuses Plan 01 canonical fixtures for row mapper coverage", () => {
    const rows = outputRowsFromCanonicalFixtures(canonicalUiFixtures)

    expect(rows.length).toBeGreaterThan(canonicalUiFixtures.length)
    expect(rows.some((row) => row.measurementState === "failed")).toBe(true)
    expect(rows.some((row) => row.comparisonState === "removed")).toBe(true)
    expect(rows.some((row) => row.comparisonState === "missing_size")).toBe(true)
    expect(rows.some((row) => row.policyState === "fail_blocking")).toBe(true)
    expect(rows.every((row) => row.rowId.startsWith("output:"))).toBe(true)
  })

  it("builds union-paired compare rows without treating gaps as zeros", () => {
    const comparisonBySeriesId = new Map<string, UnionPairComparisonMeta>([
      ["series-same", comparisonMeta("series-same")],
      ["series-changed", comparisonMeta("series-changed")],
    ])
    const rows = unionPairOutputRowsFromPoints({
      basePoints: [
        unionPoint({ seriesId: "series-same", totals: sizeTotals(100, 40, 32) }),
        unionPoint({ entrypoint: "src/changed.ts", seriesId: "series-changed", totals: sizeTotals(100, 40, 32) }),
        unionPoint({ entrypoint: "src/removed.ts", seriesId: "series-removed", totals: sizeTotals(50, 20, 18) }),
        unionPoint({ entrypoint: "src/missing-size.ts", seriesId: "series-missing-size", totals: { brotli: 12, gzip: null, raw: 40 } }),
        unionPoint({ entrypoint: "src/unsupported.ts", lens: "unknown-lens", seriesId: "series-unsupported", totals: sizeTotals(40, 18, 12) }),
      ],
      comparisonBySeriesId,
      headPoints: [
        unionPoint({ seriesId: "series-same", commitGroupId: "head-group", commitSha: headSha, scenarioRunId: "head-run", totals: sizeTotals(100, 40, 32) }),
        unionPoint({ entrypoint: "src/changed.ts", seriesId: "series-changed", commitGroupId: "head-group", commitSha: headSha, scenarioRunId: "head-run", totals: sizeTotals(130, 45, 36) }),
        unionPoint({ entrypoint: "src/added.ts", seriesId: "series-added", commitGroupId: "head-group", commitSha: headSha, scenarioRunId: "head-run", totals: sizeTotals(75, 25, 21) }),
        unionPoint({ entrypoint: "src/unavailable.ts", seriesId: "series-unavailable", commitGroupId: "head-group", commitSha: headSha, scenarioRunId: "head-run", totals: null }),
      ],
      selectedSize: "gzip",
    })

    const byEntrypoint = new Map(rows.map((row) => [row.entrypoint.key, row]))

    expect(byEntrypoint.get("src/main.ts")).toEqual(expect.objectContaining({ compatibility: "exact", pairState: "same" }))
    expect(byEntrypoint.get("src/main.ts")?.deltaTotals?.gzip).toBe(0)
    expect(byEntrypoint.get("src/changed.ts")).toEqual(expect.objectContaining({ compatibility: "exact", pairState: "same" }))
    expect(byEntrypoint.get("src/changed.ts")?.deltaTotals?.gzip).toBe(5)
    expect(byEntrypoint.get("src/added.ts")).toEqual(expect.objectContaining({ baselineTotals: null, compatibility: "partial", deltaTotals: null, pairState: "added" }))
    expect(byEntrypoint.get("src/removed.ts")).toEqual(expect.objectContaining({ compatibility: "partial", currentTotals: null, deltaTotals: null, pairState: "removed" }))
    expect(byEntrypoint.get("src/unavailable.ts")).toEqual(expect.objectContaining({ compatibility: "partial", currentTotals: null, pairState: "unavailable" }))
    expect(byEntrypoint.get("src/missing-size.ts")).toEqual(expect.objectContaining({ compatibility: "invalid", pairState: "missing_size" }))
    expect(byEntrypoint.get("src/unsupported.ts")).toEqual(expect.objectContaining({ compatibility: "invalid", pairState: "unsupported_lens" }))
  })

  it("marks unmaterialized same-key pairs as exploratory", () => {
    const rows = unionPairOutputRowsFromPoints({
      basePoints: [unionPoint({ seriesId: "series-exploratory", totals: sizeTotals(100, 40, 32) })],
      headPoints: [unionPoint({ seriesId: "series-exploratory", commitGroupId: "head-group", commitSha: headSha, scenarioRunId: "head-run", totals: sizeTotals(110, 42, 34) })],
      selectedSize: "gzip",
    })

    expect(rows[0]).toEqual(expect.objectContaining({ compatibility: "exploratory", pairState: "same", policyState: "not_evaluated" }))
  })
})

async function seedBranchComparison(harness: ReturnType<typeof createPipelineHarness>) {
  await harness.acceptUpload(
    buildEnvelope({
      artifact: buildSimpleArtifact({
        scenarioId: "fixture-app-cost",
        chunkSizes: size(123, 45, 38),
        cssSizes: size(10, 8, 6),
      }),
      git: { branch: "main", commitSha: baseSha },
      ci: buildCiContext("9000"),
    }),
  )
  await harness.processUploadPipeline()

  await harness.acceptUpload(
    buildEnvelope({
      artifact: buildSimpleArtifact({
        scenarioId: "fixture-app-cost",
        chunkSizes: size(150, 45, 38),
        cssSizes: size(10, 8, 6),
      }),
      git: { branch: "main", commitSha: headSha },
      ci: buildCiContext("9001"),
    }),
  )
  await harness.processUploadPipeline()
}

async function seedPrComparison(harness: ReturnType<typeof createPipelineHarness>) {
  await harness.acceptUpload(
    buildEnvelope({
      artifact: buildSimpleArtifact({
        scenarioId: "scenario-pr",
        chunkSizes: size(123, 45, 38),
        cssSizes: size(10, 8, 6),
      }),
      git: { branch: "main", commitSha: baseSha },
      ci: buildCiContext("9200"),
    }),
  )
  await harness.processUploadPipeline()

  await harness.acceptUpload(
    buildEnvelope({
      artifact: buildSimpleArtifact({
        scenarioId: "scenario-pr",
        chunkSizes: size(150, 45, 38),
        cssSizes: size(10, 8, 6),
      }),
      git: { branch: "feature/login", commitSha: prHeadSha },
      pullRequest: {
        baseRef: "main",
        baseSha,
        headRef: "feature/login",
        headSha: prHeadSha,
        number: 42,
      },
      ci: buildCiContext("9201"),
    }),
  )
  await harness.processUploadPipeline()
}

function unionPoint(overrides: Partial<UnionPairSeriesPoint> = {}): UnionPairSeriesPoint {
  return {
    branch: "main",
    commitGroupId: "base-group",
    commitSha: baseSha,
    entrypoint: "src/main.ts",
    entrypointKind: "entry",
    environment: "default",
    lens: "entry-js-direct-css",
    measuredAt: "2026-04-07T12:00:00.000Z",
    scenarioId: "scenario-union",
    scenarioRunId: "base-run",
    scenarioSlug: "scenario-union",
    scenarioSourceKind: "fixture-app",
    seriesId: "series-union",
    totals: sizeTotals(100, 40, 32),
    ...overrides,
  }
}

function comparisonMeta(seriesId: string): UnionPairComparisonMeta {
  return {
    budgetState: "not-configured",
    comparisonId: `comparison:${seriesId}`,
    failureMessage: null,
    hasDegradedStableIdentity: false,
    selectedEntrypointRelation: "same",
    seriesId,
    status: "materialized",
  }
}

function sizeTotals(raw: number, gzip: number | null, brotli: number) {
  return { brotli, gzip, raw }
}
