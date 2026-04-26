import {
  SCHEMA_VERSION_V1,
  prReviewSummaryV1Schema,
  type CommitGroupSummaryV1,
  type FreshCommitGroupScenarioSummaryV1,
  type NeutralComparisonItemSummaryV1,
  type NeutralComparisonSeriesSummaryV1,
  type ReviewItemState,
  type ReviewSeriesState,
  type ReviewedComparisonItemSummaryV1,
  type ReviewedComparisonSeriesSummaryV1,
  type ReviewedScenarioSummaryV1,
} from "@workspace/contracts"
import { and, eq, inArray } from "drizzle-orm"
import * as v from "valibot"

import { getDb, schema } from "../db/index.js"
import type { AppBindings } from "../env.js"
import { mapBudgetStateToPolicyState } from "../lib/policy-state.js"
import { formatIssues } from "../shared/format-issues.js"

import type { AcknowledgementOverlayRow, CommitGroupRow, PullRequestRow } from "./types.js"

const SERIES_REVIEW_PRIORITY: Record<ReviewSeriesState, number> = {
  blocking: 0,
  regression: 1,
  acknowledged: 2,
  warning: 3,
  improvement: 4,
  neutral: 5,
}
const ITEM_REVIEW_PRIORITY: Record<ReviewItemState, number> = {
  blocking: 0,
  regression: 1,
  acknowledged: 2,
  improvement: 3,
}
const BLOCKING_BUDGET_STATES = new Set(["blocking", "failing", "failed", "fail-blocking", "fail_blocking"])

export async function buildPrReviewSummary(
  env: AppBindings,
  commitGroup: CommitGroupRow,
  pullRequest: PullRequestRow,
  commitGroupSummary: CommitGroupSummaryV1,
) {
  const db = getDb(env)
  const materializedComparisonIds = commitGroupSummary.freshScenarioGroups.flatMap(
    (scenarioGroup) =>
      scenarioGroup.series
        .filter((seriesSummary) => seriesSummary.status === "materialized")
        .map((seriesSummary) => seriesSummary.comparisonId),
  )
  const acknowledgements = materializedComparisonIds.length
    ? await db
        .select({
          id: schema.acknowledgements.id,
          comparisonId: schema.acknowledgements.comparisonId,
          itemKey: schema.acknowledgements.itemKey,
          note: schema.acknowledgements.note,
        })
        .from(schema.acknowledgements)
        .where(
          and(
            eq(schema.acknowledgements.pullRequestId, pullRequest.id),
            inArray(schema.acknowledgements.comparisonId, materializedComparisonIds),
          ),
        )
    : []
  const acknowledgementsByKey = new Map<string, AcknowledgementOverlayRow>()

  for (const acknowledgement of acknowledgements) {
    acknowledgementsByKey.set(
      `${acknowledgement.comparisonId}:${acknowledgement.itemKey}`,
      acknowledgement,
    )
  }

  const scenarioGroups = commitGroupSummary.freshScenarioGroups.map((scenarioGroup) =>
    buildReviewedScenarioSummary(scenarioGroup, acknowledgementsByKey),
  )
  const blockingRegressionCount = scenarioGroups.reduce(
    (total, scenarioGroup) =>
      total +
      scenarioGroup.series.reduce(
        (groupTotal, seriesSummary) =>
          groupTotal +
          (seriesSummary.status === "materialized"
            ? seriesSummary.items.filter((item) => item.reviewState === "blocking").length
            : 0),
        0,
      ),
    0,
  )
  const regressionCount = scenarioGroups.reduce(
    (total, scenarioGroup) =>
      total +
      scenarioGroup.series.reduce(
        (groupTotal, seriesSummary) =>
          groupTotal +
          (seriesSummary.status === "materialized"
            ? seriesSummary.items.filter((item) => item.reviewState === "regression").length
            : 0),
        0,
      ),
    0,
  )
  const acknowledgedRegressionCount = scenarioGroups.reduce(
    (total, scenarioGroup) =>
      total +
      scenarioGroup.series.reduce(
        (groupTotal, seriesSummary) =>
          groupTotal +
          (seriesSummary.status === "materialized"
            ? seriesSummary.items.filter((item) => item.reviewState === "acknowledged").length
            : 0),
        0,
      ),
    0,
  )
  const improvementCount = scenarioGroups.reduce(
    (total, scenarioGroup) =>
      total +
      scenarioGroup.series.reduce(
        (groupTotal, seriesSummary) =>
          groupTotal +
          (seriesSummary.status === "materialized"
            ? seriesSummary.items.filter((item) => item.reviewState === "improvement").length
            : 0),
        0,
      ),
    0,
  )
  const impactedScenarioCount = scenarioGroups.filter(isReviewedScenarioImpacted).length
  const unchangedScenarioCount = scenarioGroups.filter(isReviewedScenarioUnchanged).length
  const summaryResult = v.safeParse(prReviewSummaryV1Schema, {
    schemaVersion: SCHEMA_VERSION_V1,
    repositoryId: commitGroup.repositoryId,
    pullRequestId: pullRequest.id,
    commitGroupId: commitGroup.id,
    commitSha: commitGroup.commitSha,
    branch: commitGroup.branch,
    baseSha: pullRequest.baseSha,
    baseRef: pullRequest.baseRef,
    headSha: pullRequest.headSha,
    headRef: pullRequest.headRef,
    status: commitGroupSummary.status,
    overallState:
      commitGroupSummary.status === "pending"
        ? "pending"
        : blockingRegressionCount > 0
      ? "failing"
      : scenarioGroups.some((scenarioGroup) => scenarioGroup.reviewState === "blocking")
        ? "failing"
        : "passing",
    settledAt: commitGroupSummary.settledAt,
    counts: {
      blockingRegressionCount,
      regressionCount,
      acknowledgedRegressionCount,
      improvementCount,
      pendingScenarioCount: commitGroupSummary.counts.pendingScenarioCount,
      inheritedScenarioCount: commitGroupSummary.counts.inheritedScenarioCount,
      missingScenarioCount: commitGroupSummary.counts.missingScenarioCount,
      failedScenarioCount: commitGroupSummary.counts.failedScenarioCount,
      impactedScenarioCount,
      unchangedScenarioCount,
      noBaselineSeriesCount: commitGroupSummary.counts.noBaselineSeriesCount,
      failedComparisonCount: commitGroupSummary.counts.failedComparisonCount,
      degradedComparisonCount: commitGroupSummary.counts.degradedComparisonCount,
    },
    scenarioGroups: sortReviewedScenarioGroups(scenarioGroups),
    statusScenarios: commitGroupSummary.statusScenarios,
  })

  if (!summaryResult.success) {
    throw new Error(`Generated PR review summary is invalid: ${formatIssues(summaryResult.issues)}`)
  }

  return summaryResult.output
}

function buildReviewedScenarioSummary(
  freshScenarioGroup: FreshCommitGroupScenarioSummaryV1,
  acknowledgementsByKey: Map<string, AcknowledgementOverlayRow>,
): ReviewedScenarioSummaryV1 {
  const reviewedSeries = freshScenarioGroup.series.map((seriesSummary) =>
    buildReviewedSeriesSummary(seriesSummary, acknowledgementsByKey),
  )
  const visibleSeries = reviewedSeries
    .filter((seriesSummary) => seriesSummary.reviewState !== "neutral")
    .sort(compareReviewedSeriesSummaries)[0]
  const changedSeriesCount = reviewedSeries.filter(
    (seriesSummary) => seriesSummary.reviewState !== "neutral",
  ).length
  const acknowledgedItemCount = reviewedSeries.reduce(
    (total, seriesSummary) =>
      total +
      (seriesSummary.status === "materialized"
        ? seriesSummary.items.filter((item) => item.acknowledged).length
        : 0),
    0,
  )

  return {
    scenarioId: freshScenarioGroup.scenarioId,
    scenarioSlug: freshScenarioGroup.scenarioSlug,
    sourceKind: freshScenarioGroup.sourceKind,
    reviewState: selectScenarioReviewState(reviewedSeries, freshScenarioGroup.hasNewerFailedRun),
    hasNewerFailedRun: freshScenarioGroup.hasNewerFailedRun,
    latestFailedScenarioRunId: freshScenarioGroup.latestFailedScenarioRunId,
    latestFailedAt: freshScenarioGroup.latestFailedAt,
    latestFailureCode: freshScenarioGroup.latestFailureCode,
    latestFailureMessage: freshScenarioGroup.latestFailureMessage,
    visibleSeriesId: visibleSeries?.seriesId ?? null,
    additionalChangedSeriesCount: Math.max(changedSeriesCount - (visibleSeries ? 1 : 0), 0),
    acknowledgedItemCount,
    series: reviewedSeries.sort(compareReviewedSeriesSummaries),
  }
}

function buildReviewedSeriesSummary(
  seriesSummary: NeutralComparisonSeriesSummaryV1,
  acknowledgementsByKey: Map<string, AcknowledgementOverlayRow>,
): ReviewedComparisonSeriesSummaryV1 {
  if (seriesSummary.status === "materialized") {
    const reviewedItems = seriesSummary.items.map((item) =>
      buildReviewedItemSummary(
        seriesSummary.comparisonId,
        seriesSummary.budgetState,
        item,
        acknowledgementsByKey,
      ),
    )
    const primaryItem = selectPrimaryReviewedItem(reviewedItems)

    return {
      ...seriesSummary,
      reviewState: selectMaterializedSeriesReviewState(seriesSummary.budgetState, primaryItem),
      items: reviewedItems,
      primaryItemKey: primaryItem?.itemKey ?? null,
    }
  }

  if (seriesSummary.status === "no-baseline") {
    return {
      ...seriesSummary,
      reviewState: "warning",
      items: [],
      primaryItemKey: null,
    }
  }

  return {
    ...seriesSummary,
    reviewState: "warning",
    items: [],
    primaryItemKey: null,
  }
}

function buildReviewedItemSummary(
  comparisonId: string,
  budgetState: string,
  item: NeutralComparisonItemSummaryV1,
  acknowledgementsByKey: Map<string, AcknowledgementOverlayRow>,
): ReviewedComparisonItemSummaryV1 {
  const acknowledgement = acknowledgementsByKey.get(`${comparisonId}:${item.itemKey}`) ?? null

  return {
    itemKey: item.itemKey,
    metricKey: item.metricKey,
    currentValue: item.currentValue,
    baselineValue: item.baselineValue,
    deltaValue: item.deltaValue,
    percentageDelta: item.percentageDelta,
    reviewState: selectReviewItemState(item, acknowledgement !== null, budgetState),
    acknowledged: acknowledgement !== null,
    acknowledgementId: acknowledgement?.id ?? null,
    note: acknowledgement?.note ?? null,
  }
}

function selectReviewItemState(
  item: NeutralComparisonItemSummaryV1,
  acknowledged: boolean,
  budgetState: string,
): ReviewItemState {
  if (item.direction === "improvement") {
    return "improvement"
  }

  if (acknowledged) {
    return "acknowledged"
  }

  return BLOCKING_BUDGET_STATES.has(budgetState) ? "blocking" : "regression"
}

function selectMaterializedSeriesReviewState(
  budgetState: string,
  primaryItem: ReviewedComparisonItemSummaryV1 | null,
): ReviewSeriesState {
  const policyState = mapBudgetStateToPolicyState(budgetState)

  if (policyState === "fail_blocking") return "blocking"
  if (policyState === "fail_non_blocking") return "regression"
  if (policyState === "warn" || policyState === "not_evaluated") return "warning"
  if (policyState === "accepted") return "acknowledged"

  return primaryItem?.reviewState ?? "neutral"
}

function selectPrimaryReviewedItem(items: ReviewedComparisonItemSummaryV1[]) {
  return [...items].sort(compareReviewedItems)[0] ?? null
}

function selectScenarioReviewState(
  seriesSummaries: ReviewedComparisonSeriesSummaryV1[],
  hasNewerFailedRun: boolean,
): ReviewSeriesState {
  const seriesReviewState =
    [...seriesSummaries].sort(compareReviewedSeriesSummaries).at(0)?.reviewState ?? "neutral"

  if (!hasNewerFailedRun) {
    return seriesReviewState
  }

  return seriesReviewState === "neutral" || seriesReviewState === "improvement"
    ? "warning"
    : seriesReviewState
}

function isReviewedScenarioImpacted(scenarioGroup: ReviewedScenarioSummaryV1) {
  return scenarioGroup.series.some((seriesSummary) => seriesSummary.reviewState !== "neutral")
}

function isReviewedScenarioUnchanged(scenarioGroup: ReviewedScenarioSummaryV1) {
  return (
    !scenarioGroup.hasNewerFailedRun &&
    scenarioGroup.series.length > 0 &&
    scenarioGroup.series.every((seriesSummary) => seriesSummary.reviewState === "neutral")
  )
}

function compareReviewedSeriesSummaries(
  left: ReviewedComparisonSeriesSummaryV1,
  right: ReviewedComparisonSeriesSummaryV1,
) {
  return (
    SERIES_REVIEW_PRIORITY[left.reviewState] - SERIES_REVIEW_PRIORITY[right.reviewState] ||
    seriesSummaryMagnitude(right) - seriesSummaryMagnitude(left) ||
    left.environment.localeCompare(right.environment) ||
    left.entrypoint.localeCompare(right.entrypoint) ||
    left.lens.localeCompare(right.lens)
  )
}

function compareReviewedItems(
  left: ReviewedComparisonItemSummaryV1,
  right: ReviewedComparisonItemSummaryV1,
) {
  return (
    ITEM_REVIEW_PRIORITY[left.reviewState] - ITEM_REVIEW_PRIORITY[right.reviewState] ||
    Math.abs(right.deltaValue) - Math.abs(left.deltaValue) ||
    left.metricKey.localeCompare(right.metricKey)
  )
}

function sortReviewedScenarioGroups(scenarioGroups: ReviewedScenarioSummaryV1[]) {
  return [...scenarioGroups].sort(
    (left, right) =>
      SERIES_REVIEW_PRIORITY[left.reviewState] - SERIES_REVIEW_PRIORITY[right.reviewState] ||
      reviewedScenarioMagnitude(right) - reviewedScenarioMagnitude(left) ||
      left.scenarioSlug.localeCompare(right.scenarioSlug),
  )
}

function reviewedScenarioMagnitude(scenarioGroup: ReviewedScenarioSummaryV1) {
  const visibleSeries = scenarioGroup.series.find(
    (seriesSummary) => seriesSummary.seriesId === scenarioGroup.visibleSeriesId,
  )

  return visibleSeries ? seriesSummaryMagnitude(visibleSeries) : 0
}

function seriesSummaryMagnitude(seriesSummary: ReviewedComparisonSeriesSummaryV1) {
  if (seriesSummary.status !== "materialized") {
    return Math.abs(seriesSummary.deltaTotals?.raw ?? 0)
  }

  const primaryItem = seriesSummary.primaryItemKey
    ? seriesSummary.items.find((item) => item.itemKey === seriesSummary.primaryItemKey)
    : null

  return Math.abs(primaryItem?.deltaValue ?? 0)
}
