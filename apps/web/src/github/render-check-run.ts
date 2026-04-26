import type { PrReviewSummaryV1, ReviewedScenarioSummaryV1 } from "@workspace/contracts"

import type { AppBindings } from "../env.js"
import { sha256Hex } from "../shared/sha256-hex.js"

import { buildPrCompareUrl, formatCount } from "./formatting.js"
import {
  collectPublicationFacts,
  collectPublicationSeries,
  describePolicyOutcome,
  describeScenarioHighlight,
} from "./render-shared.js"
import { PR_CHECK_NAME, type CheckRunPublicationPayload, type GithubCheckConclusion } from "./types.js"

export async function buildCheckRunPublicationPayload(
  env: AppBindings,
  owner: string,
  repository: string,
  pullRequestNumber: number,
  pullRequestId: string,
  summary: PrReviewSummaryV1,
): Promise<CheckRunPublicationPayload> {
  const detailsUrl = buildPrCompareUrl(
    env.PUBLIC_APP_ORIGIN,
    owner,
    repository,
    pullRequestNumber,
    {
      base: summary.baseSha,
      head: summary.headSha,
    },
  )
  const status = summary.status === "pending" ? "in_progress" : "completed"
  const conclusion = status === "completed" ? selectCheckRunConclusion(summary) : undefined
  const publicationFacts = collectPublicationFacts(summary)
  const summaryCounts = [
    publicationFacts.blockingPolicyOutcomeCount > 0
      ? formatCount(publicationFacts.blockingPolicyOutcomeCount, "blocking policy outcome")
      : null,
    publicationFacts.warningPolicyOutcomeCount > 0
      ? formatCount(publicationFacts.warningPolicyOutcomeCount, "warning policy outcome")
      : null,
    publicationFacts.acceptedPolicyDecisionCount > 0
      ? formatCount(publicationFacts.acceptedPolicyDecisionCount, "accepted policy decision")
      : null,
    summary.counts.regressionCount > 0
      ? formatCount(summary.counts.regressionCount, "regression")
      : null,
    summary.counts.acknowledgedRegressionCount > 0
      ? formatCount(summary.counts.acknowledgedRegressionCount, "acknowledged regression")
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
    publicationFacts.noPolicyOutputCount > 0
      ? formatCount(publicationFacts.noPolicyOutputCount, "output without a matching policy")
      : null,
  ].filter((value): value is string => value !== null)
  const output = {
    title: `Chunk Scope review: ${summary.overallState}`,
    summary: `${summaryCounts.join(", ") || "No blocking policy outcomes detected."}\n\n[Open hosted Review Mode](${detailsUrl})`,
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

export function selectCheckRunConclusion(summary: PrReviewSummaryV1): GithubCheckConclusion {
  const publicationFacts = collectPublicationFacts(summary)

  if (publicationFacts.blockingPolicyOutcomeCount > 0 || publicationFacts.failedMeasurementCount > 0) {
    return "failure"
  }

  if (
    publicationFacts.warningPolicyOutcomeCount > 0 ||
    publicationFacts.missingBaselineCount > 0 ||
    summary.counts.degradedComparisonCount > 0 ||
    summary.counts.inheritedScenarioCount > 0 ||
    summary.counts.pendingScenarioCount > 0
  ) {
    return "neutral"
  }

  return "success"
}

function buildCheckDetails(summary: PrReviewSummaryV1) {
  const blockingPolicyLines = collectPolicyOutcomeHighlights(summary, ["fail_blocking"])
  const warningPolicyLines = collectPolicyOutcomeHighlights(summary, [
    "fail_non_blocking",
    "not_evaluated",
    "warn",
  ])
  const acceptedPolicyLines = collectPolicyOutcomeHighlights(summary, ["accepted"])
  const blockingLines = collectScenarioHighlights(summary.scenarioGroups, "blocking")
  const regressionLines = collectScenarioHighlights(summary.scenarioGroups, "regression")
  const acknowledgedLines = collectScenarioHighlights(summary.scenarioGroups, "acknowledged")
  const warningLines = buildWarningLines(summary)
  const lines: string[] = []

  if (blockingPolicyLines.length > 0) {
    lines.push("### Blocking policy outcomes", ...blockingPolicyLines.map((line) => `- ${line}`))
  }

  if (warningPolicyLines.length > 0) {
    if (lines.length > 0) {
      lines.push("")
    }

    lines.push("### Warning policy outcomes", ...warningPolicyLines.map((line) => `- ${line}`))
  }

  if (acceptedPolicyLines.length > 0) {
    if (lines.length > 0) {
      lines.push("")
    }

    lines.push("### Accepted policy decisions", ...acceptedPolicyLines.map((line) => `- ${line}`))
  }

  if (blockingLines.length > 0) {
    if (lines.length > 0) {
      lines.push("")
    }

    lines.push("### Blocking regressions", ...blockingLines.map((line) => `- ${line}`))
  }

  if (regressionLines.length > 0) {
    if (lines.length > 0) {
      lines.push("")
    }

    lines.push("### Regressions", ...regressionLines.map((line) => `- ${line}`))
  }

  if (acknowledgedLines.length > 0) {
    if (lines.length > 0) {
      lines.push("")
    }

    lines.push("### Acknowledged regressions", ...acknowledgedLines.map((line) => `- ${line}`))
  }

  if (warningLines.length > 0) {
    if (lines.length > 0) {
      lines.push("")
    }

    lines.push("### Warnings", ...warningLines.map((line) => `- ${line}`))
  }

  return lines.join("\n")
}

function collectPolicyOutcomeHighlights(
  summary: PrReviewSummaryV1,
  policyStates: Array<ReturnType<typeof collectPublicationSeries>[number]["policyState"]>,
) {
  const selectedStates = new Set(policyStates)

  return collectPublicationSeries(summary)
    .filter((row) => selectedStates.has(row.policyState))
    .slice(0, 10)
    .map((row) => {
      const subject = `${row.scenarioGroup.scenarioSlug}: ${row.seriesSummary.environment} / ${row.seriesSummary.entrypoint} / ${row.seriesSummary.lens}`
      return `${subject} (${describePolicyOutcome(row.policyState)})`
    })
}

function collectScenarioHighlights(
  scenarioGroups: readonly ReviewedScenarioSummaryV1[],
  reviewState: ReviewedScenarioSummaryV1["reviewState"],
) {
  return scenarioGroups
    .filter((scenarioGroup) => scenarioGroup.reviewState === reviewState)
    .slice(0, 10)
    .map((scenarioGroup) => describeScenarioHighlight(scenarioGroup))
}

function buildWarningLines(summary: PrReviewSummaryV1) {
  const warningLines = [
    summary.counts.pendingScenarioCount > 0
      ? `${summary.counts.pendingScenarioCount} scenarios are still pending.`
      : null,
    summary.counts.inheritedScenarioCount > 0
      ? `${summary.counts.inheritedScenarioCount} scenarios were inherited.`
      : null,
    summary.counts.missingScenarioCount > 0
      ? `${summary.counts.missingScenarioCount} scenarios are missing.`
      : null,
    summary.counts.failedScenarioCount > 0
      ? `${summary.counts.failedScenarioCount} scenarios have failed runs.`
      : null,
    summary.counts.degradedComparisonCount > 0
      ? `${summary.counts.degradedComparisonCount} comparisons have degraded identity.`
      : null,
  ].filter((value): value is string => value !== null)
  const warningScenarios = summary.scenarioGroups
    .filter((scenarioGroup) => scenarioGroup.reviewState === "warning")
    .slice(0, 5)
    .map((scenarioGroup) => describeScenarioHighlight(scenarioGroup))

  return [...warningLines, ...warningScenarios]
}
