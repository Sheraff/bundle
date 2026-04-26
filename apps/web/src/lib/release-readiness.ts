import type { MeasurementState, PolicyState } from "@workspace/contracts"

export type ReleaseReadinessTarget = "last-release" | "main" | "tag"

export type ReleaseReadinessRow = {
  evidenceAvailability: { state: string }
  measurementState: MeasurementState
  policyState: PolicyState
  scenario: { id: string }
}

export type ReleaseReadinessStatusScenario = {
  scenarioId: string
  state: "failed" | "inherited" | "missing"
}

export type ReleaseReadinessReport = {
  acceptedDecisionCount: number
  blockingPolicyFailureCount: number
  missingMeasurementCount: number
  ready: boolean
  scenarioCount: number
  state: "blocked" | "needs_measurements" | "ready" | "warnings"
  target: ReleaseReadinessTarget
  unavailableArtifactCount: number
  warningCount: number
}

export function buildReleaseReadinessReport(input: {
  rows: ReleaseReadinessRow[]
  statusScenarios: ReleaseReadinessStatusScenario[]
  target: ReleaseReadinessTarget
}): ReleaseReadinessReport {
  const scenarioCount = new Set([
    ...input.rows.map((row) => row.scenario.id),
    ...input.statusScenarios.map((scenario) => scenario.scenarioId),
  ]).size
  const blockingPolicyFailureCount = input.rows.filter((row) => row.policyState === "fail_blocking").length
  const warningCount = input.rows.filter(
    (row) => row.policyState === "fail_non_blocking" || row.policyState === "not_evaluated" || row.policyState === "warn",
  ).length
  const acceptedDecisionCount = input.rows.filter((row) => row.policyState === "accepted").length
  const missingMeasurementCount = input.rows.filter(
    (row) => row.measurementState === "failed" || row.measurementState === "incomplete" || row.measurementState === "missing_baseline",
  ).length + input.statusScenarios.filter((scenario) => scenario.state === "failed" || scenario.state === "missing").length
  const unavailableArtifactCount = input.rows.filter((row) => row.evidenceAvailability.state !== "available").length + (input.target === "main" ? 0 : 1)
  const state = blockingPolicyFailureCount > 0
    ? "blocked"
    : missingMeasurementCount > 0 || unavailableArtifactCount > 0
      ? "needs_measurements"
      : warningCount > 0
        ? "warnings"
        : "ready"

  return {
    acceptedDecisionCount,
    blockingPolicyFailureCount,
    missingMeasurementCount,
    ready: state === "ready" || state === "warnings",
    scenarioCount,
    state,
    target: input.target,
    unavailableArtifactCount,
    warningCount,
  }
}
