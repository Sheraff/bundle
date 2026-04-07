import type {
  ReviewedComparisonItemSummaryV1,
  ReviewedComparisonSeriesSummaryV1,
  ReviewedScenarioSummaryV1,
} from '@workspace/contracts'

import {
  formatSignedBytes,
  formatSignedPercentage,
} from './formatting.js'

export function selectVisibleSeries(scenarioGroup: ReviewedScenarioSummaryV1) {
  return (
    scenarioGroup.series.find((seriesSummary) => seriesSummary.seriesId === scenarioGroup.visibleSeriesId) ??
    scenarioGroup.series.find((seriesSummary) => seriesSummary.reviewState !== 'neutral') ??
    null
  )
}

export function selectPrimaryItem(seriesSummary: ReviewedComparisonSeriesSummaryV1) {
  if (seriesSummary.status !== 'materialized') {
    return null
  }

  return (
    seriesSummary.items.find((item) => item.itemKey === seriesSummary.primaryItemKey) ??
    seriesSummary.items[0] ??
    null
  )
}

export function formatScenarioBadge(reviewState: ReviewedScenarioSummaryV1['reviewState']) {
  switch (reviewState) {
    case 'blocking':
      return 'blocking'
    case 'acknowledged':
      return 'acknowledged'
    case 'improvement':
      return 'improved'
    case 'warning':
      return 'warning'
    case 'regression':
      return 'regression'
    default:
      return 'neutral'
  }
}

export function describeScenarioHighlight(scenarioGroup: ReviewedScenarioSummaryV1) {
  const visibleSeries = selectVisibleSeries(scenarioGroup)

  if (!visibleSeries) {
    return `${scenarioGroup.scenarioSlug}: latest rerun failed${scenarioGroup.latestFailureMessage ? ` (${scenarioGroup.latestFailureMessage})` : ''}`
  }

  const subject = `${scenarioGroup.scenarioSlug}: ${visibleSeries.environment} / ${visibleSeries.entrypoint} / ${visibleSeries.lens}`
  const primaryItem = selectPrimaryItem(visibleSeries)

  if (primaryItem) {
    return `${subject} [${primaryItem.metricKey}] ${formatSignedBytes(primaryItem.deltaValue)} (${formatSignedPercentage(primaryItem.percentageDelta)})`
  }

  if (visibleSeries.status === 'no-baseline') {
    return `${subject} (no baseline)`
  }

  return `${subject} (comparison failed)`
}
