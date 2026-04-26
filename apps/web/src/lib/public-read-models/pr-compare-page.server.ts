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
import {
  loadComparisonDetail,
  loadTreemapTimelineForSeries,
} from "./selected-series-detail.server.js"
import { reviewOutputRowsFromSummary } from "./output-rows.server.js"

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
    input.search.base,
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
  const selectedTreemapTimeline = input.search.tab === "treemap" && selectedReviewedRow && latestReviewSummary
    ? await loadTreemapTimelineForSeries(env, {
        repositoryId: repository.id,
        repositoryOwner: repository.owner,
        repositoryName: repository.name,
        seriesId: selectedReviewedRow.series.seriesId,
        branch: latestReviewSummary.branch,
        environment: selectedReviewedRow.series.environment,
        entrypoint: selectedReviewedRow.series.entrypoint,
        metric,
        baseCommitSha: selectedReviewedRow.series.selectedBaseCommitSha,
        headCommitSha: selectedReviewedRow.series.selectedHeadCommitSha,
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
    unionRows: [],
    reviewedRows,
    reviewOutputRows: latestReviewSummary
      ? reviewOutputRowsFromSummary(latestReviewSummary, metric)
      : [],
    selectedNeutralRow: null,
    selectedUnionRow: null,
    selectedReviewedRow,
    selectedDetail,
    selectedTreemapTimeline,
    metric,
    commitOptions: await listRepositoryCommitOptions(env, repository.id),
  }
}
