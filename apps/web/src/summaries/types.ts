import type { CommitGroupSummaryV1 } from '@workspace/contracts'

import { getDb, schema } from '../db/index.js'

export type DbClient = ReturnType<typeof getDb>
export type CommitGroupRow = typeof schema.commitGroups.$inferSelect
export type PullRequestRow = typeof schema.pullRequests.$inferSelect
export type SummaryComparisonKind = CommitGroupSummaryV1['comparisonKind']

export interface ScenarioCatalogRow {
  id: string
  slug: string
  sourceKind: string
}

export interface ScenarioRunSummaryRow {
  id: string
  scenarioId: string
  scenarioSlug: string
  sourceKind: string
  status: string
  commitGroupId: string
  commitSha: string
  branch: string
  uploadedAt: string
  createdAt: string
  failureCode: string | null
  failureMessage: string | null
}

export interface ActiveSeriesComparisonRow {
  scenarioRunId: string
  seriesId: string
  environment: string
  entrypoint: string
  entrypointKind: string
  lens: string
  comparisonId: string | null
  comparisonStatus: string | null
  requestedBaseSha: string | null
  selectedBaseCommitSha: string | null
  selectedHeadCommitSha: string | null
  currentTotalRawBytes: number | null
  currentTotalGzipBytes: number | null
  currentTotalBrotliBytes: number | null
  baselineTotalRawBytes: number | null
  baselineTotalGzipBytes: number | null
  baselineTotalBrotliBytes: number | null
  deltaTotalRawBytes: number | null
  deltaTotalGzipBytes: number | null
  deltaTotalBrotliBytes: number | null
  selectedEntrypointRelation: string | null
  hasDegradedStableIdentity: number | null
  budgetState: string | null
  failureCode: string | null
  failureMessage: string | null
}

export interface AcknowledgementOverlayRow {
  id: string
  comparisonId: string
  itemKey: string
  note: string | null
}

export interface ExistingSummaryState {
  status: string
  settledAt: string | null
}
