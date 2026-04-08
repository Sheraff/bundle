import {
  commitGroupSummaryV1Schema,
  prReviewSummaryV1Schema,
  type ComparePageSearchParams,
  type CommitGroupStatusScenarioSummaryV1,
  type CommitGroupSummaryV1,
  type FreshCommitGroupScenarioSummaryV1,
  type NeutralComparisonItemSummaryV1,
  type NeutralComparisonSeriesSummaryV1,
  type PrReviewSummaryV1,
  type ReviewSeriesState,
  type ReviewedComparisonItemSummaryV1,
  type ReviewedComparisonSeriesSummaryV1,
  type ReviewedScenarioSummaryV1,
} from "@workspace/contracts"
import { and, asc, desc, eq, isNull, sql } from "drizzle-orm"
import * as v from "valibot"

import { getDb, schema } from "../../db/index.js"
import { selectOne } from "../../db/select-one.js"
import type { AppBindings } from "../../env.js"
import { formatIssues } from "../../shared/format-issues.js"

export interface RepositoryReference {
  id: string
  owner: string
  name: string
  githubRepoId: number
}

export interface RepositoryTrendPoint {
  commitGroupId: string
  commitSha: string
  measuredAt: string
  totalRawBytes: number
  totalGzipBytes: number
  totalBrotliBytes: number
}

export interface ScenarioHistoryPoint {
  commitSha: string
  measuredAt: string
  totalRawBytes: number
  totalGzipBytes: number
  totalBrotliBytes: number
}

export type ScenarioHistorySeries = {
  seriesId: string
  environment: string
  entrypoint: string
  entrypointKind: string
  lens: string
  points: ScenarioHistoryPoint[]
}

export interface ScenarioCompareShortcut {
  base: string
  head: string
  scenario: string
  env: string
  entrypoint: string
  lens: string
}

export type NeutralScenarioCompareRow = {
  scenarioId: string
  scenarioSlug: string
  sourceKind: string
  hasNewerFailedRun: boolean
  latestFailureMessage: string | null
  series: NeutralComparisonSeriesSummaryV1
  primaryItem: NeutralComparisonItemSummaryV1 | null
}

export type ReviewedScenarioCompareRow = {
  scenarioId: string
  scenarioSlug: string
  sourceKind: string
  scenarioReviewState: ReviewSeriesState
  hasNewerFailedRun: boolean
  latestFailureMessage: string | null
  acknowledgedItemCount: number
  series: ReviewedComparisonSeriesSummaryV1
  primaryItem: ReviewedComparisonItemSummaryV1 | null
}

export async function requireRepository(
  env: AppBindings,
  owner: string,
  repo: string,
): Promise<RepositoryReference> {
  const repository = await selectOne(
    getDb(env)
      .select({
        id: schema.repositories.id,
        owner: schema.repositories.owner,
        name: schema.repositories.name,
        githubRepoId: schema.repositories.githubRepoId,
      })
      .from(schema.repositories)
      .where(and(eq(schema.repositories.owner, owner), eq(schema.repositories.name, repo)))
      .limit(1),
  )

  if (!repository) {
    throw new Error(`Repository ${owner}/${repo} was not found.`)
  }

  return repository
}

export async function requireScenario(
  env: AppBindings,
  repositoryId: string,
  scenarioSlug: string,
) {
  const scenario = await selectOne(
    getDb(env)
      .select({
        id: schema.scenarios.id,
        slug: schema.scenarios.slug,
        sourceKind: schema.scenarios.sourceKind,
      })
      .from(schema.scenarios)
      .where(
        and(
          eq(schema.scenarios.repositoryId, repositoryId),
          eq(schema.scenarios.slug, scenarioSlug),
        ),
      )
      .limit(1),
  )

  if (!scenario) {
    throw new Error(`Scenario ${scenarioSlug} was not found for this repository.`)
  }

  return scenario
}

export async function listRepositoryBranches(env: AppBindings, repositoryId: string) {
  const rows = await getDb(env)
    .selectDistinct({ branch: schema.commitGroups.branch })
    .from(schema.commitGroups)
    .where(
      and(
        eq(schema.commitGroups.repositoryId, repositoryId),
        isNull(schema.commitGroups.pullRequestId),
      ),
    )
    .orderBy(asc(schema.commitGroups.branch))

  return rows.map((row) => row.branch)
}

export async function listRepositoryLenses(env: AppBindings, repositoryId: string) {
  const rows = await getDb(env)
    .selectDistinct({ lens: schema.series.lens })
    .from(schema.series)
    .where(eq(schema.series.repositoryId, repositoryId))
    .orderBy(asc(schema.series.lens))

  return rows.map((row) => row.lens)
}

export async function listScenarioEnvironments(env: AppBindings, scenarioId: string) {
  const rows = await getDb(env)
    .selectDistinct({ environment: schema.series.environment })
    .from(schema.series)
    .where(eq(schema.series.scenarioId, scenarioId))
    .orderBy(asc(schema.series.environment))

  return rows.map((row) => row.environment)
}

export async function listScenarioEntrypoints(
  env: AppBindings,
  scenarioId: string,
  environment: string,
) {
  const filters = [eq(schema.series.scenarioId, scenarioId)]

  if (environment !== "all") {
    filters.push(eq(schema.series.environment, environment))
  }

  const rows = await getDb(env)
    .selectDistinct({ entrypoint: schema.series.entrypointKey })
    .from(schema.series)
    .where(and(...filters))
    .orderBy(asc(schema.series.entrypointKey))

  return rows.map((row) => row.entrypoint)
}

export async function listScenarioLenses(
  env: AppBindings,
  scenarioId: string,
  environment: string,
  entrypoint: string,
) {
  const filters = [eq(schema.series.scenarioId, scenarioId)]

  if (environment !== "all") {
    filters.push(eq(schema.series.environment, environment))
  }

  if (entrypoint !== "all") {
    filters.push(eq(schema.series.entrypointKey, entrypoint))
  }

  const rows = await getDb(env)
    .selectDistinct({ lens: schema.series.lens })
    .from(schema.series)
    .where(and(...filters))
    .orderBy(asc(schema.series.lens))

  return rows.map((row) => row.lens)
}

export async function loadLatestCommitGroupSummaryByBranch(
  env: AppBindings,
  repositoryId: string,
  branch: string,
) {
  const row = await selectOne(
    getDb(env)
      .select({ summaryJson: schema.commitGroupSummaries.summaryJson })
      .from(schema.commitGroupSummaries)
      .where(
        and(
          eq(schema.commitGroupSummaries.repositoryId, repositoryId),
          eq(schema.commitGroupSummaries.branch, branch),
          isNull(schema.commitGroupSummaries.pullRequestId),
        ),
      )
      .orderBy(desc(schema.commitGroupSummaries.latestUploadAt))
      .limit(1),
  )

  return row
    ? parseStoredJson(commitGroupSummaryV1Schema, row.summaryJson, "commit-group summary")
    : null
}

export async function loadCommitGroupSummaryByHeadSha(
  env: AppBindings,
  repositoryId: string,
  headSha: string,
) {
  const row = await selectOne(
    getDb(env)
      .select({ summaryJson: schema.commitGroupSummaries.summaryJson })
      .from(schema.commitGroupSummaries)
      .where(
        and(
          eq(schema.commitGroupSummaries.repositoryId, repositoryId),
          eq(schema.commitGroupSummaries.commitSha, headSha),
          isNull(schema.commitGroupSummaries.pullRequestId),
        ),
      )
      .limit(1),
  )

  return row
    ? parseStoredJson(commitGroupSummaryV1Schema, row.summaryJson, "commit-group summary")
    : null
}

export async function loadPrReviewSummaryByPullRequestNumber(
  env: AppBindings,
  repositoryId: string,
  pullRequestNumber: number,
  headSha: string,
) {
  const row = await selectOne(
    getDb(env)
      .select({ summaryJson: schema.prReviewSummaries.summaryJson })
      .from(schema.prReviewSummaries)
      .innerJoin(
        schema.pullRequests,
        eq(schema.pullRequests.id, schema.prReviewSummaries.pullRequestId),
      )
      .where(
        and(
          eq(schema.prReviewSummaries.repositoryId, repositoryId),
          eq(schema.pullRequests.prNumber, pullRequestNumber),
          eq(schema.prReviewSummaries.commitSha, headSha),
        ),
      )
      .limit(1),
  )

  return row ? parseStoredJson(prReviewSummaryV1Schema, row.summaryJson, "pr review summary") : null
}

export async function loadKnownScenarios(env: AppBindings, repositoryId: string) {
  const rows = await getDb(env)
    .select({
      id: schema.scenarios.id,
      slug: schema.scenarios.slug,
      sourceKind: schema.scenarios.sourceKind,
    })
    .from(schema.scenarios)
    .where(eq(schema.scenarios.repositoryId, repositoryId))
    .orderBy(asc(schema.scenarios.slug))

  return rows.map((scenario) => ({
    kind: "known" as const,
    scenario,
  }))
}

export async function loadRepositoryTrend(
  env: AppBindings,
  repositoryId: string,
  branch: string,
  lens: string,
) {
  const measuredAtExpression = sql<string>`max(${schema.seriesPoints.measuredAt})`

  return getDb(env)
    .select({
      commitGroupId: schema.seriesPoints.commitGroupId,
      commitSha: schema.seriesPoints.commitSha,
      measuredAt: measuredAtExpression,
      totalRawBytes: sql<number>`sum(${schema.seriesPoints.totalRawBytes})`,
      totalGzipBytes: sql<number>`sum(${schema.seriesPoints.totalGzipBytes})`,
      totalBrotliBytes: sql<number>`sum(${schema.seriesPoints.totalBrotliBytes})`,
    })
    .from(schema.seriesPoints)
    .innerJoin(schema.series, eq(schema.series.id, schema.seriesPoints.seriesId))
    .where(
      and(
        eq(schema.seriesPoints.repositoryId, repositoryId),
        eq(schema.seriesPoints.branch, branch),
        eq(schema.series.lens, lens),
      ),
    )
    .groupBy(schema.seriesPoints.commitGroupId, schema.seriesPoints.commitSha)
    .orderBy(desc(measuredAtExpression))
    .limit(20)
}

export async function loadScenarioHistory(
  env: AppBindings,
  repositoryId: string,
  scenarioId: string,
  branch: string,
  environment: string,
  entrypoint: string,
  lens: string,
) {
  const filters = [
    eq(schema.seriesPoints.repositoryId, repositoryId),
    eq(schema.series.scenarioId, scenarioId),
    eq(schema.seriesPoints.branch, branch),
    eq(schema.series.lens, lens),
  ]

  if (environment !== "all") {
    filters.push(eq(schema.series.environment, environment))
  }

  if (entrypoint !== "all") {
    filters.push(eq(schema.series.entrypointKey, entrypoint))
  }

  const rows = await getDb(env)
    .select({
      seriesId: schema.series.id,
      environment: schema.series.environment,
      entrypoint: schema.series.entrypointKey,
      entrypointKind: schema.series.entrypointKind,
      lens: schema.series.lens,
      commitSha: schema.seriesPoints.commitSha,
      measuredAt: schema.seriesPoints.measuredAt,
      totalRawBytes: schema.seriesPoints.totalRawBytes,
      totalGzipBytes: schema.seriesPoints.totalGzipBytes,
      totalBrotliBytes: schema.seriesPoints.totalBrotliBytes,
    })
    .from(schema.seriesPoints)
    .innerJoin(schema.series, eq(schema.series.id, schema.seriesPoints.seriesId))
    .where(and(...filters))
    .orderBy(
      asc(schema.series.environment),
      asc(schema.series.entrypointKey),
      desc(schema.seriesPoints.measuredAt),
    )

  const historyBySeries = new Map<string, ScenarioHistorySeries>()

  for (const row of rows) {
    const existingSeries = historyBySeries.get(row.seriesId)

    if (!existingSeries) {
      historyBySeries.set(row.seriesId, {
        seriesId: row.seriesId,
        environment: row.environment,
        entrypoint: row.entrypoint,
        entrypointKind: row.entrypointKind,
        lens: row.lens,
        points: [toScenarioHistoryPoint(row)],
      })
      continue
    }

    if (existingSeries.points.length < 20) {
      existingSeries.points.push(toScenarioHistoryPoint(row))
    }
  }

  return Array.from(historyBySeries.values())
}

export function buildNeutralCompareRows(
  scenarios: FreshCommitGroupScenarioSummaryV1[],
): NeutralScenarioCompareRow[] {
  return scenarios.flatMap((scenarioGroup) =>
    scenarioGroup.series.map((series) => ({
      scenarioId: scenarioGroup.scenarioId,
      scenarioSlug: scenarioGroup.scenarioSlug,
      sourceKind: scenarioGroup.sourceKind,
      hasNewerFailedRun: scenarioGroup.hasNewerFailedRun,
      latestFailureMessage: scenarioGroup.latestFailureMessage,
      series,
      primaryItem: selectPrimaryNeutralItem(series),
    })),
  )
}

export function buildReviewedCompareRows(
  scenarios: ReviewedScenarioSummaryV1[],
): ReviewedScenarioCompareRow[] {
  return scenarios.flatMap((scenarioGroup) =>
    scenarioGroup.series.map((series) => ({
      scenarioId: scenarioGroup.scenarioId,
      scenarioSlug: scenarioGroup.scenarioSlug,
      sourceKind: scenarioGroup.sourceKind,
      scenarioReviewState: scenarioGroup.reviewState,
      hasNewerFailedRun: scenarioGroup.hasNewerFailedRun,
      latestFailureMessage: scenarioGroup.latestFailureMessage,
      acknowledgedItemCount: scenarioGroup.acknowledgedItemCount,
      series,
      primaryItem: selectPrimaryReviewedItem(series),
    })),
  )
}

export function filterNeutralRows(
  rows: NeutralScenarioCompareRow[],
  search: ComparePageSearchParams,
) {
  return rows.filter((row) => matchesCompareSeriesFilters(row.scenarioSlug, row.series, search))
}

export function filterReviewedRows(
  rows: ReviewedScenarioCompareRow[],
  search: ComparePageSearchParams,
) {
  return rows.filter((row) => matchesCompareSeriesFilters(row.scenarioSlug, row.series, search))
}

export function selectLatestImportantCompare(summary: CommitGroupSummaryV1) {
  const candidates = buildNeutralCompareRows(summary.freshScenarioGroups)
    .filter((row) => row.series.selectedBaseCommitSha !== null && row.primaryItem !== null)
    .sort((left, right) => compareNeutralRows(left, right))

  const selected = candidates[0]

  if (!selected || !selected.primaryItem || !selected.series.selectedBaseCommitSha) {
    return null
  }

  return {
    scenarioSlug: selected.scenarioSlug,
    environment: selected.series.environment,
    entrypoint: selected.series.entrypoint,
    lens: selected.series.lens,
    baseSha: selected.series.selectedBaseCommitSha,
    headSha: selected.series.selectedHeadCommitSha,
    primaryItem: selected.primaryItem,
  }
}

export function buildScenarioCompareShortcut(
  latestFreshScenario: FreshCommitGroupScenarioSummaryV1 | null,
): ScenarioCompareShortcut | null {
  if (!latestFreshScenario) {
    return null
  }

  const primarySeries = selectPrimaryNeutralSeries(latestFreshScenario.series)
  const selectedSeries =
    primarySeries?.selectedBaseCommitSha !== null
      ? primarySeries
      : (latestFreshScenario.series.find((series) => series.selectedBaseCommitSha !== null) ?? null)

  if (!selectedSeries || !selectedSeries.selectedBaseCommitSha) {
    return null
  }

  return {
    base: selectedSeries.selectedBaseCommitSha,
    head: selectedSeries.selectedHeadCommitSha,
    scenario: latestFreshScenario.scenarioSlug,
    env: selectedSeries.environment,
    entrypoint: selectedSeries.entrypoint,
    lens: selectedSeries.lens,
  }
}

export function selectNeutralRow(
  rows: NeutralScenarioCompareRow[],
  search: ComparePageSearchParams,
) {
  if (!search.scenario || !search.env || !search.entrypoint || !search.lens) {
    return null
  }

  return (
    rows.find(
      (row) =>
        row.scenarioSlug === search.scenario &&
        row.series.environment === search.env &&
        row.series.entrypoint === search.entrypoint &&
        row.series.lens === search.lens,
    ) ?? null
  )
}

export function selectReviewedRow(
  rows: ReviewedScenarioCompareRow[],
  search: ComparePageSearchParams,
) {
  if (!search.scenario || !search.env || !search.entrypoint || !search.lens) {
    return null
  }

  return (
    rows.find(
      (row) =>
        row.scenarioSlug === search.scenario &&
        row.series.environment === search.env &&
        row.series.entrypoint === search.entrypoint &&
        row.series.lens === search.lens,
    ) ?? null
  )
}

export function selectPrimaryNeutralSeries(series: NeutralComparisonSeriesSummaryV1[]) {
  const sorted = [...series].sort((left, right) => {
    const leftPriority = selectNeutralSeriesPriority(left)
    const rightPriority = selectNeutralSeriesPriority(right)

    if (leftPriority !== rightPriority) {
      return leftPriority - rightPriority
    }

    return left.entrypoint.localeCompare(right.entrypoint)
  })

  return sorted[0] ?? null
}

export function selectPrimaryNeutralItem(series: NeutralComparisonSeriesSummaryV1 | null) {
  if (!series || series.status !== "materialized" || series.items.length === 0) {
    return null
  }

  return series.items[0] ?? null
}

export function selectPrimaryReviewedItem(series: ReviewedComparisonSeriesSummaryV1) {
  if (series.status !== "materialized" || series.items.length === 0) {
    return null
  }

  if (series.primaryItemKey) {
    return (
      series.items.find((item) => item.itemKey === series.primaryItemKey) ?? series.items[0] ?? null
    )
  }

  return series.items[0] ?? null
}

function toScenarioHistoryPoint(row: {
  commitSha: string
  measuredAt: string
  totalRawBytes: number
  totalGzipBytes: number
  totalBrotliBytes: number
}): ScenarioHistoryPoint {
  return {
    commitSha: row.commitSha,
    measuredAt: row.measuredAt,
    totalRawBytes: row.totalRawBytes,
    totalGzipBytes: row.totalGzipBytes,
    totalBrotliBytes: row.totalBrotliBytes,
  }
}

function matchesCompareSeriesFilters(
  scenarioSlug: string,
  series: Pick<NeutralComparisonSeriesSummaryV1, "environment" | "entrypoint" | "lens">,
  search: ComparePageSearchParams,
) {
  if (search.scenario && scenarioSlug !== search.scenario) {
    return false
  }

  if (search.env && series.environment !== search.env) {
    return false
  }

  if (search.entrypoint && series.entrypoint !== search.entrypoint) {
    return false
  }

  if (search.lens && series.lens !== search.lens) {
    return false
  }

  return true
}

function compareNeutralRows(left: NeutralScenarioCompareRow, right: NeutralScenarioCompareRow) {
  const leftDirection = left.primaryItem?.direction === "regression" ? 0 : 1
  const rightDirection = right.primaryItem?.direction === "regression" ? 0 : 1

  if (leftDirection !== rightDirection) {
    return leftDirection - rightDirection
  }

  return Math.abs(right.primaryItem?.deltaValue ?? 0) - Math.abs(left.primaryItem?.deltaValue ?? 0)
}

function selectNeutralSeriesPriority(series: NeutralComparisonSeriesSummaryV1) {
  if (series.status === "materialized" && series.items.length > 0) {
    const primaryItem = selectPrimaryNeutralItem(series)
    return primaryItem?.direction === "regression" ? 0 : 1
  }

  if (series.status === "materialized") {
    return 2
  }

  if (series.status === "failed") {
    return 3
  }

  return 4
}

function parseStoredJson<TSchema extends v.BaseSchema<unknown, unknown, v.BaseIssue<unknown>>>(
  schemaToParse: TSchema,
  text: string,
  label: string,
) {
  let parsedValue: unknown

  try {
    parsedValue = JSON.parse(text)
  } catch {
    throw new Error(`${label} stored invalid JSON.`)
  }

  const result = v.safeParse(schemaToParse, parsedValue)

  if (!result.success) {
    throw new Error(`${label} failed validation: ${formatIssues(result.issues)}`)
  }

  return result.output
}
