import type { PrReviewSummaryV1, ReviewSeriesState } from "@workspace/contracts"
import { describe, expect, it } from "vitest"

import type { AppBindings } from "../src/env.js"
import { buildCheckRunPublicationPayload, selectCheckRunConclusion } from "../src/github/render-check-run.js"
import { buildCommentPublicationPayload } from "../src/github/render-comment.js"
import { buildReleaseReadinessReport } from "../src/lib/release-readiness.js"

const env = { PUBLIC_APP_ORIGIN: "https://bundle.test" } as AppBindings

describe("GitHub rendering", () => {
  it("maps real review outcomes to explicit check conclusions", () => {
    expect(selectCheckRunConclusion(summary())).toBe("success")
    expect(selectCheckRunConclusion(summary({ budgetState: "fail-blocking", reviewState: "blocking" }))).toBe("failure")
    expect(selectCheckRunConclusion(summary({ counts: { failedComparisonCount: 1 } }))).toBe("failure")
    expect(selectCheckRunConclusion(summary({ budgetState: "warn", reviewState: "warning" }))).toBe("neutral")
    expect(selectCheckRunConclusion(summary({ counts: { noBaselineSeriesCount: 1 } }))).toBe("neutral")
  })

  it("renders policy outcomes and hosted Review Mode links in PR comments", async () => {
    const payload = await buildCommentPublicationPayload(
      env,
      "acme",
      "widget",
      42,
      "01HP0000000000000000000001",
      summary({ budgetState: "fail-blocking", reviewState: "blocking" }),
    )

    expect(payload.body).toContain("1 blocking policy outcome")
    expect(payload.body).toContain("Policy: 1 blocking outcome.")
    expect(payload.body).toContain("[blocking policy failure]")
    expect(payload.body).toContain("[Open hosted Review Mode](https://bundle.test/r/acme/widget/compare?pr=42&base=0123456789abcdef0123456789abcdef01234567&head=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa)")
  })

  it("renders accepted policy decisions without treating them as failures", async () => {
    const acceptedSummary = summary({ budgetState: "accepted", itemAcknowledged: false, reviewState: "acknowledged" })
    const commentPayload = await buildCommentPublicationPayload(
      env,
      "acme",
      "widget",
      42,
      "01HP0000000000000000000001",
      acceptedSummary,
    )
    const checkPayload = await buildCheckRunPublicationPayload(
      env,
      "acme",
      "widget",
      42,
      "01HP0000000000000000000001",
      acceptedSummary,
    )

    expect(commentPayload.body).toContain("1 accepted policy decision")
    expect(commentPayload.body).toContain("[Accepted]")
    expect(checkPayload.conclusion).toBe("success")
    expect(checkPayload.output.text).toContain("### Accepted policy decisions")
  })

  it("does not invent enforcement when no policy matched", async () => {
    const payload = await buildCommentPublicationPayload(
      env,
      "acme",
      "widget",
      42,
      "01HP0000000000000000000001",
      summary({ budgetState: "not-configured" }),
    )

    expect(payload.body).toContain("Policy: no configured policy matched at least one reviewed output.")
    expect(payload.body).not.toContain("blocking policy outcome")
    expect(selectCheckRunConclusion(summary({ budgetState: "not-configured" }))).toBe("success")
  })
})

describe("release readiness", () => {
  it("keeps blocking policies, warnings, accepted decisions, and missing evidence explicit", () => {
    const report = buildReleaseReadinessReport({
      rows: [
        row({ policyState: "fail_blocking" }),
        row({ policyState: "warn" }),
        row({ policyState: "accepted" }),
        row({ evidenceAvailability: { state: "missing" }, measurementState: "missing_baseline" }),
      ],
      statusScenarios: [{ scenarioId: "scenario-missing", state: "missing" }],
      target: "main",
    })

    expect(report).toEqual(
      expect.objectContaining({
        acceptedDecisionCount: 1,
        blockingPolicyFailureCount: 1,
        missingMeasurementCount: 2,
        ready: false,
        state: "blocked",
        unavailableArtifactCount: 1,
        warningCount: 1,
      }),
    )
  })

  it("counts unique required scenarios across rows and scenario-level gaps", () => {
    const report = buildReleaseReadinessReport({
      rows: [
        row({ scenario: { id: "scenario-a" } }),
        row({ policyState: "warn", scenario: { id: "scenario-a" } }),
      ],
      statusScenarios: [{ scenarioId: "scenario-b", state: "missing" }],
      target: "main",
    })

    expect(report.scenarioCount).toBe(2)
  })

  it("keeps unavailable release targets from reporting ready", () => {
    const report = buildReleaseReadinessReport({
      rows: [row()],
      statusScenarios: [],
      target: "tag",
    })

    expect(report).toEqual(
      expect.objectContaining({
        ready: false,
        state: "needs_measurements",
        unavailableArtifactCount: 1,
      }),
    )
  })
})

function summary(overrides: {
  budgetState?: string
  counts?: Partial<PrReviewSummaryV1["counts"]>
  itemAcknowledged?: boolean
  reviewState?: ReviewSeriesState
} = {}): PrReviewSummaryV1 {
  const reviewState = overrides.reviewState ?? "regression"
  const itemAcknowledged = overrides.itemAcknowledged ?? reviewState === "acknowledged"

  return {
    baseRef: "main",
    baseSha: "0123456789abcdef0123456789abcdef01234567",
    branch: "feature/login",
    commitGroupId: "01HP0000000000000000000002",
    commitSha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    schemaVersion: 1,
    counts: {
      acknowledgedRegressionCount: reviewState === "acknowledged" ? 1 : 0,
      blockingRegressionCount: reviewState === "blocking" ? 1 : 0,
      degradedComparisonCount: 0,
      failedComparisonCount: 0,
      failedScenarioCount: 0,
      impactedScenarioCount: 1,
      improvementCount: 0,
      inheritedScenarioCount: 0,
      missingScenarioCount: 0,
      noBaselineSeriesCount: 0,
      pendingScenarioCount: 0,
      regressionCount: reviewState === "regression" ? 1 : 0,
      unchangedScenarioCount: 0,
      ...overrides.counts,
    },
    headRef: "feature/login",
    headSha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    overallState: reviewState === "blocking" ? "failing" : "passing",
    pullRequestId: "01HP0000000000000000000003",
    repositoryId: "01HP0000000000000000000004",
    scenarioGroups: [
      {
        acknowledgedItemCount: itemAcknowledged ? 1 : 0,
        additionalChangedSeriesCount: 0,
        hasNewerFailedRun: false,
        latestFailedAt: null,
        latestFailedScenarioRunId: null,
        latestFailureCode: null,
        latestFailureMessage: null,
        reviewState,
        scenarioId: "01HP0000000000000000000005",
        scenarioSlug: "scenario-pr",
        series: [
          {
            baselineTotals: { brotli: 38, gzip: 45, raw: 123 },
            budgetState: overrides.budgetState ?? "not-configured",
            comparisonId: "01HP0000000000000000000006",
            currentTotals: { brotli: 38, gzip: 45, raw: 150 },
            deltaTotals: { brotli: 0, gzip: 0, raw: 27 },
            entrypoint: "main.js",
            entrypointKind: "script",
            environment: "production",
            hasDegradedStableIdentity: false,
            items: [
              {
                acknowledgementId: itemAcknowledged ? "01HP0000000000000000000007" : null,
                acknowledged: itemAcknowledged,
                baselineValue: 123,
                currentValue: 150,
                deltaValue: 27,
                itemKey: "metric:total-raw-bytes",
                metricKey: "total-raw-bytes",
                note: null,
                percentageDelta: 21.95,
                reviewState: reviewState === "blocking" ? "blocking" : reviewState === "acknowledged" ? "acknowledged" : "regression",
              },
            ],
            lens: "entry-js-direct-css",
            primaryItemKey: "metric:total-raw-bytes",
            requestedBaseSha: "0123456789abcdef0123456789abcdef01234567",
            reviewState,
            scenarioRunId: "01HP0000000000000000000008",
            selectedBaseCommitSha: "0123456789abcdef0123456789abcdef01234567",
            selectedEntrypointRelation: null,
            selectedHeadCommitSha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            seriesId: "01HP0000000000000000000009",
            status: "materialized",
          },
        ],
        sourceKind: "vite",
        visibleSeriesId: "01HP0000000000000000000009",
      },
    ],
    settledAt: "2026-04-26T00:00:00.000Z",
    status: "settled",
    statusScenarios: [],
  }
}

function row(overrides: Partial<Parameters<typeof buildReleaseReadinessReport>[0]["rows"][number]> = {}) {
  return {
    evidenceAvailability: { state: "available" },
    measurementState: "complete" as const,
    policyState: "pass" as const,
    scenario: { id: "scenario-default" },
    ...overrides,
  }
}
