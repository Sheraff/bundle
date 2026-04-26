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
import {
  loadComparisonDetail,
  loadTreemapTimelineForSeries,
} from "./selected-series-detail.server.js"
import { loadUnionPairOutputRows, type UnionPairOutputRow } from "./output-rows.server.js"

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
  const unionPairData = await loadUnionPairOutputRows(env, {
    baseSha: input.search.base,
    headSha: input.search.head,
    repositoryId: repository.id,
    selectedSize: metric,
  })
  const unionRows = filterUnionRows(unionPairData.rows, input.search)
  const selectedUnionRow = selectUnionRow(unionRows, input.search)
  const selectedDetail = selectedUnionRow?.comparisonId
    ? await loadComparisonDetail(env, {
        comparisonId: selectedUnionRow.comparisonId,
        environment: selectedUnionRow.environment.key,
        entrypoint: selectedUnionRow.entrypoint.key,
        metric,
      })
    : null
  const selectedTreemapTimeline = input.search.tab === "treemap" && selectedUnionRow?.seriesId
    ? await loadTreemapTimelineForSeries(env, {
        repositoryId: repository.id,
        repositoryOwner: repository.owner,
        repositoryName: repository.name,
        seriesId: selectedUnionRow.seriesId,
        branch: selectedUnionRow.headPoint?.branch ?? selectedUnionRow.basePoint?.branch ?? latestSummary?.branch ?? "",
        environment: selectedUnionRow.environment.key,
        entrypoint: selectedUnionRow.entrypoint.key,
        metric,
        baseCommitSha: input.search.base,
        headCommitSha: input.search.head,
      })
    : null

  return {
    repository,
    mode: "neutral" as const,
    contextMatched: unionPairData.contextMatched,
    latestSummary,
    latestReviewSummary: null,
    statusScenarios: latestSummary?.statusScenarios ?? [],
    neutralRows,
    unionRows,
    reviewedRows: [],
    selectedNeutralRow,
    selectedUnionRow,
    selectedReviewedRow: null,
    selectedDetail,
    selectedTreemapTimeline,
    metric,
    commitOptions: await listRepositoryCommitOptions(env, repository.id),
  }
}

function filterUnionRows(rows: UnionPairOutputRow[], search: ComparePageSearchParams) {
  return rows.filter(
    (row) =>
      (!search.scenario || row.scenario.slug === search.scenario) &&
      (!search.env || row.environment.key === search.env) &&
      (!search.entrypoint || row.entrypoint.key === search.entrypoint) &&
      (!search.lens || row.lens.id === search.lens),
  )
}

function selectUnionRow(rows: UnionPairOutputRow[], search: ComparePageSearchParams) {
  if (!search.scenario || !search.env || !search.entrypoint || !search.lens) {
    return null
  }

  return (
    rows.find(
      (row) =>
        row.scenario.slug === search.scenario &&
        row.environment.key === search.env &&
        row.entrypoint.key === search.entrypoint &&
        row.lens.id === search.lens,
    ) ?? null
  )
}
