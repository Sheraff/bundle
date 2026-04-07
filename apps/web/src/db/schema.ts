import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

export const repositories = sqliteTable(
  'repositories',
  {
    id: text('id').primaryKey(),
    githubRepoId: integer('github_repo_id').notNull(),
    owner: text('owner').notNull(),
    name: text('name').notNull(),
    installationId: integer('installation_id').notNull(),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [uniqueIndex('repositories_github_repo_id_unique').on(table.githubRepoId)],
)

export const scenarios = sqliteTable(
  'scenarios',
  {
    id: text('id').primaryKey(),
    repositoryId: text('repository_id')
      .notNull()
      .references(() => repositories.id),
    slug: text('slug').notNull(),
    sourceKind: text('source_kind').notNull(),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    uniqueIndex('scenarios_repository_id_slug_unique').on(table.repositoryId, table.slug),
    index('scenarios_repository_id_idx').on(table.repositoryId),
  ],
)

export const pullRequests = sqliteTable(
  'pull_requests',
  {
    id: text('id').primaryKey(),
    repositoryId: text('repository_id')
      .notNull()
      .references(() => repositories.id),
    prNumber: integer('pr_number').notNull(),
    baseSha: text('base_sha').notNull(),
    baseRef: text('base_ref').notNull(),
    headSha: text('head_sha').notNull(),
    headRef: text('head_ref').notNull(),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    uniqueIndex('pull_requests_repository_id_pr_number_unique').on(
      table.repositoryId,
      table.prNumber,
    ),
    index('pull_requests_repository_id_idx').on(table.repositoryId),
  ],
)

export const commitGroups = sqliteTable(
  'commit_groups',
  {
    id: text('id').primaryKey(),
    repositoryId: text('repository_id')
      .notNull()
      .references(() => repositories.id),
    pullRequestId: text('pull_request_id').references(() => pullRequests.id),
    commitSha: text('commit_sha').notNull(),
    branch: text('branch').notNull(),
    status: text('status').notNull(),
    latestUploadAt: text('latest_upload_at').notNull(),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    uniqueIndex('commit_groups_repository_id_commit_sha_unique').on(
      table.repositoryId,
      table.commitSha,
    ),
    index('commit_groups_pull_request_id_idx').on(table.pullRequestId),
  ],
)

export const scenarioRuns = sqliteTable(
  'scenario_runs',
  {
    id: text('id').primaryKey(),
    repositoryId: text('repository_id')
      .notNull()
      .references(() => repositories.id),
    scenarioId: text('scenario_id')
      .notNull()
      .references(() => scenarios.id),
    commitGroupId: text('commit_group_id')
      .notNull()
      .references(() => commitGroups.id),
    pullRequestId: text('pull_request_id').references(() => pullRequests.id),
    commitSha: text('commit_sha').notNull(),
    branch: text('branch').notNull(),
    status: text('status').notNull(),
    scenarioSourceKind: text('scenario_source_kind').notNull(),
    artifactScenarioKind: text('artifact_scenario_kind').notNull(),
    uploadDedupeKey: text('upload_dedupe_key').notNull(),
    rawArtifactR2Key: text('raw_artifact_r2_key').notNull(),
    rawEnvelopeR2Key: text('raw_envelope_r2_key').notNull(),
    artifactSha256: text('artifact_sha256').notNull(),
    envelopeSha256: text('envelope_sha256').notNull(),
    artifactSizeBytes: integer('artifact_size_bytes').notNull(),
    envelopeSizeBytes: integer('envelope_size_bytes').notNull(),
    artifactSchemaVersion: integer('artifact_schema_version').notNull(),
    uploadSchemaVersion: integer('upload_schema_version').notNull(),
    ciProvider: text('ci_provider').notNull(),
    ciWorkflowRunId: text('ci_workflow_run_id').notNull(),
    ciWorkflowRunAttempt: integer('ci_workflow_run_attempt'),
    ciJob: text('ci_job'),
    ciActionVersion: text('ci_action_version'),
    normalizedSnapshotR2Key: text('normalized_snapshot_r2_key'),
    normalizedSchemaVersion: integer('normalized_schema_version'),
    normalizationStartedAt: text('normalization_started_at'),
    normalizedAt: text('normalized_at'),
    failureCode: text('failure_code'),
    failureMessage: text('failure_message'),
    uploadedAt: text('uploaded_at').notNull(),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    uniqueIndex('scenario_runs_upload_dedupe_key_unique').on(table.uploadDedupeKey),
    index('scenario_runs_commit_group_id_idx').on(table.commitGroupId),
    index('scenario_runs_scenario_id_idx').on(table.scenarioId),
  ],
)

export const series = sqliteTable(
  'series',
  {
    id: text('id').primaryKey(),
    repositoryId: text('repository_id')
      .notNull()
      .references(() => repositories.id),
    scenarioId: text('scenario_id')
      .notNull()
      .references(() => scenarios.id),
    environment: text('environment').notNull(),
    entrypointKey: text('entrypoint_key').notNull(),
    entrypointKind: text('entrypoint_kind').notNull(),
    lens: text('lens').notNull(),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    uniqueIndex('series_repository_id_scenario_id_environment_entrypoint_lens_unique').on(
      table.repositoryId,
      table.scenarioId,
      table.environment,
      table.entrypointKey,
      table.lens,
    ),
    index('series_repository_id_idx').on(table.repositoryId),
    index('series_scenario_id_idx').on(table.scenarioId),
  ],
)

export const seriesPoints = sqliteTable(
  'series_points',
  {
    id: text('id').primaryKey(),
    repositoryId: text('repository_id')
      .notNull()
      .references(() => repositories.id),
    seriesId: text('series_id')
      .notNull()
      .references(() => series.id),
    scenarioRunId: text('scenario_run_id')
      .notNull()
      .references(() => scenarioRuns.id),
    commitGroupId: text('commit_group_id')
      .notNull()
      .references(() => commitGroups.id),
    pullRequestId: text('pull_request_id').references(() => pullRequests.id),
    commitSha: text('commit_sha').notNull(),
    branch: text('branch').notNull(),
    measuredAt: text('measured_at').notNull(),
    entryJsRawBytes: integer('entry_js_raw_bytes').notNull(),
    entryJsGzipBytes: integer('entry_js_gzip_bytes').notNull(),
    entryJsBrotliBytes: integer('entry_js_brotli_bytes').notNull(),
    directCssRawBytes: integer('direct_css_raw_bytes').notNull(),
    directCssGzipBytes: integer('direct_css_gzip_bytes').notNull(),
    directCssBrotliBytes: integer('direct_css_brotli_bytes').notNull(),
    totalRawBytes: integer('total_raw_bytes').notNull(),
    totalGzipBytes: integer('total_gzip_bytes').notNull(),
    totalBrotliBytes: integer('total_brotli_bytes').notNull(),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    uniqueIndex('series_points_series_id_scenario_run_id_unique').on(
      table.seriesId,
      table.scenarioRunId,
    ),
    index('series_points_repository_id_idx').on(table.repositoryId),
    index('series_points_series_id_measured_at_idx').on(table.seriesId, table.measuredAt),
    index('series_points_commit_group_id_idx').on(table.commitGroupId),
  ],
)

export const comparisons = sqliteTable(
  'comparisons',
  {
    id: text('id').primaryKey(),
    repositoryId: text('repository_id')
      .notNull()
      .references(() => repositories.id),
    seriesId: text('series_id')
      .notNull()
      .references(() => series.id),
    headScenarioRunId: text('head_scenario_run_id')
      .notNull()
      .references(() => scenarioRuns.id),
    baseScenarioRunId: text('base_scenario_run_id').references(() => scenarioRuns.id),
    headCommitGroupId: text('head_commit_group_id')
      .notNull()
      .references(() => commitGroups.id),
    baseCommitGroupId: text('base_commit_group_id').references(() => commitGroups.id),
    pullRequestId: text('pull_request_id').references(() => pullRequests.id),
    kind: text('kind').notNull(),
    status: text('status').notNull(),
    requestedBaseSha: text('requested_base_sha'),
    requestedHeadSha: text('requested_head_sha').notNull(),
    selectedBaseCommitSha: text('selected_base_commit_sha'),
    selectedHeadCommitSha: text('selected_head_commit_sha').notNull(),
    currentTotalRawBytes: integer('current_total_raw_bytes').notNull(),
    currentTotalGzipBytes: integer('current_total_gzip_bytes').notNull(),
    currentTotalBrotliBytes: integer('current_total_brotli_bytes').notNull(),
    baselineTotalRawBytes: integer('baseline_total_raw_bytes'),
    baselineTotalGzipBytes: integer('baseline_total_gzip_bytes'),
    baselineTotalBrotliBytes: integer('baseline_total_brotli_bytes'),
    deltaTotalRawBytes: integer('delta_total_raw_bytes'),
    deltaTotalGzipBytes: integer('delta_total_gzip_bytes'),
    deltaTotalBrotliBytes: integer('delta_total_brotli_bytes'),
    selectedEntrypointRelation: text('selected_entrypoint_relation'),
    selectedEntrypointConfidence: text('selected_entrypoint_confidence'),
    selectedEntrypointEvidenceJson: text('selected_entrypoint_evidence_json'),
    stableIdentitySummaryJson: text('stable_identity_summary_json'),
    hasDegradedStableIdentity: integer('has_degraded_stable_identity').notNull(),
    budgetState: text('budget_state').notNull(),
    failureCode: text('failure_code'),
    failureMessage: text('failure_message'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    uniqueIndex('comparisons_kind_series_id_head_scenario_run_id_unique').on(
      table.kind,
      table.seriesId,
      table.headScenarioRunId,
    ),
    index('comparisons_repository_id_idx').on(table.repositoryId),
    index('comparisons_series_id_idx').on(table.seriesId),
    index('comparisons_pull_request_id_idx').on(table.pullRequestId),
    index('comparisons_head_scenario_run_id_idx').on(table.headScenarioRunId),
    index('comparisons_base_scenario_run_id_idx').on(table.baseScenarioRunId),
  ],
)

export const budgetResults = sqliteTable(
  'budget_results',
  {
    id: text('id').primaryKey(),
    repositoryId: text('repository_id')
      .notNull()
      .references(() => repositories.id),
    comparisonId: text('comparison_id')
      .notNull()
      .references(() => comparisons.id),
    seriesId: text('series_id')
      .notNull()
      .references(() => series.id),
    itemKey: text('item_key').notNull(),
    metricKey: text('metric_key').notNull(),
    status: text('status').notNull(),
    blocking: integer('blocking').notNull(),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    uniqueIndex('budget_results_comparison_id_item_key_unique').on(
      table.comparisonId,
      table.itemKey,
    ),
    index('budget_results_repository_id_idx').on(table.repositoryId),
    index('budget_results_series_id_idx').on(table.seriesId),
    index('budget_results_comparison_id_idx').on(table.comparisonId),
  ],
)

export const acknowledgements = sqliteTable(
  'acknowledgements',
  {
    id: text('id').primaryKey(),
    repositoryId: text('repository_id')
      .notNull()
      .references(() => repositories.id),
    pullRequestId: text('pull_request_id')
      .notNull()
      .references(() => pullRequests.id),
    comparisonId: text('comparison_id')
      .notNull()
      .references(() => comparisons.id),
    seriesId: text('series_id')
      .notNull()
      .references(() => series.id),
    itemKey: text('item_key').notNull(),
    actorGithubUserId: integer('actor_github_user_id'),
    actorLogin: text('actor_login'),
    note: text('note'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    uniqueIndex('acknowledgements_pull_request_id_comparison_id_item_key_unique').on(
      table.pullRequestId,
      table.comparisonId,
      table.itemKey,
    ),
    index('acknowledgements_repository_id_idx').on(table.repositoryId),
    index('acknowledgements_pull_request_id_idx').on(table.pullRequestId),
    index('acknowledgements_comparison_id_idx').on(table.comparisonId),
  ],
)

export const commitGroupSummaries = sqliteTable(
  'commit_group_summaries',
  {
    id: text('id').primaryKey(),
    repositoryId: text('repository_id')
      .notNull()
      .references(() => repositories.id),
    commitGroupId: text('commit_group_id')
      .notNull()
      .references(() => commitGroups.id),
    pullRequestId: text('pull_request_id').references(() => pullRequests.id),
    commitSha: text('commit_sha').notNull(),
    branch: text('branch').notNull(),
    status: text('status').notNull(),
    latestUploadAt: text('latest_upload_at').notNull(),
    quietWindowDeadline: text('quiet_window_deadline').notNull(),
    settledAt: text('settled_at'),
    expectedScenarioCount: integer('expected_scenario_count').notNull(),
    freshScenarioCount: integer('fresh_scenario_count').notNull(),
    pendingScenarioCount: integer('pending_scenario_count').notNull(),
    inheritedScenarioCount: integer('inherited_scenario_count').notNull(),
    missingScenarioCount: integer('missing_scenario_count').notNull(),
    failedScenarioCount: integer('failed_scenario_count').notNull(),
    impactedScenarioCount: integer('impacted_scenario_count').notNull(),
    unchangedScenarioCount: integer('unchanged_scenario_count').notNull(),
    comparisonCount: integer('comparison_count').notNull(),
    changedMetricCount: integer('changed_metric_count').notNull(),
    noBaselineSeriesCount: integer('no_baseline_series_count').notNull(),
    failedComparisonCount: integer('failed_comparison_count').notNull(),
    degradedComparisonCount: integer('degraded_comparison_count').notNull(),
    summaryJson: text('summary_json').notNull(),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    uniqueIndex('commit_group_summaries_commit_group_id_unique').on(table.commitGroupId),
    index('commit_group_summaries_repository_id_idx').on(table.repositoryId),
    index('commit_group_summaries_pull_request_id_idx').on(table.pullRequestId),
    index('commit_group_summaries_status_idx').on(table.status),
  ],
)

export const prReviewSummaries = sqliteTable(
  'pr_review_summaries',
  {
    id: text('id').primaryKey(),
    repositoryId: text('repository_id')
      .notNull()
      .references(() => repositories.id),
    pullRequestId: text('pull_request_id')
      .notNull()
      .references(() => pullRequests.id),
    commitGroupId: text('commit_group_id')
      .notNull()
      .references(() => commitGroups.id),
    commitSha: text('commit_sha').notNull(),
    branch: text('branch').notNull(),
    latestUploadAt: text('latest_upload_at').notNull(),
    settledAt: text('settled_at'),
    status: text('status').notNull(),
    overallState: text('overall_state').notNull(),
    blockingRegressionCount: integer('blocking_regression_count').notNull(),
    regressionCount: integer('regression_count').notNull(),
    acknowledgedRegressionCount: integer('acknowledged_regression_count').notNull(),
    improvementCount: integer('improvement_count').notNull(),
    pendingScenarioCount: integer('pending_scenario_count').notNull(),
    inheritedScenarioCount: integer('inherited_scenario_count').notNull(),
    missingScenarioCount: integer('missing_scenario_count').notNull(),
    failedScenarioCount: integer('failed_scenario_count').notNull(),
    impactedScenarioCount: integer('impacted_scenario_count').notNull(),
    unchangedScenarioCount: integer('unchanged_scenario_count').notNull(),
    noBaselineSeriesCount: integer('no_baseline_series_count').notNull(),
    failedComparisonCount: integer('failed_comparison_count').notNull(),
    degradedComparisonCount: integer('degraded_comparison_count').notNull(),
    summaryJson: text('summary_json').notNull(),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    uniqueIndex('pr_review_summaries_commit_group_id_unique').on(table.commitGroupId),
    index('pr_review_summaries_repository_id_idx').on(table.repositoryId),
    index('pr_review_summaries_pull_request_id_idx').on(table.pullRequestId),
    index('pr_review_summaries_status_idx').on(table.status),
  ],
)

export const githubPublications = sqliteTable(
  'github_publications',
  {
    id: text('id').primaryKey(),
    repositoryId: text('repository_id')
      .notNull()
      .references(() => repositories.id),
    pullRequestId: text('pull_request_id')
      .notNull()
      .references(() => pullRequests.id),
    commitGroupId: text('commit_group_id').references(() => commitGroups.id),
    surface: text('surface').notNull(),
    status: text('status').notNull(),
    externalPublicationId: text('external_publication_id'),
    externalPublicationNodeId: text('external_publication_node_id'),
    externalUrl: text('external_url'),
    publishedHeadSha: text('published_head_sha'),
    payloadHash: text('payload_hash'),
    lastAttemptedAt: text('last_attempted_at'),
    lastPublishedAt: text('last_published_at'),
    lastErrorCode: text('last_error_code'),
    lastErrorMessage: text('last_error_message'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    uniqueIndex('github_publications_pull_request_id_surface_unique').on(
      table.pullRequestId,
      table.surface,
    ),
    uniqueIndex('github_publications_commit_group_id_surface_unique').on(
      table.commitGroupId,
      table.surface,
    ),
    index('github_publications_repository_id_idx').on(table.repositoryId),
    index('github_publications_pull_request_id_idx').on(table.pullRequestId),
    index('github_publications_commit_group_id_idx').on(table.commitGroupId),
    index('github_publications_surface_idx').on(table.surface),
  ],
)
