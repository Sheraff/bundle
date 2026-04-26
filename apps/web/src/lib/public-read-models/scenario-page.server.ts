import { DEFAULT_LENS_SLUG } from "@workspace/contracts"

import type { AppBindings } from "../../env.js"
import { parseSizeMetric } from "../size-metric.js"

import {
  buildNeutralCompareRows,
  buildScenarioCompareShortcut,
  listRepositoryBranches,
  listScenarioEntrypoints,
  listScenarioEnvironments,
  listScenarioLenses,
  loadLatestCommitGroupSummaryByBranch,
  loadScenarioHistory,
  requireRepository,
  requireScenario,
} from "./shared.server.js"
import {
  loadSnapshotDetailForScenarioRun,
  loadTreemapTimelineForSeries,
} from "./selected-series-detail.server.js"
import {
  scenarioHistoryOutputRowsFromSeries,
  scenarioLatestOutputRowsFromFreshScenario,
} from "./output-rows.server.js"

export async function getScenarioPageData(
  env: AppBindings,
  input: {
    owner: string
    repo: string
    scenario: string
    branch?: string
    env?: string
    entrypoint?: string
    lens?: string
    tab?: string
    metric?: string
  },
) {
  const repository = await requireRepository(env, input.owner, input.repo)
  const scenario = await requireScenario(env, repository.id, input.scenario)
  const branchOptions = await listRepositoryBranches(env, repository.id)
  const defaultBranch = branchOptions.includes("main") ? "main" : branchOptions[0] ?? null
  const resolvedBranch = input.branch ?? defaultBranch
  const resolvedEnvironment = input.env ?? "all"
  const resolvedEntrypoint = input.entrypoint ?? "all"
  const environmentOptions = await listScenarioEnvironments(env, scenario.id)
  const entrypointOptions = await listScenarioEntrypoints(env, scenario.id, resolvedEnvironment)
  const lensOptions = await listScenarioLenses(
    env,
    scenario.id,
    resolvedEnvironment,
    resolvedEntrypoint,
  )
  const resolvedLens = input.lens ?? lensOptions[0] ?? DEFAULT_LENS_SLUG
  const metric = parseSizeMetric(input.metric)
  const latestSummary = resolvedBranch
    ? await loadLatestCommitGroupSummaryByBranch(env, repository.id, resolvedBranch)
    : null
  const latestFreshScenario =
    latestSummary?.freshScenarioGroups.find(
      (scenarioGroup) => scenarioGroup.scenarioSlug === scenario.slug,
    ) ?? null
  const latestStatusScenario =
    latestSummary?.statusScenarios.find(
      (scenarioGroup) => scenarioGroup.scenarioSlug === scenario.slug,
    ) ?? null
  const history = resolvedBranch
    ? await loadScenarioHistory(
        env,
        repository.id,
        scenario.id,
        resolvedBranch,
        resolvedEnvironment,
        resolvedEntrypoint,
        resolvedLens,
      )
    : []
  const latestRows = latestFreshScenario ? buildNeutralCompareRows([latestFreshScenario]) : []
  const selectedSeries =
    resolvedEnvironment !== "all" && resolvedEntrypoint !== "all"
      ? (latestRows.find(
          (row) =>
            row.series.environment === resolvedEnvironment &&
            row.series.entrypoint === resolvedEntrypoint &&
            row.series.lens === resolvedLens,
        ) ?? null)
      : null
  const selectedHistorySeries =
    resolvedEnvironment !== "all" && resolvedEntrypoint !== "all"
      ? (history.find(
          (series) =>
            series.environment === resolvedEnvironment &&
            series.entrypoint === resolvedEntrypoint &&
            series.lens === resolvedLens,
        ) ?? null)
      : null
  const selectedHistoryPoint = selectedHistorySeries?.points[0] ?? null
  const selectedDetail = selectedSeries || selectedHistoryPoint
    ? await loadSnapshotDetailForScenarioRun(env, {
        scenarioRunId: selectedSeries?.series.scenarioRunId ?? selectedHistoryPoint!.scenarioRunId,
        environment: selectedSeries?.series.environment ?? selectedHistorySeries!.environment,
        entrypoint: selectedSeries?.series.entrypoint ?? selectedHistorySeries!.entrypoint,
        metric,
      })
    : null
  const selectedTreemapTimeline = input.tab === "treemap" && (selectedSeries || selectedHistorySeries) && resolvedBranch
    ? await loadTreemapTimelineForSeries(env, {
        repositoryId: repository.id,
        repositoryOwner: repository.owner,
        repositoryName: repository.name,
        seriesId: selectedSeries?.series.seriesId ?? selectedHistorySeries!.seriesId,
        branch: resolvedBranch,
        environment: selectedSeries?.series.environment ?? selectedHistorySeries!.environment,
        entrypoint: selectedSeries?.series.entrypoint ?? selectedHistorySeries!.entrypoint,
        metric,
        headCommitSha: selectedSeries?.series.selectedHeadCommitSha ?? selectedHistoryPoint?.commitSha,
      })
    : null

  return {
    repository,
    scenario,
    branch: resolvedBranch,
    env: resolvedEnvironment,
    entrypoint: resolvedEntrypoint,
    lens: resolvedLens,
    metric,
    tab: input.tab,
    branchOptions,
    environmentOptions,
    entrypointOptions,
    lensOptions,
    latestSummary,
    latestFreshScenario,
    latestStatusScenario,
    history,
    historyOutputRows: scenarioHistoryOutputRowsFromSeries(history, {
      scenarioId: scenario.id,
      scenarioSlug: scenario.slug,
      scenarioSourceKind: scenario.sourceKind,
      selectedSize: metric,
    }),
    compareShortcut: buildScenarioCompareShortcut(latestFreshScenario),
    latestOutputRows: latestFreshScenario
      ? scenarioLatestOutputRowsFromFreshScenario(latestFreshScenario, metric, { lens: resolvedLens })
      : [],
    selectedSeries,
    selectedHistorySeries,
    selectedHistoryPoint,
    selectedDetail,
    selectedTreemapTimeline,
  }
}
