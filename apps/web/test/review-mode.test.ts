import type { PrReviewSummaryCountsV1 } from "@workspace/contracts"
import { describe, expect, it } from "vitest"

import {
  canOpenReviewEvidence,
  reviewEvidenceUnavailableReason,
  reviewVerdict,
  shouldExpandReviewScenarioGroup,
  type ReviewVerdictInput,
  type ReviewVerdictRow,
} from "../src/lib/review-mode.js"

describe("review mode helpers", () => {
  it("applies deterministic verdict precedence", () => {
    expect(reviewVerdict(input({ latestReviewSummary: null, rows: [] })).state).toBe("summary_unavailable")
    expect(reviewVerdict(input({ rows: [row({ policyState: "fail_blocking" })], summaryStatus: "pending" })).state).toBe("pending")
    expect(reviewVerdict(input({ statusScenarios: [{ state: "failed" }], rows: [row({ policyState: "fail_blocking" })] })).state).toBe("measurement_failed")
    expect(reviewVerdict(input({ rows: [row({ measurementState: "incomplete", policyState: "fail_blocking" })] })).state).toBe("incomplete")
    expect(reviewVerdict(input({ counts: counts({ noBaselineSeriesCount: 1 }), rows: [row({ policyState: "fail_blocking" })] })).state).toBe("missing_baseline")
    expect(reviewVerdict(input({ rows: [row({ policyState: "fail_blocking" })] })).state).toBe("blocked_policy")
    expect(reviewVerdict(input({ counts: counts({ missingScenarioCount: 1 }), rows: [row({ policyState: "pass" })], statusScenarios: [{ state: "missing" }] })).state).toBe("partial")
    expect(reviewVerdict(input({ counts: counts({ regressionCount: 1 }), rows: [row({ reviewState: "regression" })] })).state).toBe("needs_decision")
    expect(reviewVerdict(input({ rows: [row()] })).state).toBe("no_policy")
    expect(reviewVerdict(input({ rows: [row({ policyState: "pass" })] })).state).toBe("pass")
  })

  it("keeps non-passing PR states explicit", () => {
    const unavailable = reviewVerdict(input({ latestReviewSummary: null, rows: [] }))
    const pending = reviewVerdict(input({ rows: [row({ policyState: "pass" })], summaryStatus: "pending" }))
    const partial = reviewVerdict(input({ counts: counts({ inheritedScenarioCount: 1 }), rows: [row({ policyState: "pass" })], statusScenarios: [{ state: "inherited" }] }))

    expect(unavailable.title).toBe("Review summary unavailable")
    expect(unavailable.policyState).toBe("not_evaluated")
    expect(pending.title).toBe("Review pending")
    expect(pending.measurementState).toBe("pending")
    expect(partial.title).toBe("Partial review")
    expect(partial.reasons).toContain("At least one scenario is inherited or missing, so this review remains partial.")
  })

  it("does not synthesize policy blocking before policy exists", () => {
    const verdict = reviewVerdict(input({
      counts: counts({ regressionCount: 1 }),
      rows: [row({ policyState: "not_configured", reviewState: "regression" })],
    }))

    expect(verdict.state).toBe("needs_decision")
    expect(verdict.policyState).toBe("not_configured")
    expect(verdict.title).not.toBe("Blocked by policy")
    expect(verdict.reasons).toContain("Policy state is not_configured, so this surface must not imply enforcement.")
  })

  it("keeps only top risk scenario groups expanded by default", () => {
    expect(shouldExpandReviewScenarioGroup("blocking")).toBe(true)
    expect(shouldExpandReviewScenarioGroup("regression")).toBe(true)
    expect(shouldExpandReviewScenarioGroup("acknowledged")).toBe(false)
    expect(shouldExpandReviewScenarioGroup("improvement")).toBe(false)
    expect(shouldExpandReviewScenarioGroup("warning")).toBe(false)
    expect(shouldExpandReviewScenarioGroup("neutral")).toBe(false)
  })

  it("blocks evidence links when selected evidence is unavailable", () => {
    const unavailable = {
      evidenceAvailability: {
        comparisonDetailAvailable: false,
        graphDetailAvailable: false,
        selectedDetailAvailable: false,
        snapshotDetailAvailable: false,
        state: "missing" as const,
        treemapFrameAvailable: false,
        unavailableReason: "No comparable snapshot exists.",
        waterfallDetailAvailable: false,
      },
    }
    const available = {
      evidenceAvailability: {
        ...unavailable.evidenceAvailability,
        comparisonDetailAvailable: true,
        graphDetailAvailable: true,
        selectedDetailAvailable: true,
        snapshotDetailAvailable: true,
        state: "available" as const,
        treemapFrameAvailable: true,
        unavailableReason: null,
        waterfallDetailAvailable: true,
      },
    }

    expect(canOpenReviewEvidence(unavailable)).toBe(false)
    expect(reviewEvidenceUnavailableReason(unavailable)).toBe("No comparable snapshot exists.")
    expect(canOpenReviewEvidence(available)).toBe(true)
    expect(reviewEvidenceUnavailableReason(available)).toBeNull()
  })
})

function input(props: {
  counts?: PrReviewSummaryCountsV1
  latestReviewSummary?: ReviewVerdictInput["latestReviewSummary"]
  rows: ReviewVerdictRow[]
  summaryStatus?: "pending" | "settled"
  statusScenarios?: ReviewVerdictInput["statusScenarios"]
}): ReviewVerdictInput {
  return {
    latestReviewSummary: props.latestReviewSummary === undefined
      ? { counts: props.counts ?? counts(), status: props.summaryStatus ?? "settled" }
      : props.latestReviewSummary,
    reviewOutputRows: props.rows,
    statusScenarios: props.statusScenarios ?? [],
  }
}

function row(overrides: Partial<ReviewVerdictRow> = {}): ReviewVerdictRow {
  return {
    measurementState: "complete",
    policyState: "not_configured",
    reviewState: "neutral",
    ...overrides,
  }
}

function counts(overrides: Partial<PrReviewSummaryCountsV1> = {}): PrReviewSummaryCountsV1 {
  return {
    acknowledgedRegressionCount: 0,
    blockingRegressionCount: 0,
    degradedComparisonCount: 0,
    failedComparisonCount: 0,
    failedScenarioCount: 0,
    impactedScenarioCount: 0,
    improvementCount: 0,
    inheritedScenarioCount: 0,
    missingScenarioCount: 0,
    noBaselineSeriesCount: 0,
    pendingScenarioCount: 0,
    regressionCount: 0,
    unchangedScenarioCount: 0,
    ...overrides,
  }
}
