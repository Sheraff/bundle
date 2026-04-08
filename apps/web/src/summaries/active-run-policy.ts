import type { ScenarioRunSummaryRow } from "./types.js"

export function groupScenarioRunsByScenarioId(scenarioRuns: ScenarioRunSummaryRow[]) {
  const runsByScenarioId = new Map<string, ScenarioRunSummaryRow[]>()

  for (const scenarioRun of scenarioRuns) {
    const currentRuns = runsByScenarioId.get(scenarioRun.scenarioId) ?? []
    currentRuns.push(scenarioRun)
    runsByScenarioId.set(scenarioRun.scenarioId, currentRuns)
  }

  return runsByScenarioId
}

export function selectActiveRunsByScenarioId(
  runsByScenarioId: Map<string, ScenarioRunSummaryRow[]>,
) {
  const activeRunsByScenarioId = new Map<string, ScenarioRunSummaryRow>()

  for (const [scenarioId, runs] of runsByScenarioId.entries()) {
    const activeRun = selectActiveRun(runs)

    if (activeRun) {
      activeRunsByScenarioId.set(scenarioId, activeRun)
    }
  }

  return activeRunsByScenarioId
}

export function selectActiveRun(scenarioRuns: ScenarioRunSummaryRow[]) {
  return scenarioRuns.find((scenarioRun) => scenarioRun.status === "processed") ?? null
}

export function selectLatestFailedRun(scenarioRuns: ScenarioRunSummaryRow[]) {
  return scenarioRuns.find((scenarioRun) => scenarioRun.status === "failed") ?? null
}

export function hasInFlightRun(scenarioRuns: ScenarioRunSummaryRow[]) {
  return scenarioRuns.some(
    (scenarioRun) => scenarioRun.status === "queued" || scenarioRun.status === "processing",
  )
}

export function hasNewerFailedRun(
  latestFailedRun: ScenarioRunSummaryRow | null,
  activeRun: ScenarioRunSummaryRow,
) {
  return Boolean(latestFailedRun && isScenarioRunNewerThan(latestFailedRun, activeRun))
}

export function isScenarioRunNewerThan(left: ScenarioRunSummaryRow, right: ScenarioRunSummaryRow) {
  const leftUploadedAt = Date.parse(left.uploadedAt)
  const rightUploadedAt = Date.parse(right.uploadedAt)

  if (leftUploadedAt !== rightUploadedAt) {
    return leftUploadedAt > rightUploadedAt
  }

  return Date.parse(left.createdAt) > Date.parse(right.createdAt)
}
