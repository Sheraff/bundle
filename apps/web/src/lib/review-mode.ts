import type {
  MeasurementState,
  PolicyState,
  PrReviewSummaryV1,
  ReviewSeriesState,
} from "@workspace/contracts"

import type { ReviewOutputRow } from "./public-read-models.server.js"

export type ReviewVerdictState =
  | "summary_unavailable"
  | "pending"
  | "measurement_failed"
  | "incomplete"
  | "missing_baseline"
  | "blocked_policy"
  | "partial"
  | "needs_decision"
  | "no_policy"
  | "pass"

export type ReviewVerdictRow = Pick<ReviewOutputRow, "measurementState" | "policyState" | "reviewState">

export type ReviewVerdictInput = {
  latestReviewSummary: Pick<PrReviewSummaryV1, "counts" | "status"> | null
  reviewOutputRows: ReviewVerdictRow[]
  statusScenarios: Array<{ state: "inherited" | "missing" | "failed" }>
}

export type ReviewVerdict = {
  description: string
  measurementState: MeasurementState
  policyState: PolicyState
  reasons: string[]
  state: ReviewVerdictState
  title: string
}

export function reviewVerdict(data: ReviewVerdictInput): ReviewVerdict {
  const rows = data.reviewOutputRows
  const hasSummaryUnavailable = data.latestReviewSummary === null
  const hasPending = data.latestReviewSummary?.status === "pending" || (data.latestReviewSummary?.counts.pendingScenarioCount ?? 0) > 0
  const hasMeasurementFailure = data.statusScenarios.some((scenario) => scenario.state === "failed") || rows.some((row) => row.measurementState === "failed")
  const hasIncomplete = rows.some((row) => row.measurementState === "incomplete")
  const hasMissingBaseline = data.latestReviewSummary?.counts.noBaselineSeriesCount ? data.latestReviewSummary.counts.noBaselineSeriesCount > 0 : rows.some((row) => row.measurementState === "missing_baseline")
  const hasPartial = data.statusScenarios.some((scenario) => scenario.state === "inherited" || scenario.state === "missing") || (data.latestReviewSummary?.counts.inheritedScenarioCount ?? 0) > 0 || (data.latestReviewSummary?.counts.missingScenarioCount ?? 0) > 0
  const hasBlockedPolicy = rows.some((row) => row.policyState === "fail_blocking")
  const hasWarningPolicy = rows.some((row) => row.policyState === "fail_non_blocking" || row.policyState === "not_evaluated" || row.policyState === "warn")
  const hasAcceptedPolicy = rows.some((row) => row.policyState === "accepted")
  const needsDecision = rows.some((row) => row.reviewState === "blocking" || row.reviewState === "regression")
  const hasNoPolicy = rows.length > 0 && rows.every((row) => row.policyState === "not_configured")
  const policyState = rows.length === 0
    ? "not_evaluated"
    : hasBlockedPolicy
      ? "fail_blocking"
      : hasNoPolicy
        ? "not_configured"
        : hasWarningPolicy
          ? "warn"
          : hasAcceptedPolicy
            ? "accepted"
            : "pass"
  const reasons = reviewReasons(data, {
    hasBlockedPolicy,
    hasIncomplete,
    hasMeasurementFailure,
    hasMissingBaseline,
    hasNoPolicy,
    hasPartial,
    hasPending,
    hasSummaryUnavailable,
    needsDecision,
  })

  if (hasSummaryUnavailable) {
    return {
      description: "No PR review summary matched this base/head context, so Review Mode cannot report a verdict yet.",
      measurementState: "incomplete",
      policyState,
      reasons,
      state: "summary_unavailable",
      title: "Review summary unavailable",
    }
  }

  if (hasPending) {
    return {
      description: "Scenario processing is still in flight for this PR. Review Mode cannot treat incomplete uploads as a pass.",
      measurementState: "pending",
      policyState,
      reasons,
      state: "pending",
      title: "Review pending",
    }
  }

  if (hasMeasurementFailure) {
    return {
      description: "At least one scenario measurement failed. Review cannot treat missing evidence as success.",
      measurementState: "failed",
      policyState,
      reasons,
      state: "measurement_failed",
      title: "Measurement failed",
    }
  }

  if (hasIncomplete) {
    return {
      description: "At least one output has incomplete measurement data.",
      measurementState: "incomplete",
      policyState,
      reasons,
      state: "incomplete",
      title: "Incomplete measurements",
    }
  }

  if (hasMissingBaseline) {
    return {
      description: "At least one output has no baseline, so the review needs a human interpretation.",
      measurementState: "missing_baseline",
      policyState,
      reasons,
      state: "missing_baseline",
      title: "Missing baseline",
    }
  }

  if (hasBlockedPolicy) {
    return {
      description: "A configured policy reports a blocking failure.",
      measurementState: "complete",
      policyState,
      reasons,
      state: "blocked_policy",
      title: "Blocked by policy",
    }
  }

  if (hasPartial) {
    return {
      description: "This PR settled with inherited or missing scenarios. Those gaps stay explicit and do not count as a passing review.",
      measurementState: "incomplete",
      policyState,
      reasons,
      state: "partial",
      title: "Partial review",
    }
  }

  if (needsDecision) {
    return {
      description: "Bundle bytes changed and need review. This is advisory unless a real policy is configured.",
      measurementState: "complete",
      policyState,
      reasons,
      state: "needs_decision",
      title: "Needs review",
    }
  }

  if (hasNoPolicy) {
    return {
      description: "Measurements are complete, but no policy is configured for these outputs.",
      measurementState: "complete",
      policyState,
      reasons,
      state: "no_policy",
      title: "No policy configured",
    }
  }

  return {
    description: "Measurements are complete and no configured policy blocks this review.",
    measurementState: "complete",
    policyState,
    reasons,
    state: "pass",
    title: "Review passes",
  }
}

export function shouldExpandReviewScenarioGroup(reviewState: ReviewSeriesState) {
  return reviewState === "blocking" || reviewState === "regression"
}

export function canOpenReviewEvidence(row: Pick<ReviewOutputRow, "evidenceAvailability">) {
  return row.evidenceAvailability.selectedDetailAvailable && row.evidenceAvailability.treemapFrameAvailable
}

export function reviewEvidenceUnavailableReason(row: Pick<ReviewOutputRow, "evidenceAvailability">) {
  if (canOpenReviewEvidence(row)) return null
  return row.evidenceAvailability.unavailableReason ?? "Evidence is unavailable for this output."
}

function reviewReasons(
  data: ReviewVerdictInput,
  flags: {
      hasBlockedPolicy: boolean
      hasIncomplete: boolean
      hasMeasurementFailure: boolean
      hasMissingBaseline: boolean
      hasNoPolicy: boolean
      hasPartial: boolean
      hasPending: boolean
      hasSummaryUnavailable: boolean
      needsDecision: boolean
    },
) {
  const counts = data.latestReviewSummary?.counts
  const reasons = [
    counts ? `${counts.regressionCount} regressions, ${counts.improvementCount} improvements, ${counts.acknowledgedRegressionCount} acknowledged regressions.` : null,
    flags.hasSummaryUnavailable ? "No PR review summary matched this base/head context." : null,
    flags.hasPending ? "Scenario processing is still pending for this PR." : null,
    flags.hasMeasurementFailure ? "A failed measurement is present." : null,
    flags.hasIncomplete ? "An incomplete measurement is present." : null,
    flags.hasMissingBaseline ? "At least one output is missing a baseline." : null,
    flags.hasBlockedPolicy ? "A real configured policy is blocking this review." : null,
    flags.hasPartial ? "At least one scenario is inherited or missing, so this review remains partial." : null,
    flags.needsDecision ? "Changed outputs need human review because policy enforcement is not configured." : null,
    flags.hasNoPolicy ? "Policy state is not_configured, so this surface must not imply enforcement." : null,
  ].filter((reason): reason is string => reason !== null)

  return reasons.length > 0 ? reasons : ["No review rows matched this context."]
}
