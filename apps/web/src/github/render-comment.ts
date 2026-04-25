import type { PrReviewSummaryV1, ReviewedScenarioSummaryV1 } from "@workspace/contracts"

import type { AppBindings } from "../env.js"
import { sha256Hex } from "../shared/sha256-hex.js"

import {
  buildPrCompareUrl,
  formatBytes,
  formatCount,
  formatSignedBytes,
  formatSignedPercentage,
} from "./formatting.js"
import { formatScenarioBadge, selectPrimaryItem, selectVisibleSeries } from "./render-shared.js"
import type { CommentPublicationPayload } from "./types.js"

export async function buildCommentPublicationPayload(
  env: AppBindings,
  owner: string,
  repository: string,
  pullRequestNumber: number,
  pullRequestId: string,
  summary: PrReviewSummaryV1,
): Promise<CommentPublicationPayload> {
  const marker = `<!-- bundle-review:pr:${pullRequestId} -->`
  const openPrDiffUrl = buildPrCompareUrl(
    env.PUBLIC_APP_ORIGIN,
    owner,
    repository,
    pullRequestNumber,
    {
      base: summary.baseSha,
      head: summary.headSha,
    },
  )
  const visibleScenarioGroups = summary.scenarioGroups.filter(
    (scenarioGroup) => scenarioGroup.reviewState !== "neutral",
  )
  const headerCounts = [
    summary.counts.blockingRegressionCount > 0
      ? formatCount(summary.counts.blockingRegressionCount, "blocking regression")
      : null,
    summary.counts.regressionCount > 0
      ? formatCount(summary.counts.regressionCount, "regression")
      : null,
    summary.counts.acknowledgedRegressionCount > 0
      ? formatCount(summary.counts.acknowledgedRegressionCount, "acknowledged regression")
      : null,
    summary.counts.improvementCount > 0
      ? formatCount(summary.counts.improvementCount, "improvement")
      : null,
    summary.counts.pendingScenarioCount > 0
      ? formatCount(summary.counts.pendingScenarioCount, "pending scenario")
      : null,
    summary.counts.inheritedScenarioCount > 0
      ? formatCount(summary.counts.inheritedScenarioCount, "inherited scenario")
      : null,
    summary.counts.missingScenarioCount > 0
      ? formatCount(summary.counts.missingScenarioCount, "missing scenario")
      : null,
    summary.counts.failedScenarioCount > 0
      ? formatCount(summary.counts.failedScenarioCount, "failed scenario")
      : null,
  ].filter((value): value is string => value !== null)
  const lines = [
    `Chunk Scope review: ${summary.overallState}`,
    headerCounts.join("  ") || "No changes detected",
    `[Open PR diff](${openPrDiffUrl})`,
  ]

  for (const scenarioGroup of visibleScenarioGroups) {
    lines.push(
      "",
      ...renderCommentScenarioGroup(
        env,
        owner,
        repository,
        pullRequestNumber,
        summary,
        scenarioGroup,
      ),
    )
  }

  if (summary.counts.unchangedScenarioCount > 0) {
    lines.push("", `${summary.counts.unchangedScenarioCount} unchanged scenarios omitted`)
  }

  lines.push("", marker)

  const body = `${lines.join("\n")}\n`
  return {
    body,
    marker,
    payloadHash: await sha256Hex(body),
  }
}

function renderCommentScenarioGroup(
  env: AppBindings,
  owner: string,
  repository: string,
  pullRequestNumber: number,
  summary: PrReviewSummaryV1,
  scenarioGroup: ReviewedScenarioSummaryV1,
) {
  const visibleSeries = selectVisibleSeries(scenarioGroup)
  const badges = [formatScenarioBadge(scenarioGroup.reviewState)]

  if (scenarioGroup.additionalChangedSeriesCount > 0) {
    badges.push(`+${scenarioGroup.additionalChangedSeriesCount} more changed series`)
  }

  if (scenarioGroup.acknowledgedItemCount > 0 && scenarioGroup.reviewState !== "acknowledged") {
    badges.push(`${scenarioGroup.acknowledgedItemCount} acknowledged`)
  }

  const lines = [
    `${scenarioGroup.scenarioSlug}${badges.length > 0 ? `  ${badges.map((badge) => `[${badge}]`).join(" ")}` : ""}`,
  ]

  if (!visibleSeries) {
    if (scenarioGroup.hasNewerFailedRun) {
      lines.push(
        `Latest rerun failed${scenarioGroup.latestFailureMessage ? `: ${scenarioGroup.latestFailureMessage}` : "."}`,
      )
    }

    return lines
  }

  lines.push(`${visibleSeries.environment} / ${visibleSeries.entrypoint} / ${visibleSeries.lens}`)
  const primaryItem = selectPrimaryItem(visibleSeries)

  if (primaryItem) {
    lines.push(
      `${formatBytes(primaryItem.currentValue)} vs ${formatBytes(primaryItem.baselineValue)}  (${formatSignedBytes(primaryItem.deltaValue)}, ${formatSignedPercentage(primaryItem.percentageDelta)})${primaryItem.acknowledged ? "  [Acknowledged]" : ""}`,
    )
  } else if (visibleSeries.status === "no-baseline") {
    lines.push("No baseline available for this series yet.")
  } else if (visibleSeries.status === "failed") {
    lines.push(`Comparison failed: ${visibleSeries.failureMessage}`)
  }

  if (scenarioGroup.hasNewerFailedRun) {
    lines.push(
      `Latest rerun failed${scenarioGroup.latestFailureMessage ? `: ${scenarioGroup.latestFailureMessage}` : "."}`,
    )
  }

  if (primaryItem?.note && primaryItem.note.length <= 140) {
    lines.push(`Note: ${primaryItem.note}`)
  }

  lines.push(
    `[View diff](${buildPrCompareUrl(env.PUBLIC_APP_ORIGIN, owner, repository, pullRequestNumber, {
      base: summary.baseSha,
      head: summary.headSha,
      scenario: scenarioGroup.scenarioSlug,
      env: visibleSeries.environment,
      entrypoint: visibleSeries.entrypoint,
      lens: visibleSeries.lens,
    })})`,
  )

  return lines
}
