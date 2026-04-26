import {
  buildDeltaMiniViz,
  canonicalUiFixtures,
  defaultLensDefinition,
  entrypointKinds,
  lensRegistry,
  outputRowIdFromComparableSeriesKey,
  type ComparableSeriesKey,
  type CompatibilityState,
  type ComparisonState,
  type EntrypointKind,
  type EvidenceAvailabilityState,
  type MeasurementState,
  type MiniViz,
  type PolicyState,
  type PrReviewSummaryV1,
  type ReviewSeriesState,
  type ReviewedComparisonItemSummaryV1,
  type ReviewedComparisonSeriesSummaryV1,
  type SemanticUiFixture,
  type SizeMetric,
} from "@workspace/contracts"
import { and, asc, desc, eq, inArray } from "drizzle-orm"

import { getDb, schema } from "../../db/index.js"
import type { AppBindings } from "../../env.js"
import { mapBudgetStateToPolicyState } from "../policy-state.js"

import {
  buildReviewedCompareRows,
  type NeutralScenarioCompareRow,
  type ReviewedScenarioCompareRow,
  type ScenarioHistorySeries,
} from "./shared.server.js"

export type SizeTotals = {
  brotli: number | null
  gzip: number | null
  raw: number | null
}

export type OutputScenarioRef = {
  id: string
  label: string
  slug: string
  sourceKind: string
}

export type OutputEnvironmentRef = {
  key: string
  label: string
}

export type OutputEntrypointRef = {
  key: string
  kind: EntrypointKind
  label: string
}

export type OutputLensRef = {
  id: string
  label: string
}

export type OutputRowEvidenceAvailability = {
  comparisonDetailAvailable: boolean
  graphDetailAvailable: boolean
  selectedDetailAvailable: boolean
  snapshotDetailAvailable: boolean
  state: EvidenceAvailabilityState
  treemapFrameAvailable: boolean
  unavailableReason: string | null
  waterfallDetailAvailable: boolean
}

type OutputRowBase = {
  baselineTotals: SizeTotals | null
  compatibility: CompatibilityState
  comparisonId: string | null
  comparisonState: ComparisonState
  currentTotals: SizeTotals | null
  deltaTotals: SizeTotals | null
  entrypoint: OutputEntrypointRef
  entrypointKind: EntrypointKind
  environment: OutputEnvironmentRef
  evidenceAvailability: OutputRowEvidenceAvailability
  lens: OutputLensRef
  measurementState: MeasurementState
  miniViz: MiniViz
  policyState: PolicyState
  rowId: string
  scenario: OutputScenarioRef
  scenarioRunId: string | null
  selectedSize: SizeMetric
  seriesId: string | null
  seriesKey: ComparableSeriesKey
}

export type ReviewOutputRow = OutputRowBase & {
  kind: "review"
  primaryItem: ReviewedComparisonItemSummaryV1 | null
  reviewState: ReviewSeriesState
}

export type ScenarioLatestOutputRow = OutputRowBase & {
  activeCommitSha: string | null
  hasNewerFailedRun: boolean
  kind: "scenario-latest"
  latestFailureMessage: string | null
}

export type ScenarioHistoryOutputRow = OutputRowBase & {
  kind: "scenario-history"
  points: Array<{ commitSha: string; measuredAt: string; state: "measured"; value: number }>
}

export type CompareOutputRow = OutputRowBase & {
  kind: "compare"
  primaryItem: NeutralScenarioCompareRow["primaryItem"]
}

export type UnionPairSeriesPoint = {
  branch: string
  commitGroupId: string
  commitSha: string
  entrypoint: string
  entrypointKind: string
  environment: string
  lens: string
  measuredAt: string
  scenarioId: string
  scenarioRunId: string
  scenarioSlug: string
  scenarioSourceKind: string
  seriesId: string
  totals: SizeTotals | null
}

export type UnionPairComparisonMeta = {
  budgetState: string | null
  comparisonId: string
  failureMessage: string | null
  hasDegradedStableIdentity: boolean
  selectedEntrypointRelation: string | null
  seriesId: string
  status: string
}

export type UnionPairOutputRow = OutputRowBase & {
  basePoint: UnionPairSeriesPoint | null
  headPoint: UnionPairSeriesPoint | null
  kind: "union-pair"
  pairState: ComparisonState
  hasDegradedStableIdentity: boolean
}

export type OutputRow =
  | ReviewOutputRow
  | ScenarioLatestOutputRow
  | ScenarioHistoryOutputRow
  | CompareOutputRow
  | UnionPairOutputRow

export type OutputRowMiniVizPoint = {
  commitSha: string
  measuredAt: string
  value: number
}

export type OutputRowMiniVizData =
  | {
      latestValue: number
      miniViz: MiniViz
      points: OutputRowMiniVizPoint[]
      previousValue: number | null
      status: "available"
    }
  | {
      miniViz: MiniViz
      reason: string
      status: "unavailable"
    }

export function reviewOutputRowsFromSummary(
  summary: PrReviewSummaryV1,
  selectedSize: SizeMetric,
): ReviewOutputRow[] {
  return reviewOutputRowsFromReviewedRows(buildReviewedCompareRows(summary.scenarioGroups), selectedSize)
}

export function reviewOutputRowsFromReviewedRows(
  rows: ReviewedScenarioCompareRow[],
  selectedSize: SizeMetric,
): ReviewOutputRow[] {
  return rows.map((row) => {
    const base = outputRowBaseFromSeries({
      comparisonId: row.series.comparisonId,
      scenarioId: row.scenarioId,
      scenarioSlug: row.scenarioSlug,
      scenarioSourceKind: row.sourceKind,
      selectedSize,
      series: row.series,
    })

    return {
      ...base,
      kind: "review",
      primaryItem: row.primaryItem,
      reviewState: row.series.reviewState,
    }
  })
}

export function compareOutputRowsFromNeutralRows(
  rows: NeutralScenarioCompareRow[],
  selectedSize: SizeMetric,
): CompareOutputRow[] {
  return rows.map((row) => {
    const base = outputRowBaseFromSeries({
      comparisonId: row.series.comparisonId,
      scenarioId: row.scenarioId,
      scenarioSlug: row.scenarioSlug,
      scenarioSourceKind: row.sourceKind,
      selectedSize,
      series: row.series,
    })

    return {
      ...base,
      kind: "compare",
      primaryItem: row.primaryItem,
    }
  })
}

export async function loadUnionPairOutputRows(
  env: AppBindings,
  input: {
    baseSha: string
    headSha: string
    repositoryId: string
    selectedSize: SizeMetric
  },
) {
  const commitGroups = await getDb(env)
    .select({
      branch: schema.commitGroups.branch,
      commitSha: schema.commitGroups.commitSha,
      id: schema.commitGroups.id,
    })
    .from(schema.commitGroups)
    .where(
      and(
        eq(schema.commitGroups.repositoryId, input.repositoryId),
        inArray(schema.commitGroups.commitSha, [input.baseSha, input.headSha]),
      ),
    )

  const baseCommitGroup = commitGroups.find((commitGroup) => commitGroup.commitSha === input.baseSha) ?? null
  const headCommitGroup = commitGroups.find((commitGroup) => commitGroup.commitSha === input.headSha) ?? null

  if (!baseCommitGroup || !headCommitGroup) {
    return {
      baseCommitGroup,
      contextMatched: false,
      headCommitGroup,
      rows: [] as UnionPairOutputRow[],
    }
  }

  const [points, comparisonRows] = await Promise.all([
    getDb(env)
      .select({
        branch: schema.seriesPoints.branch,
        commitGroupId: schema.seriesPoints.commitGroupId,
        commitSha: schema.seriesPoints.commitSha,
        entrypoint: schema.series.entrypointKey,
        entrypointKind: schema.series.entrypointKind,
        environment: schema.series.environment,
        lens: schema.series.lens,
        measuredAt: schema.seriesPoints.measuredAt,
        scenarioId: schema.series.scenarioId,
        scenarioRunId: schema.seriesPoints.scenarioRunId,
        scenarioSlug: schema.scenarios.slug,
        scenarioSourceKind: schema.scenarios.sourceKind,
        seriesId: schema.seriesPoints.seriesId,
        totalBrotliBytes: schema.seriesPoints.totalBrotliBytes,
        totalGzipBytes: schema.seriesPoints.totalGzipBytes,
        totalRawBytes: schema.seriesPoints.totalRawBytes,
      })
      .from(schema.seriesPoints)
      .innerJoin(schema.series, eq(schema.series.id, schema.seriesPoints.seriesId))
      .innerJoin(schema.scenarios, eq(schema.scenarios.id, schema.series.scenarioId))
      .where(
        and(
          eq(schema.seriesPoints.repositoryId, input.repositoryId),
          inArray(schema.seriesPoints.commitGroupId, [baseCommitGroup.id, headCommitGroup.id]),
        ),
      )
      .orderBy(
        asc(schema.scenarios.slug),
        asc(schema.series.environment),
        asc(schema.series.entrypointKey),
        asc(schema.series.lens),
      ),
    getDb(env)
      .select({
        budgetState: schema.comparisons.budgetState,
        comparisonId: schema.comparisons.id,
        failureMessage: schema.comparisons.failureMessage,
        hasDegradedStableIdentity: schema.comparisons.hasDegradedStableIdentity,
        requestedBaseSha: schema.comparisons.requestedBaseSha,
        selectedBaseCommitSha: schema.comparisons.selectedBaseCommitSha,
        selectedEntrypointRelation: schema.comparisons.selectedEntrypointRelation,
        seriesId: schema.comparisons.seriesId,
        status: schema.comparisons.status,
      })
      .from(schema.comparisons)
      .where(
        and(
          eq(schema.comparisons.repositoryId, input.repositoryId),
          eq(schema.comparisons.headCommitGroupId, headCommitGroup.id),
        ),
      ),
  ])

  const comparisonBySeriesId = new Map<string, UnionPairComparisonMeta>()

  for (const comparison of comparisonRows) {
    if (comparison.selectedBaseCommitSha !== input.baseSha && comparison.requestedBaseSha !== input.baseSha) continue

    comparisonBySeriesId.set(comparison.seriesId, {
      budgetState: comparison.budgetState,
      comparisonId: comparison.comparisonId,
      failureMessage: comparison.failureMessage,
      hasDegradedStableIdentity: Boolean(comparison.hasDegradedStableIdentity),
      selectedEntrypointRelation: comparison.selectedEntrypointRelation,
      seriesId: comparison.seriesId,
      status: comparison.status,
    })
  }

  return {
    baseCommitGroup,
    contextMatched: true,
    headCommitGroup,
    rows: unionPairOutputRowsFromPoints({
      basePoints: points.filter((point) => point.commitGroupId === baseCommitGroup.id).map(unionPointFromRow),
      comparisonBySeriesId,
      headPoints: points.filter((point) => point.commitGroupId === headCommitGroup.id).map(unionPointFromRow),
      selectedSize: input.selectedSize,
    }),
  }
}

export function unionPairOutputRowsFromPoints(input: {
  basePoints: UnionPairSeriesPoint[]
  comparisonBySeriesId?: Map<string, UnionPairComparisonMeta>
  headPoints: UnionPairSeriesPoint[]
  selectedSize: SizeMetric
}): UnionPairOutputRow[] {
  const baseByKey = new Map(input.basePoints.map((point) => [unionPointKey(point), point]))
  const headByKey = new Map(input.headPoints.map((point) => [unionPointKey(point), point]))
  const keys = [...new Set([...baseByKey.keys(), ...headByKey.keys()])]

  return keys
    .sort((left, right) => left.localeCompare(right))
    .map((key) => {
      const basePoint = baseByKey.get(key) ?? null
      const headPoint = headByKey.get(key) ?? null
      const point = headPoint ?? basePoint

      if (!point) throw new Error(`Missing union point for key ${key}`)

      const entrypointKind = toEntrypointKind(point.entrypointKind)
      const seriesKey = buildSeriesKey({
        entrypoint: point.entrypoint,
        entrypointKind,
        environment: point.environment,
        lens: point.lens,
        scenarioId: point.scenarioId,
      })
      const currentTotals = headPoint?.totals ?? null
      const baselineTotals = basePoint?.totals ?? null
      const comparisonMeta = headPoint ? input.comparisonBySeriesId?.get(headPoint.seriesId) ?? null : null
      const pairState = unionPairState({ basePoint, baselineTotals, currentTotals, headPoint, selectedSize: input.selectedSize })
      const measurementState = unionPairMeasurementState(pairState)

      return {
        basePoint,
        baselineTotals,
        compatibility: unionPairCompatibility(pairState, comparisonMeta),
        comparisonId: comparisonMeta?.comparisonId ?? null,
        comparisonState: pairState,
        currentTotals,
        deltaTotals: pairState === "same" && currentTotals && baselineTotals ? diffTotals(currentTotals, baselineTotals) : null,
        entrypoint: { key: point.entrypoint, kind: entrypointKind, label: point.entrypoint },
        entrypointKind,
        environment: { key: point.environment, label: point.environment },
        evidenceAvailability: evidenceAvailability({
          comparisonId: comparisonMeta?.comparisonId ?? null,
          failureMessage: comparisonMeta?.failureMessage ?? null,
          measurementState,
          scenarioRunId: headPoint?.scenarioRunId ?? basePoint?.scenarioRunId ?? null,
        }),
        hasDegradedStableIdentity: comparisonMeta?.hasDegradedStableIdentity ?? false,
        headPoint,
        kind: "union-pair",
        lens: lensRef(point.lens),
        measurementState,
        miniViz: unionPairMiniViz({ baselineTotals, currentTotals, pairState, selectedSize: input.selectedSize }),
        pairState,
        policyState: comparisonMeta ? mapBudgetStateToPolicyState(comparisonMeta.budgetState) : "not_evaluated",
        rowId: outputRowIdFromComparableSeriesKey(seriesKey),
        scenario: scenarioRef(point.scenarioId, point.scenarioSlug, point.scenarioSourceKind),
        scenarioRunId: headPoint?.scenarioRunId ?? basePoint?.scenarioRunId ?? null,
        selectedSize: input.selectedSize,
        seriesId: headPoint?.seriesId ?? basePoint?.seriesId ?? null,
        seriesKey,
      }
    })
}

export function scenarioLatestOutputRowsFromFreshScenario(
  scenario: {
    activeCommitSha: string
    hasNewerFailedRun: boolean
    latestFailureMessage: string | null
    scenarioId: string
    scenarioSlug: string
    series: Array<ReviewedComparisonSeriesSummaryV1 | NeutralScenarioCompareRow["series"]>
    sourceKind: string
  },
  selectedSize: SizeMetric,
  options: { lens?: string } = {},
): ScenarioLatestOutputRow[] {
  const seriesRows = options.lens
    ? scenario.series.filter((series) => series.lens === options.lens)
    : scenario.series

  return seriesRows.map((series) => ({
    ...outputRowBaseFromSeries({
      comparisonId: series.comparisonId,
      scenarioId: scenario.scenarioId,
      scenarioSlug: scenario.scenarioSlug,
      scenarioSourceKind: scenario.sourceKind,
      selectedSize,
      series,
    }),
    activeCommitSha: scenario.activeCommitSha,
    hasNewerFailedRun: scenario.hasNewerFailedRun,
    kind: "scenario-latest" as const,
    latestFailureMessage: scenario.latestFailureMessage,
  }))
}

export function scenarioHistoryOutputRowsFromSeries(
  seriesRows: ScenarioHistorySeries[],
  input: {
    scenarioId: string
    scenarioSlug: string
    scenarioSourceKind: string
    selectedSize: SizeMetric
  },
): ScenarioHistoryOutputRow[] {
  return seriesRows.map((series) => {
    const entrypointKind = toEntrypointKind(series.entrypointKind)
    const seriesKey = buildSeriesKey({
      entrypoint: series.entrypoint,
      entrypointKind,
      environment: series.environment,
      lens: series.lens,
      scenarioId: input.scenarioId,
    })
    const orderedPoints = [...series.points].sort((left, right) => right.measuredAt.localeCompare(left.measuredAt))
    const latestPoint = orderedPoints[0] ?? null
    const previousPoint = orderedPoints[1] ?? null
    const currentTotals = latestPoint ? totalsFromPoint(latestPoint) : null
    const baselineTotals = previousPoint ? totalsFromPoint(previousPoint) : null
    const deltaTotals = currentTotals && baselineTotals ? diffTotals(currentTotals, baselineTotals) : null
    const points = orderedPoints
      .map((point) => ({
        commitSha: point.commitSha,
        measuredAt: point.measuredAt,
        state: "measured" as const,
        value: sizeValue(totalsFromPoint(point), input.selectedSize),
      }))
      .filter((point): point is { commitSha: string; measuredAt: string; state: "measured"; value: number } => point.value !== null)
      .reverse()

    return {
      baselineTotals,
      compatibility: "exact",
      comparisonId: null,
      comparisonState: baselineTotals ? "same" : "unavailable",
      currentTotals,
      deltaTotals,
      entrypoint: { key: series.entrypoint, kind: entrypointKind, label: series.entrypoint },
      entrypointKind,
      environment: { key: series.environment, label: series.environment },
      evidenceAvailability: evidenceAvailability({ scenarioRunId: latestPoint?.scenarioRunId ?? null }),
      kind: "scenario-history",
      lens: lensRef(series.lens),
      measurementState: latestPoint ? "complete" : "pending",
      miniViz: miniVizFromRecentPoints(points),
      points,
      policyState: "not_configured",
      rowId: outputRowIdFromComparableSeriesKey(seriesKey),
      scenario: scenarioRef(input.scenarioId, input.scenarioSlug, input.scenarioSourceKind),
      scenarioRunId: latestPoint?.scenarioRunId ?? null,
      selectedSize: input.selectedSize,
      seriesId: series.seriesId,
      seriesKey,
    }
  })
}

export function outputRowsFromCanonicalFixtures(
  fixtures: readonly SemanticUiFixture[] = canonicalUiFixtures,
): ScenarioLatestOutputRow[] {
  return fixtures.flatMap((fixture) =>
    fixture.rows.map((fixtureRow) => {
      const seriesKey = buildSeriesKey({
        entrypoint: fixtureRow.entrypointKey,
        entrypointKind: fixtureRow.entrypointKind,
        environment: fixtureRow.environmentKey,
        lens: fixtureRow.lensId,
        scenarioId: fixtureRow.scenarioId,
      })
      const currentTotals = totalsFromSelectedSize(fixtureRow.currentBytes ?? null, fixtureRow.sizeMetric)
      const baselineTotals = totalsFromSelectedSize(fixtureRow.baselineBytes ?? null, fixtureRow.sizeMetric)

      return {
        activeCommitSha: null,
        baselineTotals,
        compatibility: fixtureRow.compatibility,
        comparisonId: null,
        comparisonState: fixtureRow.comparisonState,
        currentTotals,
        deltaTotals: currentTotals && baselineTotals ? diffTotals(currentTotals, baselineTotals) : null,
        entrypoint: {
          key: fixtureRow.entrypointKey,
          kind: fixtureRow.entrypointKind,
          label: fixtureRow.entrypointKey,
        },
        entrypointKind: fixtureRow.entrypointKind,
        environment: { key: fixtureRow.environmentKey, label: fixtureRow.environmentLabel },
        evidenceAvailability: evidenceAvailability({ state: fixtureRow.evidenceAvailability }),
        hasNewerFailedRun: false,
        kind: "scenario-latest",
        latestFailureMessage: null,
        lens: lensRef(fixtureRow.lensId),
        measurementState: fixtureRow.measurementState,
        miniViz: fixtureRow.miniViz,
        policyState: fixtureRow.policyState,
        rowId: outputRowIdFromComparableSeriesKey(seriesKey),
        scenario: scenarioRef(fixtureRow.scenarioId, fixtureRow.scenarioId, "fixture"),
        scenarioRunId: null,
        selectedSize: fixtureRow.sizeMetric,
        seriesId: null,
        seriesKey,
      }
    })
  )
}

export async function loadOutputRowMiniVizData(
  env: AppBindings,
  input: {
    pointLimit?: number
    repositoryId: string
    selectedSize: SizeMetric
    seriesIds: string[]
  },
): Promise<Map<string, OutputRowMiniVizData>> {
  const uniqueSeriesIds = [...new Set(input.seriesIds)]
  const output = new Map<string, OutputRowMiniVizData>()

  if (uniqueSeriesIds.length === 0) return output

  const rows = await getDb(env)
    .select({
      commitSha: schema.seriesPoints.commitSha,
      measuredAt: schema.seriesPoints.measuredAt,
      seriesId: schema.seriesPoints.seriesId,
      totalBrotliBytes: schema.seriesPoints.totalBrotliBytes,
      totalGzipBytes: schema.seriesPoints.totalGzipBytes,
      totalRawBytes: schema.seriesPoints.totalRawBytes,
    })
    .from(schema.seriesPoints)
    .where(
      and(
        eq(schema.seriesPoints.repositoryId, input.repositoryId),
        inArray(schema.seriesPoints.seriesId, uniqueSeriesIds),
      ),
    )
    .orderBy(
      asc(schema.seriesPoints.seriesId),
      desc(schema.seriesPoints.measuredAt),
      desc(schema.seriesPoints.createdAt),
    )

  const pointLimit = input.pointLimit ?? 8
  const pointsBySeries = new Map<string, OutputRowMiniVizPoint[]>()

  for (const row of rows) {
    const existing = pointsBySeries.get(row.seriesId) ?? []
    if (existing.length >= pointLimit) continue

    existing.push({
      commitSha: row.commitSha,
      measuredAt: row.measuredAt,
      value: sizeValue(totalsFromPoint(row), input.selectedSize) ?? 0,
    })
    pointsBySeries.set(row.seriesId, existing)
  }

  for (const seriesId of uniqueSeriesIds) {
    const points = pointsBySeries.get(seriesId) ?? []
    const latest = points[0]

    if (!latest) {
      output.set(seriesId, {
        miniViz: { kind: "none", reason: "No recent points are available." },
        reason: "No recent points are available.",
        status: "unavailable",
      })
      continue
    }

    output.set(seriesId, {
      latestValue: latest.value,
      miniViz: miniVizFromRecentPoints([...points].reverse()),
      points: [...points].reverse(),
      previousValue: points[1]?.value ?? null,
      status: "available",
    })
  }

  return output
}

export function miniVizFromRecentPoints(points: OutputRowMiniVizPoint[]): MiniViz {
  if (points.length === 0) {
    return { kind: "none", reason: "No recent points are available." }
  }

  if (points.length === 1) {
    return { kind: "status-chip", state: "single_point", reason: "Only one point is available." }
  }

  return {
    kind: "sparkline",
    points: points.map((point) => ({ x: point.commitSha, value: point.value })),
    unit: "bytes",
  }
}

function outputRowBaseFromSeries(input: {
  comparisonId: string | null
  scenarioId: string
  scenarioSlug: string
  scenarioSourceKind: string
  selectedSize: SizeMetric
  series: ReviewedComparisonSeriesSummaryV1 | NeutralScenarioCompareRow["series"]
}): OutputRowBase {
  const entrypointKind = toEntrypointKind(input.series.entrypointKind)
  const seriesKey = buildSeriesKey({
    entrypoint: input.series.entrypoint,
    entrypointKind,
    environment: input.series.environment,
    lens: input.series.lens,
    scenarioId: input.scenarioId,
  })
  const currentTotals = normalizeTotals(input.series.currentTotals)
  const baselineTotals = normalizeTotals(input.series.baselineTotals)
  const measurementState = measurementStateFromSeries(input.series)

  return {
    baselineTotals,
    compatibility: "exact",
    comparisonId: input.comparisonId,
    comparisonState: comparisonStateFromSeries(input.series),
    currentTotals,
    deltaTotals: normalizeTotals(input.series.deltaTotals),
    entrypoint: { key: input.series.entrypoint, kind: entrypointKind, label: input.series.entrypoint },
    entrypointKind,
    environment: { key: input.series.environment, label: input.series.environment },
    evidenceAvailability: evidenceAvailability({
      comparisonId: input.comparisonId,
      failureMessage: "failureMessage" in input.series ? input.series.failureMessage : null,
      measurementState,
      scenarioRunId: input.series.scenarioRunId,
    }),
    lens: lensRef(input.series.lens),
    measurementState,
    miniViz: miniVizFromSeries(input.series, input.selectedSize),
    policyState: mapBudgetStateToPolicyState(input.series.budgetState),
    rowId: outputRowIdFromComparableSeriesKey(seriesKey),
    scenario: scenarioRef(input.scenarioId, input.scenarioSlug, input.scenarioSourceKind),
    scenarioRunId: input.series.scenarioRunId,
    selectedSize: input.selectedSize,
    seriesId: input.series.seriesId,
    seriesKey,
  }
}

function miniVizFromSeries(
  series: ReviewedComparisonSeriesSummaryV1 | NeutralScenarioCompareRow["series"],
  selectedSize: SizeMetric,
): MiniViz {
  if (series.status === "failed") {
    return { kind: "status-chip", state: "failed", reason: series.failureMessage }
  }

  return buildDeltaMiniViz({
    baseline: sizeValue(normalizeTotals(series.baselineTotals), selectedSize),
    current: sizeValue(normalizeTotals(series.currentTotals), selectedSize),
  })
}

function measurementStateFromSeries(
  series: ReviewedComparisonSeriesSummaryV1 | NeutralScenarioCompareRow["series"],
): MeasurementState {
  if (series.status === "failed") return "failed"
  if (series.status === "no-baseline") return "missing_baseline"
  return "complete"
}

function comparisonStateFromSeries(
  series: ReviewedComparisonSeriesSummaryV1 | NeutralScenarioCompareRow["series"],
): ComparisonState {
  if (series.status === "failed") return "invalid"
  if (series.status === "no-baseline") return "unavailable"
  return "same"
}

function evidenceAvailability(input: {
  comparisonId?: string | null
  failureMessage?: string | null
  measurementState?: MeasurementState
  scenarioRunId?: string | null
  state?: EvidenceAvailabilityState
}): OutputRowEvidenceAvailability {
  if (input.state && input.state !== "available") {
    return {
      comparisonDetailAvailable: false,
      graphDetailAvailable: false,
      selectedDetailAvailable: false,
      snapshotDetailAvailable: false,
      state: input.state,
      treemapFrameAvailable: false,
      unavailableReason: input.state,
      waterfallDetailAvailable: false,
    }
  }

  if (input.measurementState === "failed") {
    return {
      comparisonDetailAvailable: false,
      graphDetailAvailable: false,
      selectedDetailAvailable: false,
      snapshotDetailAvailable: false,
      state: "error",
      treemapFrameAvailable: false,
      unavailableReason: input.failureMessage ?? "Measurement failed.",
      waterfallDetailAvailable: false,
    }
  }

  const hasSnapshot = Boolean(input.scenarioRunId) || input.state === "available"

  return {
    comparisonDetailAvailable: Boolean(input.comparisonId),
    graphDetailAvailable: hasSnapshot,
    selectedDetailAvailable: hasSnapshot || Boolean(input.comparisonId),
    snapshotDetailAvailable: hasSnapshot,
    state: hasSnapshot || input.comparisonId ? "available" : "missing",
    treemapFrameAvailable: hasSnapshot,
    unavailableReason: hasSnapshot || input.comparisonId ? null : "No scenario run is available.",
    waterfallDetailAvailable: hasSnapshot,
  }
}

function buildSeriesKey(input: {
  entrypoint: string
  entrypointKind: EntrypointKind
  environment: string
  lens: string
  scenarioId: string
}): ComparableSeriesKey {
  return {
    entrypointKey: input.entrypoint,
    entrypointKind: input.entrypointKind,
    environmentKey: input.environment,
    lensId: input.lens,
    scenarioId: input.scenarioId,
  }
}

function scenarioRef(id: string, slug: string, sourceKind: string): OutputScenarioRef {
  return { id, label: slug, slug, sourceKind }
}

function lensRef(id: string): OutputLensRef {
  return { id, label: id === defaultLensDefinition.id ? defaultLensDefinition.label : id }
}

function normalizeTotals(totals: { brotli: number; gzip: number; raw: number } | null): SizeTotals | null {
  if (!totals) return null
  return { brotli: totals.brotli, gzip: totals.gzip, raw: totals.raw }
}

function totalsFromPoint(point: { totalBrotliBytes: number; totalGzipBytes: number; totalRawBytes: number }): SizeTotals {
  return {
    brotli: point.totalBrotliBytes,
    gzip: point.totalGzipBytes,
    raw: point.totalRawBytes,
  }
}

function totalsFromSelectedSize(value: number | null, selectedSize: SizeMetric): SizeTotals | null {
  if (value === null) return null

  return {
    brotli: selectedSize === "brotli" ? value : null,
    gzip: selectedSize === "gzip" ? value : null,
    raw: selectedSize === "raw" ? value : null,
  }
}

function diffTotals(current: SizeTotals, baseline: SizeTotals): SizeTotals {
  return {
    brotli: current.brotli !== null && baseline.brotli !== null ? current.brotli - baseline.brotli : null,
    gzip: current.gzip !== null && baseline.gzip !== null ? current.gzip - baseline.gzip : null,
    raw: current.raw !== null && baseline.raw !== null ? current.raw - baseline.raw : null,
  }
}

function sizeValue(totals: SizeTotals | null, selectedSize: SizeMetric) {
  return totals?.[selectedSize] ?? null
}

function unionPointFromRow(row: {
  branch: string
  commitGroupId: string
  commitSha: string
  entrypoint: string
  entrypointKind: string
  environment: string
  lens: string
  measuredAt: string
  scenarioId: string
  scenarioRunId: string
  scenarioSlug: string
  scenarioSourceKind: string
  seriesId: string
  totalBrotliBytes: number
  totalGzipBytes: number
  totalRawBytes: number
}): UnionPairSeriesPoint {
  return {
    branch: row.branch,
    commitGroupId: row.commitGroupId,
    commitSha: row.commitSha,
    entrypoint: row.entrypoint,
    entrypointKind: row.entrypointKind,
    environment: row.environment,
    lens: row.lens,
    measuredAt: row.measuredAt,
    scenarioId: row.scenarioId,
    scenarioRunId: row.scenarioRunId,
    scenarioSlug: row.scenarioSlug,
    scenarioSourceKind: row.scenarioSourceKind,
    seriesId: row.seriesId,
    totals: totalsFromPoint(row),
  }
}

function unionPointKey(point: UnionPairSeriesPoint) {
  return [point.scenarioId, point.environment, point.entrypointKind, point.entrypoint, point.lens].join("\0")
}

function unionPairState(input: {
  basePoint: UnionPairSeriesPoint | null
  baselineTotals: SizeTotals | null
  currentTotals: SizeTotals | null
  headPoint: UnionPairSeriesPoint | null
  selectedSize: SizeMetric
}): ComparisonState {
  const point = input.headPoint ?? input.basePoint

  if (!point) return "invalid"
  if (!lensRegistry.some((lens) => lens.id === point.lens)) return "unsupported_lens"
  if ((input.headPoint && !input.currentTotals) || (input.basePoint && !input.baselineTotals)) return "unavailable"

  if (input.headPoint && !input.basePoint) {
    return sizeValue(input.currentTotals, input.selectedSize) === null ? "missing_size" : "added"
  }

  if (input.basePoint && !input.headPoint) {
    return sizeValue(input.baselineTotals, input.selectedSize) === null ? "missing_size" : "removed"
  }

  if (sizeValue(input.currentTotals, input.selectedSize) === null || sizeValue(input.baselineTotals, input.selectedSize) === null) {
    return "missing_size"
  }

  return "same"
}

function unionPairCompatibility(
  pairState: ComparisonState,
  comparisonMeta: UnionPairComparisonMeta | null,
): CompatibilityState {
  if (pairState === "unsupported_lens" || pairState === "missing_size" || pairState === "invalid") return "invalid"
  if (pairState === "added" || pairState === "removed" || pairState === "unavailable") return "partial"
  return comparisonMeta ? "exact" : "exploratory"
}

function unionPairMeasurementState(pairState: ComparisonState): MeasurementState {
  if (pairState === "unsupported_lens") return "unsupported"
  if (pairState === "missing_size" || pairState === "invalid" || pairState === "unavailable") return "incomplete"
  return "complete"
}

function unionPairMiniViz(input: {
  baselineTotals: SizeTotals | null
  currentTotals: SizeTotals | null
  pairState: ComparisonState
  selectedSize: SizeMetric
}): MiniViz {
  if (input.pairState === "same") {
    return buildDeltaMiniViz({
      baseline: sizeValue(input.baselineTotals, input.selectedSize),
      current: sizeValue(input.currentTotals, input.selectedSize),
    })
  }

  if (input.pairState === "added") return { kind: "status-chip", state: "added", reason: "Only the head artifact has this output." }
  if (input.pairState === "removed") return { kind: "status-chip", state: "removed", reason: "Only the base artifact has this output." }
  if (input.pairState === "unsupported_lens") return { kind: "none", reason: "This What's counted lens is unsupported." }
  if (input.pairState === "missing_size") return { kind: "none", reason: `${input.selectedSize} size is unavailable.` }

  return { kind: "none", reason: "This pair cannot be compared." }
}

function toEntrypointKind(value: string): EntrypointKind {
  if (entrypointKinds.includes(value as EntrypointKind)) return value as EntrypointKind
  throw new Error(`Unsupported entrypoint kind: ${value}`)
}
