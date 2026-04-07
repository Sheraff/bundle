import type { PrReviewSummaryV1, ReviewedScenarioSummaryV1 } from '@workspace/contracts'

import type { AppBindings } from '../env.js'
import { sha256Hex } from '../shared/sha256-hex.js'

import { buildPrCompareUrl, formatCount } from './formatting.js'
import { describeScenarioHighlight } from './render-shared.js'
import { PR_CHECK_NAME, type CheckRunPublicationPayload } from './types.js'

export async function buildCheckRunPublicationPayload(
  env: AppBindings,
  owner: string,
  repository: string,
  pullRequestNumber: number,
  pullRequestId: string,
  summary: PrReviewSummaryV1,
): Promise<CheckRunPublicationPayload> {
  const detailsUrl = buildPrCompareUrl(env.PUBLIC_APP_ORIGIN, owner, repository, pullRequestNumber, {
    base: summary.baseSha,
    head: summary.headSha,
  })
  const status = summary.status === 'pending' ? 'in_progress' : 'completed'
  const conclusion =
    status === 'completed'
      ? summary.counts.blockingRegressionCount > 0
        ? 'failure'
        : 'success'
      : undefined
  const summaryCounts = [
    summary.counts.blockingRegressionCount > 0
      ? formatCount(summary.counts.blockingRegressionCount, 'blocking regression')
      : null,
    summary.counts.regressionCount > 0 ? formatCount(summary.counts.regressionCount, 'regression') : null,
    summary.counts.acknowledgedRegressionCount > 0
      ? formatCount(summary.counts.acknowledgedRegressionCount, 'acknowledged regression')
      : null,
    summary.counts.pendingScenarioCount > 0
      ? formatCount(summary.counts.pendingScenarioCount, 'pending scenario')
      : null,
    summary.counts.inheritedScenarioCount > 0
      ? formatCount(summary.counts.inheritedScenarioCount, 'inherited scenario')
      : null,
    summary.counts.missingScenarioCount > 0
      ? formatCount(summary.counts.missingScenarioCount, 'missing scenario')
      : null,
  ].filter((value): value is string => value !== null)
  const output = {
    title: `Bundle review: ${summary.overallState}`,
    summary: `${summaryCounts.join(', ') || 'No blocking regressions detected.'}\n\n[Open PR diff](${detailsUrl})`,
    text: buildCheckDetails(summary),
  }

  return {
    ...(conclusion ? { conclusion } : {}),
    detailsUrl,
    externalId: pullRequestId,
    headSha: summary.headSha,
    name: PR_CHECK_NAME,
    output,
    payloadHash: await sha256Hex(
      JSON.stringify({ detailsUrl, output, status, conclusion, headSha: summary.headSha }),
    ),
    status,
  }
}

function buildCheckDetails(summary: PrReviewSummaryV1) {
  const blockingLines = collectScenarioHighlights(summary.scenarioGroups, 'blocking')
  const regressionLines = collectScenarioHighlights(summary.scenarioGroups, 'regression')
  const acknowledgedLines = collectScenarioHighlights(summary.scenarioGroups, 'acknowledged')
  const warningLines = buildWarningLines(summary)
  const lines: string[] = []

  if (blockingLines.length > 0) {
    lines.push('### Blocking regressions', ...blockingLines.map((line) => `- ${line}`))
  }

  if (regressionLines.length > 0) {
    if (lines.length > 0) {
      lines.push('')
    }

    lines.push('### Regressions', ...regressionLines.map((line) => `- ${line}`))
  }

  if (acknowledgedLines.length > 0) {
    if (lines.length > 0) {
      lines.push('')
    }

    lines.push('### Acknowledged regressions', ...acknowledgedLines.map((line) => `- ${line}`))
  }

  if (warningLines.length > 0) {
    if (lines.length > 0) {
      lines.push('')
    }

    lines.push('### Warnings', ...warningLines.map((line) => `- ${line}`))
  }

  return lines.join('\n')
}

function collectScenarioHighlights(
  scenarioGroups: readonly ReviewedScenarioSummaryV1[],
  reviewState: ReviewedScenarioSummaryV1['reviewState'],
) {
  return scenarioGroups
    .filter((scenarioGroup) => scenarioGroup.reviewState === reviewState)
    .slice(0, 10)
    .map((scenarioGroup) => describeScenarioHighlight(scenarioGroup))
}

function buildWarningLines(summary: PrReviewSummaryV1) {
  const warningLines = [
    summary.counts.pendingScenarioCount > 0 ? `${summary.counts.pendingScenarioCount} scenarios are still pending.` : null,
    summary.counts.inheritedScenarioCount > 0 ? `${summary.counts.inheritedScenarioCount} scenarios were inherited.` : null,
    summary.counts.missingScenarioCount > 0 ? `${summary.counts.missingScenarioCount} scenarios are missing.` : null,
    summary.counts.failedScenarioCount > 0 ? `${summary.counts.failedScenarioCount} scenarios have failed runs.` : null,
    summary.counts.degradedComparisonCount > 0
      ? `${summary.counts.degradedComparisonCount} comparisons have degraded identity.`
      : null,
  ].filter((value): value is string => value !== null)
  const warningScenarios = summary.scenarioGroups
    .filter((scenarioGroup) => scenarioGroup.reviewState === 'warning')
    .slice(0, 5)
    .map((scenarioGroup) => describeScenarioHighlight(scenarioGroup))

  return [...warningLines, ...warningScenarios]
}
