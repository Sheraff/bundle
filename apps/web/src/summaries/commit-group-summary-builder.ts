import {
  SCHEMA_VERSION_V1,
  commitGroupSummaryV1Schema,
  type CommitGroupSummaryV1,
  type ComparisonMetricKey,
  type FreshCommitGroupScenarioSummaryV1,
  type NeutralComparisonSeriesSummaryV1,
} from "@workspace/contracts"
import { and, asc, desc, eq } from "drizzle-orm"
import * as v from "valibot"

import { getDb, schema } from "../db/index.js"
import type { AppBindings } from "../env.js"
import { formatIssues } from "../shared/format-issues.js"

import {
  groupScenarioRunsByScenarioId,
  hasInFlightRun,
  hasNewerFailedRun,
  selectActiveRunsByScenarioId,
  selectLatestFailedRun,
} from "./active-run-policy.js"
import { loadActiveSeriesComparisons, findInheritedScenarioSource } from "./comparison-loaders.js"
import { COMMIT_GROUP_SETTLEMENT_QUIET_WINDOW_MS } from "./constants.js"
import type {
  ActiveSeriesComparisonRow,
  CommitGroupRow,
  ExistingSummaryState,
  ScenarioCatalogRow,
  ScenarioRunSummaryRow,
  SummaryComparisonKind,
} from "./types.js"

const METRIC_KEY_ORDER = [
  "total-raw-bytes",
  "total-gzip-bytes",
  "total-brotli-bytes",
] as const satisfies readonly ComparisonMetricKey[]

export async function buildCommitGroupSummary(
  env: AppBindings,
  commitGroup: CommitGroupRow,
  existingSummaryState: ExistingSummaryState | null,
) {
  const db = getDb(env)
  const [catalogScenarios, scenarioRuns] = await Promise.all([
    db
      .select({
        id: schema.scenarios.id,
        slug: schema.scenarios.slug,
        sourceKind: schema.scenarios.sourceKind,
      })
      .from(schema.scenarios)
      .where(eq(schema.scenarios.repositoryId, commitGroup.repositoryId))
      .orderBy(asc(schema.scenarios.slug)),
    db
      .select({
        id: schema.scenarioRuns.id,
        scenarioId: schema.scenarioRuns.scenarioId,
        scenarioSlug: schema.scenarios.slug,
        sourceKind: schema.scenarios.sourceKind,
        status: schema.scenarioRuns.status,
        commitGroupId: schema.scenarioRuns.commitGroupId,
        commitSha: schema.scenarioRuns.commitSha,
        branch: schema.scenarioRuns.branch,
        uploadedAt: schema.scenarioRuns.uploadedAt,
        createdAt: schema.scenarioRuns.createdAt,
        failureCode: schema.scenarioRuns.failureCode,
        failureMessage: schema.scenarioRuns.failureMessage,
      })
      .from(schema.scenarioRuns)
      .innerJoin(schema.scenarios, eq(schema.scenarios.id, schema.scenarioRuns.scenarioId))
      .where(eq(schema.scenarioRuns.commitGroupId, commitGroup.id))
      .orderBy(desc(schema.scenarioRuns.uploadedAt), desc(schema.scenarioRuns.createdAt)),
  ])

  const comparisonKind: SummaryComparisonKind = commitGroup.pullRequestId
    ? "pr-base"
    : "branch-previous"
  const runsByScenarioId = groupScenarioRunsByScenarioId(scenarioRuns)
  const activeRunsByScenarioId = selectActiveRunsByScenarioId(runsByScenarioId)
  const activeSeriesRows = await loadActiveSeriesComparisons(
    db,
    [...activeRunsByScenarioId.values()].map((scenarioRun) => scenarioRun.id),
    comparisonKind,
  )
  const seriesRowsByScenarioRunId = new Map<string, ActiveSeriesComparisonRow[]>()

  for (const activeSeriesRow of activeSeriesRows) {
    const currentSeriesRows = seriesRowsByScenarioRunId.get(activeSeriesRow.scenarioRunId) ?? []
    currentSeriesRows.push(activeSeriesRow)
    seriesRowsByScenarioRunId.set(activeSeriesRow.scenarioRunId, currentSeriesRows)
  }

  const quietWindowDeadline = new Date(
    Date.parse(commitGroup.latestUploadAt) + COMMIT_GROUP_SETTLEMENT_QUIET_WINDOW_MS,
  ).toISOString()
  const quietWindowElapsed = Date.now() >= Date.parse(quietWindowDeadline)
  const freshScenarioGroups: FreshCommitGroupScenarioSummaryV1[] = []
  const statusScenarios: CommitGroupSummaryV1["statusScenarios"] = []
  let pendingScenarioCount = 0
  let unresolvedAbsentScenarioCount = 0

  for (const catalogScenario of catalogScenarios) {
    const scenarioRunsForScenario = runsByScenarioId.get(catalogScenario.id) ?? []
    const activeRun = activeRunsByScenarioId.get(catalogScenario.id)
    const latestFailedRun = selectLatestFailedRun(scenarioRunsForScenario)

    if (activeRun) {
      freshScenarioGroups.push(
        buildFreshScenarioGroup(
          catalogScenario,
          activeRun,
          latestFailedRun,
          scenarioRunsForScenario,
          seriesRowsByScenarioRunId.get(activeRun.id) ?? [],
        ),
      )
    }

    if (hasInFlightRun(scenarioRunsForScenario)) {
      pendingScenarioCount += 1
      continue
    }

    if (activeRun) {
      continue
    }

    if (latestFailedRun) {
      statusScenarios.push({
        state: "failed",
        scenarioId: catalogScenario.id,
        scenarioSlug: catalogScenario.slug,
        sourceKind: catalogScenario.sourceKind,
        latestFailedScenarioRunId: latestFailedRun.id,
        latestFailedAt: latestFailedRun.uploadedAt,
        failureCode: latestFailedRun.failureCode,
        failureMessage: latestFailedRun.failureMessage,
      })
      continue
    }

    if (!quietWindowElapsed) {
      pendingScenarioCount += 1
      unresolvedAbsentScenarioCount += 1
      continue
    }

    const inheritedSource = await findInheritedScenarioSource(
      db,
      commitGroup.repositoryId,
      catalogScenario.id,
      commitGroup.id,
    )

    if (inheritedSource) {
      statusScenarios.push({
        state: "inherited",
        scenarioId: catalogScenario.id,
        scenarioSlug: catalogScenario.slug,
        sourceKind: catalogScenario.sourceKind,
        sourceScenarioRunId: inheritedSource.id,
        sourceCommitGroupId: inheritedSource.commitGroupId,
        sourceCommitSha: inheritedSource.commitSha,
        sourceBranch: inheritedSource.branch,
        sourceUploadedAt: inheritedSource.uploadedAt,
      })
      continue
    }

    statusScenarios.push({
      state: "missing",
      scenarioId: catalogScenario.id,
      scenarioSlug: catalogScenario.slug,
      sourceKind: catalogScenario.sourceKind,
      reason: "No prior processed scenario run was available to inherit.",
    })
  }

  const comparisonCount = freshScenarioGroups.reduce(
    (total, freshScenarioGroup) => total + freshScenarioGroup.series.length,
    0,
  )
  const changedMetricCount = freshScenarioGroups.reduce(
    (total, freshScenarioGroup) =>
      total +
      freshScenarioGroup.series.reduce(
        (groupTotal, seriesSummary) => groupTotal + seriesSummary.items.length,
        0,
      ),
    0,
  )
  const noBaselineSeriesCount = freshScenarioGroups.reduce(
    (total, freshScenarioGroup) =>
      total +
      freshScenarioGroup.series.filter((seriesSummary) => seriesSummary.status === "no-baseline")
        .length,
    0,
  )
  const failedComparisonCount = freshScenarioGroups.reduce(
    (total, freshScenarioGroup) =>
      total +
      freshScenarioGroup.series.filter((seriesSummary) => seriesSummary.status === "failed").length,
    0,
  )
  const degradedComparisonCount = freshScenarioGroups.reduce(
    (total, freshScenarioGroup) =>
      total +
      freshScenarioGroup.series.filter(
        (seriesSummary) =>
          seriesSummary.status === "materialized" && seriesSummary.hasDegradedStableIdentity,
      ).length,
    0,
  )
  const impactedScenarioCount = freshScenarioGroups.filter(isFreshScenarioImpacted).length
  const unchangedScenarioCount = freshScenarioGroups.filter(isFreshScenarioUnchanged).length
  const summaryStatus: CommitGroupSummaryV1["status"] =
    pendingScenarioCount > 0 ? "pending" : "settled"
  const settledAt =
    summaryStatus === "settled"
      ? existingSummaryState?.status === "settled" && existingSummaryState.settledAt
        ? existingSummaryState.settledAt
        : new Date().toISOString()
      : null
  const summaryResult = v.safeParse(commitGroupSummaryV1Schema, {
    schemaVersion: SCHEMA_VERSION_V1,
    repositoryId: commitGroup.repositoryId,
    commitGroupId: commitGroup.id,
    pullRequestId: commitGroup.pullRequestId,
    comparisonKind,
    commitSha: commitGroup.commitSha,
    branch: commitGroup.branch,
    status: summaryStatus,
    quietWindowDeadline,
    settledAt,
    counts: {
      expectedScenarioCount: catalogScenarios.length,
      freshScenarioCount: activeRunsByScenarioId.size,
      pendingScenarioCount,
      inheritedScenarioCount: statusScenarios.filter((scenario) => scenario.state === "inherited")
        .length,
      missingScenarioCount: statusScenarios.filter((scenario) => scenario.state === "missing")
        .length,
      failedScenarioCount: statusScenarios.filter((scenario) => scenario.state === "failed").length,
      impactedScenarioCount,
      unchangedScenarioCount,
      comparisonCount,
      changedMetricCount,
      noBaselineSeriesCount,
      failedComparisonCount,
      degradedComparisonCount,
    },
    freshScenarioGroups: sortFreshScenarioGroups(freshScenarioGroups),
    statusScenarios: sortStatusScenarios(statusScenarios),
  })

  if (!summaryResult.success) {
    throw new Error(
      `Generated commit-group summary is invalid: ${formatIssues(summaryResult.issues)}`,
    )
  }

  return {
    summary: summaryResult.output,
    shouldScheduleSettlement: unresolvedAbsentScenarioCount > 0,
  }
}

function buildFreshScenarioGroup(
  catalogScenario: ScenarioCatalogRow,
  activeRun: ScenarioRunSummaryRow,
  latestFailedRun: ScenarioRunSummaryRow | null,
  scenarioRuns: ScenarioRunSummaryRow[],
  activeSeriesRows: ActiveSeriesComparisonRow[],
): FreshCommitGroupScenarioSummaryV1 {
  const scenarioHasNewerFailedRun = hasNewerFailedRun(latestFailedRun, activeRun)

  return {
    scenarioId: catalogScenario.id,
    scenarioSlug: catalogScenario.slug,
    sourceKind: catalogScenario.sourceKind,
    activeScenarioRunId: activeRun.id,
    activeCommitSha: activeRun.commitSha,
    activeUploadedAt: activeRun.uploadedAt,
    totalRunCount: scenarioRuns.length,
    processedRunCount: scenarioRuns.filter((scenarioRun) => scenarioRun.status === "processed")
      .length,
    failedRunCount: scenarioRuns.filter((scenarioRun) => scenarioRun.status === "failed").length,
    hasMultipleProcessedRuns:
      scenarioRuns.filter((scenarioRun) => scenarioRun.status === "processed").length > 1,
    hasNewerFailedRun: scenarioHasNewerFailedRun,
    latestFailedScenarioRunId: scenarioHasNewerFailedRun ? (latestFailedRun?.id ?? null) : null,
    latestFailedAt: scenarioHasNewerFailedRun ? (latestFailedRun?.uploadedAt ?? null) : null,
    latestFailureCode: scenarioHasNewerFailedRun ? (latestFailedRun?.failureCode ?? null) : null,
    latestFailureMessage: scenarioHasNewerFailedRun
      ? (latestFailedRun?.failureMessage ?? null)
      : null,
    series: activeSeriesRows
      .map(buildNeutralSeriesSummary)
      .filter(
        (seriesSummary): seriesSummary is NeutralComparisonSeriesSummaryV1 =>
          seriesSummary !== null,
      )
      .sort(compareSeriesSummaries),
  }
}

function buildNeutralSeriesSummary(
  activeSeriesRow: ActiveSeriesComparisonRow,
): NeutralComparisonSeriesSummaryV1 | null {
  if (!activeSeriesRow.comparisonId || !activeSeriesRow.comparisonStatus) {
    return null
  }

  const currentTotals = {
    raw: activeSeriesRow.currentTotalRawBytes ?? 0,
    gzip: activeSeriesRow.currentTotalGzipBytes ?? 0,
    brotli: activeSeriesRow.currentTotalBrotliBytes ?? 0,
  }
  const baselineTotals =
    activeSeriesRow.baselineTotalRawBytes === null ||
    activeSeriesRow.baselineTotalGzipBytes === null ||
    activeSeriesRow.baselineTotalBrotliBytes === null
      ? null
      : {
          raw: activeSeriesRow.baselineTotalRawBytes,
          gzip: activeSeriesRow.baselineTotalGzipBytes,
          brotli: activeSeriesRow.baselineTotalBrotliBytes,
        }
  const deltaTotals =
    activeSeriesRow.deltaTotalRawBytes === null ||
    activeSeriesRow.deltaTotalGzipBytes === null ||
    activeSeriesRow.deltaTotalBrotliBytes === null
      ? null
      : {
          raw: activeSeriesRow.deltaTotalRawBytes,
          gzip: activeSeriesRow.deltaTotalGzipBytes,
          brotli: activeSeriesRow.deltaTotalBrotliBytes,
        }
  const selectedHeadCommitSha = activeSeriesRow.selectedHeadCommitSha

  if (!selectedHeadCommitSha) {
    return null
  }

  const commonSummaryFields = {
    comparisonId: activeSeriesRow.comparisonId,
    seriesId: activeSeriesRow.seriesId,
    scenarioRunId: activeSeriesRow.scenarioRunId,
    environment: activeSeriesRow.environment,
    entrypoint: activeSeriesRow.entrypoint,
    entrypointKind: activeSeriesRow.entrypointKind,
    lens: activeSeriesRow.lens,
    requestedBaseSha: activeSeriesRow.requestedBaseSha,
    selectedBaseCommitSha: activeSeriesRow.selectedBaseCommitSha,
    selectedHeadCommitSha,
    currentTotals,
    baselineTotals,
    deltaTotals,
    budgetState: activeSeriesRow.budgetState ?? "not-configured",
    hasDegradedStableIdentity: Boolean(activeSeriesRow.hasDegradedStableIdentity),
    selectedEntrypointRelation: activeSeriesRow.selectedEntrypointRelation,
  }

  if (activeSeriesRow.comparisonStatus === "materialized") {
    return {
      ...commonSummaryFields,
      status: "materialized",
      items: buildNeutralComparisonItems(activeSeriesRow),
    }
  }

  if (activeSeriesRow.comparisonStatus === "no-baseline") {
    return {
      ...commonSummaryFields,
      status: "no-baseline",
      items: [],
    }
  }

  if (activeSeriesRow.comparisonStatus === "failed") {
    return {
      ...commonSummaryFields,
      status: "failed",
      items: [],
      failureCode: activeSeriesRow.failureCode ?? "comparison_failed",
      failureMessage: activeSeriesRow.failureMessage ?? "Comparison materialization failed.",
    }
  }

  return null
}

function buildNeutralComparisonItems(activeSeriesRow: ActiveSeriesComparisonRow) {
  return METRIC_KEY_ORDER.flatMap((metricKey) => {
    const metricValues = getMetricValues(activeSeriesRow, metricKey)

    if (!metricValues || metricValues.deltaValue === 0) {
      return []
    }

    return [
      {
        itemKey: `metric:${metricKey}`,
        metricKey,
        currentValue: metricValues.currentValue,
        baselineValue: metricValues.baselineValue,
        deltaValue: metricValues.deltaValue,
        percentageDelta: percentageDelta(metricValues.currentValue, metricValues.baselineValue),
        direction: metricValues.deltaValue > 0 ? ("regression" as const) : ("improvement" as const),
      },
    ]
  })
}

function getMetricValues(
  activeSeriesRow: ActiveSeriesComparisonRow,
  metricKey: ComparisonMetricKey,
) {
  if (metricKey === "total-raw-bytes") {
    return activeSeriesRow.baselineTotalRawBytes === null ||
      activeSeriesRow.deltaTotalRawBytes === null
      ? null
      : {
          currentValue: activeSeriesRow.currentTotalRawBytes ?? 0,
          baselineValue: activeSeriesRow.baselineTotalRawBytes,
          deltaValue: activeSeriesRow.deltaTotalRawBytes,
        }
  }

  if (metricKey === "total-gzip-bytes") {
    return activeSeriesRow.baselineTotalGzipBytes === null ||
      activeSeriesRow.deltaTotalGzipBytes === null
      ? null
      : {
          currentValue: activeSeriesRow.currentTotalGzipBytes ?? 0,
          baselineValue: activeSeriesRow.baselineTotalGzipBytes,
          deltaValue: activeSeriesRow.deltaTotalGzipBytes,
        }
  }

  return activeSeriesRow.baselineTotalBrotliBytes === null ||
    activeSeriesRow.deltaTotalBrotliBytes === null
    ? null
    : {
        currentValue: activeSeriesRow.currentTotalBrotliBytes ?? 0,
        baselineValue: activeSeriesRow.baselineTotalBrotliBytes,
        deltaValue: activeSeriesRow.deltaTotalBrotliBytes,
      }
}

function isFreshScenarioImpacted(freshScenarioGroup: FreshCommitGroupScenarioSummaryV1) {
  if (freshScenarioGroup.hasNewerFailedRun) {
    return true
  }

  return freshScenarioGroup.series.some((seriesSummary) => {
    if (seriesSummary.status === "materialized") {
      return seriesSummary.items.length > 0
    }

    return true
  })
}

function isFreshScenarioUnchanged(freshScenarioGroup: FreshCommitGroupScenarioSummaryV1) {
  return (
    !freshScenarioGroup.hasNewerFailedRun &&
    freshScenarioGroup.series.length > 0 &&
    freshScenarioGroup.series.every(
      (seriesSummary) =>
        seriesSummary.status === "materialized" && seriesSummary.items.length === 0,
    )
  )
}

function compareSeriesSummaries(
  left: NeutralComparisonSeriesSummaryV1,
  right: NeutralComparisonSeriesSummaryV1,
) {
  return (
    left.environment.localeCompare(right.environment) ||
    left.entrypoint.localeCompare(right.entrypoint) ||
    left.lens.localeCompare(right.lens)
  )
}

function sortFreshScenarioGroups(freshScenarioGroups: FreshCommitGroupScenarioSummaryV1[]) {
  return [...freshScenarioGroups].sort((left, right) =>
    left.scenarioSlug.localeCompare(right.scenarioSlug),
  )
}

function sortStatusScenarios(statusScenarios: CommitGroupSummaryV1["statusScenarios"]) {
  return [...statusScenarios].sort(
    (left, right) =>
      left.scenarioSlug.localeCompare(right.scenarioSlug) || left.state.localeCompare(right.state),
  )
}

function percentageDelta(currentValue: number, baselineValue: number) {
  if (baselineValue === 0) {
    return currentValue === 0 ? 0 : 100
  }

  return ((currentValue - baselineValue) / baselineValue) * 100
}
