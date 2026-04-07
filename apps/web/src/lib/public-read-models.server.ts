import {
  DEFAULT_LENS_SLUG,
  commitGroupSummaryV1Schema,
  prReviewSummaryV1Schema,
  type CommitGroupStatusScenarioSummaryV1,
  type CommitGroupSummaryV1,
  type ComparePageSearchParams,
  type FreshCommitGroupScenarioSummaryV1,
  type NeutralComparisonItemSummaryV1,
  type NeutralComparisonSeriesSummaryV1,
  type PrReviewSummaryV1,
  type ReviewSeriesState,
  type ReviewedComparisonItemSummaryV1,
  type ReviewedComparisonSeriesSummaryV1,
  type ReviewedScenarioSummaryV1,
} from '@workspace/contracts'
import { and, asc, desc, eq, isNull, sql } from 'drizzle-orm'
import * as v from 'valibot'

import { getDb, schema } from '../db/index.js'
import type { AppBindings } from '../env.js'

interface RepositoryReference {
  id: string
  owner: string
  name: string
  githubRepoId: number
}

interface RepositoryTrendPoint {
  commitGroupId: string
  commitSha: string
  measuredAt: string
  totalRawBytes: number
  totalGzipBytes: number
  totalBrotliBytes: number
}

type RepositoryScenarioCatalogRow =
  | {
    kind: 'fresh'
    scenario: FreshCommitGroupScenarioSummaryV1
    primarySeries: NeutralComparisonSeriesSummaryV1 | null
    primaryItem: NeutralComparisonItemSummaryV1 | null
  }
  | {
    kind: 'status'
    scenario: CommitGroupStatusScenarioSummaryV1
  }
  | {
    kind: 'known'
    scenario: {
      id: string
      slug: string
      sourceKind: string
    }
  }

interface RepositoryImportantCompare {
  scenarioSlug: string
  environment: string
  entrypoint: string
  lens: string
  baseSha: string
  headSha: string
  primaryItem: NeutralComparisonItemSummaryV1
}

interface RepositoryOverviewPageData {
  repository: RepositoryReference
  branch: string | null
  lens: string
  branchOptions: string[]
  lensOptions: string[]
  trend: RepositoryTrendPoint[]
  latestSummary: CommitGroupSummaryV1 | null
  latestImportantCompare: RepositoryImportantCompare | null
  scenarioCatalog: RepositoryScenarioCatalogRow[]
}

interface ScenarioHistoryPoint {
  commitSha: string
  measuredAt: string
  totalRawBytes: number
  totalGzipBytes: number
  totalBrotliBytes: number
}

type ScenarioHistorySeries = {
  seriesId: string
  environment: string
  entrypoint: string
  entrypointKind: string
  lens: string
  points: ScenarioHistoryPoint[]
}

interface ScenarioCompareShortcut {
  base: string
  head: string
  scenario: string
  env: string
  entrypoint: string
  lens: string
}

type NeutralScenarioCompareRow = {
  scenarioId: string
  scenarioSlug: string
  sourceKind: string
  hasNewerFailedRun: boolean
  latestFailureMessage: string | null
  series: NeutralComparisonSeriesSummaryV1
  primaryItem: NeutralComparisonItemSummaryV1 | null
}

type ReviewedScenarioCompareRow = {
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

type ComparePageData = {
  repository: RepositoryReference
  mode: 'neutral' | 'pr'
  contextMatched: boolean
  latestSummary: CommitGroupSummaryV1 | null
  latestReviewSummary: PrReviewSummaryV1 | null
  statusScenarios: CommitGroupStatusScenarioSummaryV1[]
  neutralRows: NeutralScenarioCompareRow[]
  reviewedRows: ReviewedScenarioCompareRow[]
  selectedNeutralRow: NeutralScenarioCompareRow | null
  selectedReviewedRow: ReviewedScenarioCompareRow | null
}

export async function getRepositoryOverviewPageData(
  env: AppBindings,
  input: {
    owner: string
    repo: string
    branch?: string
    lens?: string
  },
) {
  const repository = await requireRepository(env, input.owner, input.repo)
  const branchOptions = await listRepositoryBranches(env, repository.id)
  const resolvedBranch = input.branch ?? branchOptions[0] ?? null
  const lensOptions = await listRepositoryLenses(env, repository.id)
  const resolvedLens = input.lens ?? lensOptions[0] ?? DEFAULT_LENS_SLUG
  const latestSummary = resolvedBranch
    ? await loadLatestCommitGroupSummaryByBranch(env, repository.id, resolvedBranch)
    : null

  return {
    repository,
    branch: resolvedBranch,
    lens: resolvedLens,
    branchOptions,
    lensOptions,
    trend: resolvedBranch
      ? await loadRepositoryTrend(env, repository.id, resolvedBranch, resolvedLens)
      : [],
    latestSummary,
    latestImportantCompare: latestSummary ? selectLatestImportantCompare(latestSummary) : null,
    scenarioCatalog: latestSummary
      ? buildRepositoryScenarioCatalog(latestSummary)
      : await loadKnownScenarios(env, repository.id),
  }
}

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
  const entrypointOptions = await listScenarioEntrypoints(
    env,
    scenario.id,
    resolvedEnvironment,
  )
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
  const latestFreshScenario = latestSummary?.freshScenarioGroups.find(
    (scenarioGroup) => scenarioGroup.scenarioSlug === scenario.slug,
  ) ?? null
  const latestStatusScenario = latestSummary?.statusScenarios.find(
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

export async function getComparePageData(
  env: AppBindings,
  input: {
    owner: string
    repo: string
    search: ComparePageSearchParams
  },
) {
  const repository = await requireRepository(env, input.owner, input.repo)

  if (input.search.pr) {
    return getPrComparePageData(env, repository, input.search)
  }

  return getNeutralComparePageData(env, repository, input.search)
}

async function getNeutralComparePageData(
  env: AppBindings,
  repository: RepositoryReference,
  search: ComparePageSearchParams,
) {
  const latestSummary = await loadCommitGroupSummaryByHeadSha(env, repository.id, search.head)
  const allRows = latestSummary ? buildNeutralCompareRows(latestSummary.freshScenarioGroups) : []
  const contextMatchedRows = allRows.filter(
    (row) =>
      row.series.selectedHeadCommitSha === search.head &&
      (row.series.selectedBaseCommitSha === search.base || row.series.requestedBaseSha === search.base),
  )
  const neutralRows = filterNeutralRows(contextMatchedRows, search)
  const selectedNeutralRow = selectNeutralRow(neutralRows, search)

  return {
    repository,
    mode: 'neutral',
    contextMatched: contextMatchedRows.length > 0,
    latestSummary,
    latestReviewSummary: null,
    statusScenarios: latestSummary?.statusScenarios ?? [],
    neutralRows,
    reviewedRows: [],
    selectedNeutralRow,
    selectedReviewedRow: null,
  }
}

async function getPrComparePageData(
  env: AppBindings,
  repository: RepositoryReference,
  search: ComparePageSearchParams,
) {
  const latestReviewSummary = await loadPrReviewSummaryByPullRequestNumber(
    env,
    repository.id,
    search.pr!,
    search.head,
  )
  const reviewedRows = latestReviewSummary
    ? filterReviewedRows(buildReviewedCompareRows(latestReviewSummary.scenarioGroups), search)
    : []
  const selectedReviewedRow = selectReviewedRow(reviewedRows, search)
  const contextMatched = latestReviewSummary
    ? latestReviewSummary.baseSha === search.base && latestReviewSummary.headSha === search.head
    : false

  return {
    repository,
    mode: 'pr',
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

async function requireRepository(env: AppBindings, owner: string, repo: string): Promise<RepositoryReference> {
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

async function requireScenario(env: AppBindings, repositoryId: string, scenarioSlug: string) {
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

async function listRepositoryBranches(env: AppBindings, repositoryId: string) {
  const rows = await getDb(env)
    .selectDistinct({ branch: schema.commitGroups.branch })
    .from(schema.commitGroups)
    .where(and(eq(schema.commitGroups.repositoryId, repositoryId), isNull(schema.commitGroups.pullRequestId)))
    .orderBy(asc(schema.commitGroups.branch))

  return rows.map((row) => row.branch)
}

async function listRepositoryLenses(env: AppBindings, repositoryId: string) {
  const rows = await getDb(env)
    .selectDistinct({ lens: schema.series.lens })
    .from(schema.series)
    .where(eq(schema.series.repositoryId, repositoryId))
    .orderBy(asc(schema.series.lens))

  return rows.map((row) => row.lens)
}

async function listScenarioEnvironments(env: AppBindings, scenarioId: string) {
  const rows = await getDb(env)
    .selectDistinct({ environment: schema.series.environment })
    .from(schema.series)
    .where(eq(schema.series.scenarioId, scenarioId))
    .orderBy(asc(schema.series.environment))

  return rows.map((row) => row.environment)
}

async function listScenarioEntrypoints(
  env: AppBindings,
  scenarioId: string,
  environment: string,
) {
  const filters = [eq(schema.series.scenarioId, scenarioId)]

  if (environment !== 'all') {
    filters.push(eq(schema.series.environment, environment))
  }

  const rows = await getDb(env)
    .selectDistinct({ entrypoint: schema.series.entrypointKey })
    .from(schema.series)
    .where(and(...filters))
    .orderBy(asc(schema.series.entrypointKey))

  return rows.map((row) => row.entrypoint)
}

async function listScenarioLenses(
  env: AppBindings,
  scenarioId: string,
  environment: string,
  entrypoint: string,
) {
  const filters = [eq(schema.series.scenarioId, scenarioId)]

  if (environment !== 'all') {
    filters.push(eq(schema.series.environment, environment))
  }

  if (entrypoint !== 'all') {
    filters.push(eq(schema.series.entrypointKey, entrypoint))
  }

  const rows = await getDb(env)
    .selectDistinct({ lens: schema.series.lens })
    .from(schema.series)
    .where(and(...filters))
    .orderBy(asc(schema.series.lens))

  return rows.map((row) => row.lens)
}

async function loadLatestCommitGroupSummaryByBranch(
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

  return row ? parseStoredJson(commitGroupSummaryV1Schema, row.summaryJson, 'commit-group summary') : null
}

async function loadCommitGroupSummaryByHeadSha(
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

  return row ? parseStoredJson(commitGroupSummaryV1Schema, row.summaryJson, 'commit-group summary') : null
}

async function loadPrReviewSummaryByPullRequestNumber(
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

  return row ? parseStoredJson(prReviewSummaryV1Schema, row.summaryJson, 'pr review summary') : null
}

async function loadKnownScenarios(env: AppBindings, repositoryId: string) {
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
    kind: 'known' as const,
    scenario,
  }))
}

async function loadRepositoryTrend(
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

async function loadScenarioHistory(
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

  if (environment !== 'all') {
    filters.push(eq(schema.series.environment, environment))
  }

  if (entrypoint !== 'all') {
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

function buildRepositoryScenarioCatalog(
  summary: CommitGroupSummaryV1,
): RepositoryScenarioCatalogRow[] {
  return [
    ...summary.freshScenarioGroups.map((scenario) => {
      const primarySeries = selectPrimaryNeutralSeries(scenario.series)

      return {
        kind: 'fresh' as const,
        scenario,
        primarySeries,
        primaryItem: selectPrimaryNeutralItem(primarySeries),
      }
    }),
    ...summary.statusScenarios.map((scenario) => ({
      kind: 'status' as const,
      scenario,
    })),
  ]
}

function buildNeutralCompareRows(
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

function buildReviewedCompareRows(
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

function filterNeutralRows(rows: NeutralScenarioCompareRow[], search: ComparePageSearchParams) {
  return rows.filter((row) => matchesCompareSeriesFilters(row.scenarioSlug, row.series, search))
}

function filterReviewedRows(rows: ReviewedScenarioCompareRow[], search: ComparePageSearchParams) {
  return rows.filter((row) => matchesCompareSeriesFilters(row.scenarioSlug, row.series, search))
}

function matchesCompareSeriesFilters(
  scenarioSlug: string,
  series: Pick<NeutralComparisonSeriesSummaryV1, 'environment' | 'entrypoint' | 'lens'>,
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

function selectLatestImportantCompare(summary: CommitGroupSummaryV1): RepositoryImportantCompare | null {
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

function compareNeutralRows(left: NeutralScenarioCompareRow, right: NeutralScenarioCompareRow) {
  const leftDirection = left.primaryItem?.direction === 'regression' ? 0 : 1
  const rightDirection = right.primaryItem?.direction === 'regression' ? 0 : 1

  if (leftDirection !== rightDirection) {
    return leftDirection - rightDirection
  }

  return Math.abs(right.primaryItem?.deltaValue ?? 0) - Math.abs(left.primaryItem?.deltaValue ?? 0)
}

function buildScenarioCompareShortcut(
  latestFreshScenario: FreshCommitGroupScenarioSummaryV1 | null,
): ScenarioCompareShortcut | null {
  if (!latestFreshScenario) {
    return null
  }

  const primarySeries = selectPrimaryNeutralSeries(latestFreshScenario.series)
  const selectedSeries =
    primarySeries?.selectedBaseCommitSha !== null
      ? primarySeries
      : latestFreshScenario.series.find((series) => series.selectedBaseCommitSha !== null) ?? null

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

function selectNeutralRow(rows: NeutralScenarioCompareRow[], search: ComparePageSearchParams) {
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

function selectReviewedRow(rows: ReviewedScenarioCompareRow[], search: ComparePageSearchParams) {
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

function selectPrimaryNeutralSeries(series: NeutralComparisonSeriesSummaryV1[]) {
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

function selectNeutralSeriesPriority(series: NeutralComparisonSeriesSummaryV1) {
  if (series.status === 'materialized' && series.items.length > 0) {
    const primaryItem = selectPrimaryNeutralItem(series)
    return primaryItem?.direction === 'regression' ? 0 : 1
  }

  if (series.status === 'materialized') {
    return 2
  }

  if (series.status === 'failed') {
    return 3
  }

  return 4
}

function selectPrimaryNeutralItem(series: NeutralComparisonSeriesSummaryV1 | null) {
  if (!series || series.status !== 'materialized' || series.items.length === 0) {
    return null
  }

  return series.items[0] ?? null
}

function selectPrimaryReviewedItem(series: ReviewedComparisonSeriesSummaryV1) {
  if (series.status !== 'materialized' || series.items.length === 0) {
    return null
  }

  if (series.primaryItemKey) {
    return series.items.find((item) => item.itemKey === series.primaryItemKey) ?? series.items[0] ?? null
  }

  return series.items[0] ?? null
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
    throw new Error(`${label} failed validation: ${formatValidationIssues(result.issues)}`)
  }

  return result.output
}

function formatValidationIssues(issues: readonly { message: string }[]) {
  return issues.map((issue) => issue.message).join('; ')
}

async function selectOne<T>(query: Promise<T[]>) {
  const [row] = await query
  return row ?? null
}
