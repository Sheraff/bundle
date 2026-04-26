import { DEFAULT_LENS_SLUG } from "@workspace/contracts"

import type { AppBindings } from "../../env.js"
import { parseSizeMetric } from "../size-metric.js"
import {
  listRepositoryBranches,
  listRepositoryCommitOptions,
  listRepositoryEntrypoints,
  listRepositoryEnvironments,
  listRepositoryLenses,
  listRepositoryScenarios,
  loadRepositoryHistory,
  requireRepository,
} from "./shared.server.js"

export async function getRepositoryHistoryPageData(
  env: AppBindings,
  input: {
    owner: string
    repo: string
    branch?: string
    scenario?: string
    env?: string
    entrypoint?: string
    lens?: string
    metric?: string
  },
) {
  const repository = await requireRepository(env, input.owner, input.repo)
  const branchOptions = await listRepositoryBranches(env, repository.id)
  const defaultBranch = branchOptions.includes("main") ? "main" : branchOptions[0] ?? null
  const scenarioOptions = await listRepositoryScenarios(env, repository.id)
  const environmentOptions = await listRepositoryEnvironments(env, repository.id)
  const resolvedBranch = input.branch ?? defaultBranch
  const resolvedScenario = input.scenario ?? "all"
  const resolvedEnvironment = input.env ?? "all"
  const entrypointOptions = await listRepositoryEntrypoints(env, repository.id, resolvedEnvironment)
  const resolvedEntrypoint = input.entrypoint ?? "all"
  const lensOptions = await listRepositoryLenses(env, repository.id)
  const resolvedLens = input.lens ?? lensOptions[0] ?? DEFAULT_LENS_SLUG

  return {
    repository,
    branch: resolvedBranch,
    scenario: resolvedScenario,
    env: resolvedEnvironment,
    entrypoint: resolvedEntrypoint,
    lens: resolvedLens,
    metric: parseSizeMetric(input.metric),
    branchOptions,
    scenarioOptions,
    environmentOptions,
    entrypointOptions,
    lensOptions,
    commitOptions: await listRepositoryCommitOptions(env, repository.id),
    history: resolvedBranch
      ? await loadRepositoryHistory(env, repository.id, {
          branch: resolvedBranch,
          scenario: resolvedScenario,
          environment: resolvedEnvironment,
          entrypoint: resolvedEntrypoint,
          lens: resolvedLens,
        })
      : [],
  }
}
