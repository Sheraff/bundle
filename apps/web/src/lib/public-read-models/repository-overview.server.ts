import {
  DEFAULT_LENS_SLUG,
  type CommitGroupStatusScenarioSummaryV1,
  type CommitGroupSummaryV1,
  type FreshCommitGroupScenarioSummaryV1,
  type NeutralComparisonItemSummaryV1,
  type NeutralComparisonSeriesSummaryV1,
} from "@workspace/contracts"

import type { AppBindings } from "../../env.js"

import {
  listRepositoryBranches,
  listRepositoryLenses,
  loadKnownScenarios,
  loadLatestCommitGroupSummaryByBranch,
  loadRepositoryTrend,
  listRepositoryCommitOptions,
  requireRepository,
  selectLatestImportantCompare,
  selectPrimaryNeutralItem,
  selectPrimaryNeutralSeries,
} from "./shared.server.js"
import { parseSizeMetric } from "../size-metric.js"
import { scenarioLatestOutputRowsFromFreshScenario } from "./output-rows.server.js"

type RepositoryScenarioCatalogRow =
  | {
      kind: "fresh"
      scenario: FreshCommitGroupScenarioSummaryV1
      primarySeries: NeutralComparisonSeriesSummaryV1 | null
      primaryItem: NeutralComparisonItemSummaryV1 | null
    }
  | {
      kind: "status"
      scenario: CommitGroupStatusScenarioSummaryV1
    }
  | {
      kind: "known"
      scenario: {
        id: string
        slug: string
        sourceKind: string
      }
    }

export async function getRepositoryOverviewPageData(
  env: AppBindings,
  input: {
    owner: string
    repo: string
    branch?: string
    lens?: string
    metric?: string
  },
) {
  const repository = await requireRepository(env, input.owner, input.repo)
  const branchOptions = await listRepositoryBranches(env, repository.id)
  const resolvedBranch = input.branch ?? branchOptions[0] ?? null
  const lensOptions = await listRepositoryLenses(env, repository.id)
  const resolvedLens = input.lens ?? lensOptions[0] ?? DEFAULT_LENS_SLUG
  const metric = parseSizeMetric(input.metric)
  const latestSummary = resolvedBranch
    ? await loadLatestCommitGroupSummaryByBranch(env, repository.id, resolvedBranch)
    : null

  return {
    repository,
    branch: resolvedBranch,
    lens: resolvedLens,
    metric,
    branchOptions,
    lensOptions,
    trend: resolvedBranch
      ? await loadRepositoryTrend(env, repository.id, resolvedBranch, resolvedLens)
      : [],
    latestSummary,
    scenarioOutputRows: latestSummary
      ? latestSummary.freshScenarioGroups.flatMap((scenario) =>
          scenarioLatestOutputRowsFromFreshScenario(scenario, metric, { lens: resolvedLens })
        )
      : [],
    commitOptions: await listRepositoryCommitOptions(env, repository.id),
    latestImportantCompare: latestSummary ? selectLatestImportantCompare(latestSummary) : null,
    scenarioCatalog: latestSummary
      ? buildRepositoryScenarioCatalog(latestSummary)
      : await loadKnownScenarios(env, repository.id),
  }
}

function buildRepositoryScenarioCatalog(
  summary: CommitGroupSummaryV1,
): RepositoryScenarioCatalogRow[] {
  return [
    ...summary.freshScenarioGroups.map((scenario) => {
      const primarySeries = selectPrimaryNeutralSeries(scenario.series)

      return {
        kind: "fresh" as const,
        scenario,
        primarySeries,
        primaryItem: selectPrimaryNeutralItem(primarySeries),
      }
    }),
    ...summary.statusScenarios.map((scenario) => ({
      kind: "status" as const,
      scenario,
    })),
  ]
}
