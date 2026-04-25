import type { ComparePageSearchParams } from "@workspace/contracts"

import type { AppBindings } from "../../env.js"

import {
  buildReviewedCompareRows,
  filterReviewedRows,
  listRepositoryCommitOptions,
  loadPrReviewSummaryByPullRequestNumber,
  requireRepository,
  selectReviewedRow,
} from "./shared.server.js"
import { parseSizeMetric } from "../size-metric.js"
import { loadComparisonDetail } from "./selected-series-detail.server.js"

export async function getPullRequestComparePageData(
  env: AppBindings,
  input: {
    owner: string
    repo: string
    search: ComparePageSearchParams & { pr: number }
  },
) {
  const repository = await requireRepository(env, input.owner, input.repo)
  const latestReviewSummary = await loadPrReviewSummaryByPullRequestNumber(
    env,
    repository.id,
    input.search.pr,
    input.search.head,
  )
  const reviewedRows = latestReviewSummary
    ? filterReviewedRows(buildReviewedCompareRows(latestReviewSummary.scenarioGroups), input.search)
    : []
  const selectedReviewedRow = selectReviewedRow(reviewedRows, input.search)
  const metric = parseSizeMetric(input.search.metric)
  const selectedDetail = selectedReviewedRow
    ? await loadComparisonDetail(env, {
        comparisonId: selectedReviewedRow.series.comparisonId,
        environment: selectedReviewedRow.series.environment,
        entrypoint: selectedReviewedRow.series.entrypoint,
        metric,
      })
    : null
  const contextMatched = latestReviewSummary
    ? latestReviewSummary.baseSha === input.search.base &&
      latestReviewSummary.headSha === input.search.head
    : false

  return {
    repository,
    mode: "pr" as const,
    contextMatched,
    latestSummary: null,
    latestReviewSummary,
    statusScenarios: latestReviewSummary?.statusScenarios ?? [],
    neutralRows: [],
    reviewedRows,
    selectedNeutralRow: null,
    selectedReviewedRow,
    selectedDetail,
    metric,
    commitOptions: await listRepositoryCommitOptions(env, repository.id),
  }
}
