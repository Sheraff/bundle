import type {
  CommitGroupStatusScenarioSummaryV1,
  ReviewedComparisonSeriesSummaryV1,
  ReviewSeriesState,
} from '@workspace/contracts'

import { formatBytes, formatSignedBytes, formatSignedPercentage, shortSha } from './formatting.js'

export function formatSeriesLabel(series: {
  environment: string
  entrypoint: string
  lens: string
}) {
  return `${series.environment} / ${series.entrypoint} / ${series.lens}`
}

export function formatStateBadge(state: string) {
  return `[${state}]`
}

export function describeStatusScenarioDetail(scenario: CommitGroupStatusScenarioSummaryV1) {
  if (scenario.state === 'missing') {
    return scenario.reason
  }

  if (scenario.state === 'failed') {
    return scenario.failureMessage ?? 'Scenario rerun failed.'
  }

  return `Inherited from ${shortSha(scenario.sourceCommitSha)}`
}

export function describeNeutralDelta(
  series: {
    status: string
    currentTotals: { brotli: number }
    baselineTotals: { brotli: number } | null
    failureMessage?: string
  },
  primaryItem: {
    deltaValue: number
    percentageDelta: number
  } | null,
  options?: {
    detailed?: boolean
    unchangedPrefix?: string
    noBaselineText?: string
    failedPrefix?: string
  },
) {
  const detailed = options?.detailed ?? false

  if (series.status === 'failed') {
    return `${options?.failedPrefix ?? 'Failed'}: ${series.failureMessage ?? 'Comparison materialization failed.'}`
  }

  if (series.status === 'no-baseline' || !series.baselineTotals) {
    return options?.noBaselineText ?? 'No baseline'
  }

  if (!primaryItem) {
    const unchangedValue = formatBytes(series.currentTotals.brotli)
    return detailed
      ? `${options?.unchangedPrefix ?? 'Brotli total unchanged at'} ${unchangedValue}.`
      : `${options?.unchangedPrefix ?? 'Unchanged at'} ${unchangedValue}`
  }

  if (detailed) {
    return `${formatBytes(series.currentTotals.brotli)} vs ${formatBytes(series.baselineTotals.brotli)} (${formatSignedBytes(primaryItem.deltaValue)}, ${formatSignedPercentage(primaryItem.percentageDelta)})`
  }

  return `${formatSignedBytes(primaryItem.deltaValue)} (${formatSignedPercentage(primaryItem.percentageDelta)})`
}

export function describeReviewedDelta(
  series: {
    status: string
    currentTotals: { brotli: number }
    baselineTotals: { brotli: number } | null
    failureMessage?: string
  },
  primaryItem: {
    deltaValue: number
    percentageDelta: number
    reviewState?: string
  } | null,
) {
  const summary = describeNeutralDelta(series, primaryItem, {
    noBaselineText: 'No baseline',
  })

  return primaryItem?.reviewState ? `${summary} ${primaryItem.reviewState}` : summary
}

export function describeScenarioReviewState(reviewState: ReviewSeriesState) {
  return formatStateBadge(reviewState)
}

export function describeReviewedSeriesState(series: ReviewedComparisonSeriesSummaryV1) {
  return formatStateBadge(series.reviewState)
}
