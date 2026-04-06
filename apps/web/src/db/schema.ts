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
