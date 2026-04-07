import { DEFAULT_LENS_SLUG } from '@workspace/contracts'

import type { AppBindings } from '../../env.js'

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
} from './shared.server.js'

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
  },
) {
  const repository = await requireRepository(env, input.owner, input.repo)
  const scenario = await requireScenario(env, repository.id, input.scenario)
  const branchOptions = await listRepositoryBranches(env, repository.id)
  const resolvedBranch = input.branch ?? branchOptions[0] ?? null
  const resolvedEnvironment = input.env ?? 'all'
  const resolvedEntrypoint = input.entrypoint ?? 'all'
  const environmentOptions = await listScenarioEnvironments(env, scenario.id)
  const entrypointOptions = await listScenarioEntrypoints(env, scenario.id, resolvedEnvironment)
  const lensOptions = await listScenarioLenses(
    env,
    scenario.id,
    resolvedEnvironment,
    resolvedEntrypoint,
  )
  const resolvedLens = input.lens ?? lensOptions[0] ?? DEFAULT_LENS_SLUG
  const latestSummary = resolvedBranch
    ? await loadLatestCommitGroupSummaryByBranch(env, repository.id, resolvedBranch)
    : null
  const latestFreshScenario =
    latestSummary?.freshScenarioGroups.find((scenarioGroup) => scenarioGroup.scenarioSlug === scenario.slug) ?? null
  const latestStatusScenario =
    latestSummary?.statusScenarios.find((scenarioGroup) => scenarioGroup.scenarioSlug === scenario.slug) ?? null
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
    resolvedEnvironment !== 'all' && resolvedEntrypoint !== 'all'
      ? latestRows.find(
          (row) =>
            row.series.environment === resolvedEnvironment &&
            row.series.entrypoint === resolvedEntrypoint &&
            row.series.lens === resolvedLens,
        ) ?? null
      : null

  return {
    repository,
    scenario,
    branch: resolvedBranch,
    env: resolvedEnvironment,
    entrypoint: resolvedEntrypoint,
    lens: resolvedLens,
    tab: input.tab,
    branchOptions,
    environmentOptions,
    entrypointOptions,
    lensOptions,
    latestSummary,
    latestFreshScenario,
    latestStatusScenario,
    history,
    compareShortcut: buildScenarioCompareShortcut(latestFreshScenario),
    selectedSeries,
  }
}
