import type { ComparePageSearchParams } from "@workspace/contracts"

import type { AppBindings } from "../../env.js"

import {
  buildNeutralCompareRows,
  filterNeutralRows,
  listRepositoryCommitOptions,
  loadCommitGroupSummaryByHeadSha,
  requireRepository,
  selectNeutralRow,
} from "./shared.server.js"
import { parseSizeMetric } from "../size-metric.js"
import { loadComparisonDetail } from "./selected-series-detail.server.js"

export async function getNeutralComparePageData(
  env: AppBindings,
  input: {
    owner: string
    repo: string
    search: ComparePageSearchParams
  },
) {
  const repository = await requireRepository(env, input.owner, input.repo)
  const latestSummary = await loadCommitGroupSummaryByHeadSha(env, repository.id, input.search.head)
  const allRows = latestSummary ? buildNeutralCompareRows(latestSummary.freshScenarioGroups) : []
  const contextMatchedRows = allRows.filter(
    (row) =>
      row.series.selectedHeadCommitSha === input.search.head &&
      (row.series.selectedBaseCommitSha === input.search.base ||
        row.series.requestedBaseSha === input.search.base),
  )
  const neutralRows = filterNeutralRows(contextMatchedRows, input.search)
  const selectedNeutralRow = selectNeutralRow(neutralRows, input.search)
  const metric = parseSizeMetric(input.search.metric)
  const selectedDetail = selectedNeutralRow
    ? await loadComparisonDetail(env, {
        comparisonId: selectedNeutralRow.series.comparisonId,
        environment: selectedNeutralRow.series.environment,
        entrypoint: selectedNeutralRow.series.entrypoint,
        metric,
      })
    : null

  return {
    repository,
    mode: "neutral" as const,
    contextMatched: contextMatchedRows.length > 0,
    latestSummary,
    latestReviewSummary: null,
    statusScenarios: latestSummary?.statusScenarios ?? [],
    neutralRows,
    reviewedRows: [],
    selectedNeutralRow,
    selectedReviewedRow: null,
    selectedDetail,
    metric,
    commitOptions: await listRepositoryCommitOptions(env, repository.id),
  }
}
