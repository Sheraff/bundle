import type {
  PolicyState,
  PrReviewSummaryV1,
  ReviewedComparisonSeriesSummaryV1,
  ReviewedScenarioSummaryV1,
} from "@workspace/contracts"

import { isWarningPolicyState, mapBudgetStateToPolicyState, policyStateLabel } from "../lib/policy-state.js"

import { formatSignedBytes, formatSignedPercentage } from "./formatting.js"

export type PublicationScenarioSeries = {
  policyState: PolicyState
  scenarioGroup: ReviewedScenarioSummaryV1
  seriesSummary: ReviewedComparisonSeriesSummaryV1
}

export type PublicationFacts = {
  acceptedPolicyDecisionCount: number
  blockingPolicyOutcomeCount: number
  failedMeasurementCount: number
  missingBaselineCount: number
  noPolicyOutputCount: number
  notEvaluatedPolicyOutcomeCount: number
  warningPolicyOutcomeCount: number
}

export function collectPublicationFacts(summary: PrReviewSummaryV1): PublicationFacts {
  const series = collectPublicationSeries(summary)

  return {
    acceptedPolicyDecisionCount: series.filter((row) => row.policyState === "accepted").length,
    blockingPolicyOutcomeCount: series.filter((row) => row.policyState === "fail_blocking").length,
    failedMeasurementCount: summary.counts.failedScenarioCount + summary.counts.failedComparisonCount,
    missingBaselineCount: summary.counts.noBaselineSeriesCount + summary.counts.missingScenarioCount,
    noPolicyOutputCount: series.filter((row) => row.policyState === "not_configured").length,
    notEvaluatedPolicyOutcomeCount: series.filter((row) => row.policyState === "not_evaluated").length,
    warningPolicyOutcomeCount: series.filter((row) => isWarningPolicyState(row.policyState)).length,
  }
}

export function collectPublicationSeries(summary: PrReviewSummaryV1): PublicationScenarioSeries[] {
  return summary.scenarioGroups.flatMap((scenarioGroup) =>
    scenarioGroup.series.map((seriesSummary) => ({
      policyState: mapBudgetStateToPolicyState(seriesSummary.budgetState),
      scenarioGroup,
      seriesSummary,
    })),
  )
}

export function describePolicyOutcome(policyState: PolicyState) {
  return policyStateLabel(policyState)
}

export function selectVisibleSeries(scenarioGroup: ReviewedScenarioSummaryV1) {
  return (
    scenarioGroup.series.find(
      (seriesSummary) => seriesSummary.seriesId === scenarioGroup.visibleSeriesId,
    ) ??
    scenarioGroup.series.find((seriesSummary) => seriesSummary.reviewState !== "neutral") ??
    null
  )
}

export function selectPrimaryItem(seriesSummary: ReviewedComparisonSeriesSummaryV1) {
  if (seriesSummary.status !== "materialized") {
    return null
  }

  return (
    seriesSummary.items.find((item) => item.itemKey === seriesSummary.primaryItemKey) ??
    seriesSummary.items[0] ??
    null
  )
}

export function formatScenarioBadge(reviewState: ReviewedScenarioSummaryV1["reviewState"]) {
  switch (reviewState) {
    case "blocking":
      return "blocking"
    case "acknowledged":
      return "acknowledged"
    case "improvement":
      return "improved"
    case "warning":
      return "warning"
    case "regression":
      return "regression"
    default:
      return "neutral"
  }
}

export function describeScenarioHighlight(scenarioGroup: ReviewedScenarioSummaryV1) {
  const visibleSeries = selectVisibleSeries(scenarioGroup)

  if (!visibleSeries) {
    return `${scenarioGroup.scenarioSlug}: latest rerun failed${scenarioGroup.latestFailureMessage ? ` (${scenarioGroup.latestFailureMessage})` : ""}`
  }

  const subject = `${scenarioGroup.scenarioSlug}: ${visibleSeries.environment} / ${visibleSeries.entrypoint} / ${visibleSeries.lens}`
  const primaryItem = selectPrimaryItem(visibleSeries)

  const policyState = mapBudgetStateToPolicyState(visibleSeries.budgetState)
  const policySuffix = policyState === "not_configured" || policyState === "pass"
    ? ""
    : `; ${describePolicyOutcome(policyState)}`

  if (primaryItem) {
    return `${subject} [${primaryItem.metricKey}] ${formatSignedBytes(primaryItem.deltaValue)} (${formatSignedPercentage(primaryItem.percentageDelta)})${policySuffix}`
  }

  if (visibleSeries.status === "no-baseline") {
    return `${subject} (no baseline)${policySuffix}`
  }

  return `${subject} (comparison failed)${policySuffix}`
}
