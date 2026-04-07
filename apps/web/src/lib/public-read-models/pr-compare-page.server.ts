import type { ComparePageSearchParams } from '@workspace/contracts'

import type { AppBindings } from '../../env.js'

import {
  buildReviewedCompareRows,
  filterReviewedRows,
  loadPrReviewSummaryByPullRequestNumber,
  requireRepository,
  selectReviewedRow,
} from './shared.server.js'

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
  const contextMatched = latestReviewSummary
    ? latestReviewSummary.baseSha === input.search.base && latestReviewSummary.headSha === input.search.head
    : false

  return {
    repository,
    mode: 'pr' as const,
    contextMatched,
    latestSummary: null,
    latestReviewSummary,
    statusScenarios: latestReviewSummary?.statusScenarios ?? [],
    neutralRows: [],
    reviewedRows,
    selectedNeutralRow: null,
    selectedReviewedRow,
  }
}
