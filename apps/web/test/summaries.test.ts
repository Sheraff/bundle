import {
  createExecutionContext,
  waitOnExecutionContext,
} from 'cloudflare:test'
import { env, exports } from 'cloudflare:workers'
import { describe, expect, it, vi } from 'vitest'
import { ulid } from 'ulid'

import { handleDeriveRunMessage } from '../src/derive-runs.js'
import { handleMaterializeComparisonMessage } from '../src/materialize-comparison.js'
import { handleNormalizeRunMessage } from '../src/normalize-runs.js'
import { handleRefreshSummariesMessage } from '../src/refresh-summaries.js'
import { handleScheduleComparisonsMessage } from '../src/schedule-comparisons.js'

const baseSha = '0123456789abcdef0123456789abcdef01234567'
const commitSha = '1111111111111111111111111111111111111111'
const rerunSha = '2222222222222222222222222222222222222222'
const prHeadSha = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'

describe('commit-group summary and PR review summary jobs', () => {
  it('writes an immediate pending commit-group summary on upload acceptance', async () => {
    const harness = createPipelineHarness()
    const response = await harness.acceptUpload(
      buildEnvelope({
        git: {
          commitSha: commitSha,
          branch: 'main',
        },
        ci: buildCiContext('5000'),
      }),
    )
    const payload = await response.json<{ commitGroupId: string; repositoryId: string }>()

    await harness.drainRefresh()

    const summary = await getCommitGroupSummary(commitSha)
    expect(summary?.status).toBe('pending')
    expect(summary?.pending_scenario_count).toBe(1)
    expect(summary?.fresh_scenario_count).toBe(0)
    expect(summary?.summary.counts.pendingScenarioCount).toBe(1)
    expect(summary?.summary.freshScenarioGroups).toHaveLength(0)
    expect(payload.commitGroupId).toBe(summary?.commit_group_id)
    expect(payload.repositoryId).toBe(summary?.repository_id)
  })

  it('settles immediately when every expected scenario has an active fresh run', async () => {
    const harness = createPipelineHarness()

    await harness.acceptUpload(
      buildEnvelope({
        git: {
          commitSha,
          branch: 'main',
        },
        ci: buildCiContext('5001'),
      }),
    )
    await harness.processAll()

    const summary = await getCommitGroupSummary(commitSha)
    expect(summary?.status).toBe('settled')
    expect(summary?.pending_scenario_count).toBe(0)
    expect(summary?.fresh_scenario_count).toBe(1)
    expect(summary?.summary.freshScenarioGroups[0]?.series).toHaveLength(1)
    expect(summary?.summary.freshScenarioGroups).toHaveLength(1)
  })

  it('settles quiet-window gaps into inherited and missing scenarios', async () => {
    const harness = createPipelineHarness()

    await harness.acceptUpload(
      buildEnvelope({
        artifact: buildSimpleArtifact({ scenarioId: 'scenario-a' }),
        git: {
          commitSha: baseSha,
          branch: 'main',
        },
        ci: buildCiContext('5100'),
      }),
    )
    await harness.processAll()

    await harness.acceptUpload(
      buildEnvelope({
        artifact: buildSimpleArtifact({ scenarioId: 'scenario-b' }),
        git: {
          commitSha: '3333333333333333333333333333333333333333',
          branch: 'main',
        },
        ci: buildCiContext('5101'),
      }),
    )
    await harness.processAll()

    const repository = await env.DB.prepare(`SELECT id FROM repositories LIMIT 1`).first<{ id: string }>()
    expect(repository?.id).toBeTruthy()

    const missingScenarioId = ulid()
    const timestamp = '2026-04-06T12:00:00.000Z'
    await env.DB.prepare(
      `INSERT INTO scenarios (id, repository_id, slug, source_kind, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
      .bind(missingScenarioId, repository?.id ?? '', 'scenario-c', 'fixture-app', timestamp, timestamp)
      .run()

    const currentResponse = await harness.acceptUpload(
      buildEnvelope({
        artifact: buildSimpleArtifact({ scenarioId: 'scenario-a' }),
        git: {
          commitSha: commitSha,
          branch: 'main',
        },
        ci: buildCiContext('5102'),
      }),
    )
    const currentPayload = await currentResponse.json<{ commitGroupId: string }>()
    await harness.processAll()

    const pendingSummary = await getCommitGroupSummary(commitSha)
    expect(pendingSummary?.status).toBe('pending')
    expect(pendingSummary?.pending_scenario_count).toBe(2)

    await env.DB.prepare(
      `UPDATE commit_groups
       SET latest_upload_at = ?, updated_at = ?
       WHERE id = ?`,
    )
      .bind('2026-04-06T11:00:00.000Z', '2026-04-06T11:00:00.000Z', currentPayload.commitGroupId)
      .run()

    await handleRefreshSummariesMessage(
      buildQueueMessage({
        schemaVersion: 1,
        kind: 'refresh-summaries',
        repositoryId: pendingSummary?.repository_id ?? '',
        commitGroupId: currentPayload.commitGroupId,
        dedupeKey: `refresh-summaries:${currentPayload.commitGroupId}:manual-expiry:v1`,
      }),
      env,
      harness.logger,
    )

    const settledSummary = await getCommitGroupSummary(commitSha)
    expect(settledSummary?.status).toBe('settled')
    expect(settledSummary?.pending_scenario_count).toBe(0)
    expect(settledSummary?.inherited_scenario_count).toBe(1)
    expect(settledSummary?.missing_scenario_count).toBe(1)
    expect(settledSummary?.summary.statusScenarios).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ state: 'inherited', scenarioSlug: 'scenario-b' }),
        expect.objectContaining({ state: 'missing', scenarioSlug: 'scenario-c' }),
      ]),
    )
  })

  it('reopens to pending on rerun and switches the active summary run after processing', async () => {
    const harness = createPipelineHarness()

    await harness.acceptUpload(
      buildEnvelope({
        artifact: buildSimpleArtifact({
          scenarioId: 'scenario-rerun',
          chunkSizes: size(123, 45, 38),
          cssSizes: size(10, 8, 6),
        }),
        git: {
          commitSha: rerunSha,
          branch: 'main',
        },
        ci: buildCiContext('5200'),
      }),
    )
    await harness.processAll()

    const firstSummary = await getCommitGroupSummary(rerunSha)
    const firstActiveRunId = firstSummary?.summary.freshScenarioGroups[0]?.activeScenarioRunId
    expect(firstSummary?.status).toBe('settled')
    expect(firstSummary?.summary.freshScenarioGroups[0]?.series[0]?.currentTotals.raw).toBe(133)

    await harness.acceptUpload(
      buildEnvelope({
        artifact: buildSimpleArtifact({
          scenarioId: 'scenario-rerun',
          chunkSizes: size(200, 45, 38),
          cssSizes: size(20, 8, 6),
        }),
        git: {
          commitSha: rerunSha,
          branch: 'main',
        },
        ci: buildCiContext('5201'),
      }),
    )

    await harness.drainRefresh()

    const pendingSummary = await getCommitGroupSummary(rerunSha)
    expect(pendingSummary?.status).toBe('pending')
    expect(pendingSummary?.pending_scenario_count).toBe(1)
    expect(pendingSummary?.summary.freshScenarioGroups[0]?.activeScenarioRunId).toBe(firstActiveRunId)

    await harness.drainNormalize()
    await harness.drainDerive()
    await harness.drainRefresh()
    await harness.drainSchedule()
    await harness.drainRefresh()
    await harness.drainMaterialize()
    await harness.drainRefresh()

    const settledSummary = await getCommitGroupSummary(rerunSha)
    expect(settledSummary?.status).toBe('settled')
    expect(settledSummary?.pending_scenario_count).toBe(0)
    expect(settledSummary?.summary.freshScenarioGroups[0]?.activeScenarioRunId).not.toBe(firstActiveRunId)
    expect(settledSummary?.summary.freshScenarioGroups[0]?.hasMultipleProcessedRuns).toBe(true)
    expect(settledSummary?.summary.freshScenarioGroups[0]?.series[0]?.currentTotals.raw).toBe(220)
  })

  it('surfaces failed scenario runs in commit-group summaries', async () => {
    const harness = createPipelineHarness()

    await harness.acceptUpload(
      buildEnvelope({
        artifact: buildSimpleArtifact({ scenarioId: 'scenario-failure' }),
        git: {
          commitSha: '4444444444444444444444444444444444444444',
          branch: 'main',
        },
        ci: buildCiContext('5300'),
      }),
    )
    await harness.drainRefresh()

    const rawArtifactKey = await env.DB.prepare(
      `SELECT raw_artifact_r2_key
       FROM scenario_runs
       WHERE commit_sha = ?
       LIMIT 1`,
    ).bind('4444444444444444444444444444444444444444').first<{ raw_artifact_r2_key: string }>()
    expect(rawArtifactKey?.raw_artifact_r2_key).toBeTruthy()

    await env.RAW_UPLOADS_BUCKET.delete(rawArtifactKey?.raw_artifact_r2_key ?? '')

    await harness.drainNormalize()
    await harness.drainRefresh()

    const summary = await getCommitGroupSummary('4444444444444444444444444444444444444444')
    expect(summary?.status).toBe('settled')
    expect(summary?.failed_scenario_count).toBe(1)
    expect(summary?.summary.statusScenarios).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ state: 'failed', scenarioSlug: 'scenario-failure' }),
      ]),
    )
  })

  it('overlays acknowledgements only for the active PR comparison rows', async () => {
    const harness = createPipelineHarness()

    await harness.acceptUpload(
      buildEnvelope({
        artifact: buildSimpleArtifact({
          scenarioId: 'scenario-pr',
          chunkSizes: size(123, 45, 38),
          cssSizes: size(10, 8, 6),
        }),
        git: {
          commitSha: baseSha,
          branch: 'main',
        },
        ci: buildCiContext('5400'),
      }),
    )
    await harness.processAll()

    await harness.acceptUpload(
      buildEnvelope({
        artifact: buildSimpleArtifact({
          scenarioId: 'scenario-pr',
          chunkSizes: size(150, 45, 38),
          cssSizes: size(10, 8, 6),
        }),
        git: {
          commitSha: prHeadSha,
          branch: 'feature/login',
        },
        pullRequest: {
          number: 42,
          baseSha,
          baseRef: 'main',
          headSha: prHeadSha,
          headRef: 'feature/login',
        },
        ci: buildCiContext('5401'),
      }),
    )
    await harness.processAll()

    const initialComparison = await env.DB.prepare(
      `SELECT id, repository_id, pull_request_id, series_id
       FROM comparisons
       WHERE kind = 'pr-base' AND selected_head_commit_sha = ?
       ORDER BY created_at ASC
       LIMIT 1`,
    ).bind(prHeadSha).first<{
      id: string
      repository_id: string
      pull_request_id: string
      series_id: string
    }>()
    expect(initialComparison?.id).toBeTruthy()

    const ackId = ulid()
    const ackTimestamp = '2026-04-06T12:30:00.000Z'
    await env.DB.prepare(
      `INSERT INTO acknowledgements (
         id,
         repository_id,
         pull_request_id,
         comparison_id,
         series_id,
         item_key,
         actor_login,
         note,
         created_at,
         updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        ackId,
        initialComparison?.repository_id ?? '',
        initialComparison?.pull_request_id ?? '',
        initialComparison?.id ?? '',
        initialComparison?.series_id ?? '',
        'metric:total-raw-bytes',
        'flo',
        'known regression',
        ackTimestamp,
        ackTimestamp,
      )
      .run()

    await handleRefreshSummariesMessage(
      buildQueueMessage({
        schemaVersion: 1,
        kind: 'refresh-summaries',
        repositoryId: initialComparison?.repository_id ?? '',
        commitGroupId: (await getCommitGroupSummary(prHeadSha))?.commit_group_id ?? '',
        dedupeKey: 'refresh-summaries:acknowledgement:v1',
      }),
      env,
      harness.logger,
    )

    const acknowledgedSummary = await getPrReviewSummary(prHeadSha)
    expect(acknowledgedSummary?.acknowledged_regression_count).toBe(1)
    expect(acknowledgedSummary?.regression_count).toBe(0)

    await harness.acceptUpload(
      buildEnvelope({
        artifact: buildSimpleArtifact({
          scenarioId: 'scenario-pr',
          chunkSizes: size(180, 45, 38),
          cssSizes: size(10, 8, 6),
        }),
        git: {
          commitSha: prHeadSha,
          branch: 'feature/login',
        },
        pullRequest: {
          number: 42,
          baseSha,
          baseRef: 'main',
          headSha: prHeadSha,
          headRef: 'feature/login',
        },
        ci: buildCiContext('5402'),
      }),
    )
    await harness.processAll()

    const refreshedSummary = await getPrReviewSummary(prHeadSha)
    expect(refreshedSummary?.acknowledged_regression_count).toBe(0)
    expect(refreshedSummary?.regression_count).toBe(1)
  })

  it('surfaces a newer failed rerun while keeping the older active fresh run', async () => {
    const harness = createPipelineHarness()
    const failedRerunSha = '5555555555555555555555555555555555555555'

    await harness.acceptUpload(
      buildEnvelope({
        artifact: buildSimpleArtifact({
          scenarioId: 'scenario-failed-rerun',
          chunkSizes: size(123, 45, 38),
          cssSizes: size(10, 8, 6),
        }),
        git: {
          commitSha: baseSha,
          branch: 'main',
        },
        ci: buildCiContext('5500'),
      }),
    )
    await harness.processAll()

    await harness.acceptUpload(
      buildEnvelope({
        artifact: buildSimpleArtifact({
          scenarioId: 'scenario-failed-rerun',
          chunkSizes: size(123, 45, 38),
          cssSizes: size(10, 8, 6),
        }),
        git: {
          commitSha: failedRerunSha,
          branch: 'feature/failure',
        },
        pullRequest: {
          number: 55,
          baseSha,
          baseRef: 'main',
          headSha: failedRerunSha,
          headRef: 'feature/failure',
        },
        ci: buildCiContext('5501'),
      }),
    )
    await harness.processAll()

    const beforeFailureSummary = await getCommitGroupSummary(failedRerunSha)
    const activeRunId = beforeFailureSummary?.summary.freshScenarioGroups[0]?.activeScenarioRunId
    expect(activeRunId).toBeTruthy()

    await harness.acceptUpload(
      buildEnvelope({
        artifact: buildSimpleArtifact({
          scenarioId: 'scenario-failed-rerun',
          chunkSizes: size(123, 45, 38),
          cssSizes: size(10, 8, 6),
        }),
        git: {
          commitSha: failedRerunSha,
          branch: 'feature/failure',
        },
        pullRequest: {
          number: 55,
          baseSha,
          baseRef: 'main',
          headSha: failedRerunSha,
          headRef: 'feature/failure',
        },
        ci: buildCiContext('5502'),
      }),
    )

    await harness.drainRefresh()

    const failingArtifactKey = await env.DB.prepare(
      `SELECT raw_artifact_r2_key
       FROM scenario_runs
       WHERE commit_sha = ?
       ORDER BY uploaded_at DESC
       LIMIT 1`,
    ).bind(failedRerunSha).first<{ raw_artifact_r2_key: string }>()
    expect(failingArtifactKey?.raw_artifact_r2_key).toBeTruthy()
    await env.RAW_UPLOADS_BUCKET.delete(failingArtifactKey?.raw_artifact_r2_key ?? '')

    await harness.drainNormalize()
    await harness.drainRefresh()

    const commitSummary = await getCommitGroupSummary(failedRerunSha)
    expect(commitSummary?.status).toBe('settled')
    expect(commitSummary?.summary.freshScenarioGroups[0]?.activeScenarioRunId).toBe(activeRunId)
    expect(commitSummary?.summary.freshScenarioGroups[0]?.hasNewerFailedRun).toBe(true)
    expect(commitSummary?.summary.freshScenarioGroups[0]?.latestFailedScenarioRunId).toBeTruthy()
    expect(commitSummary?.summary.counts.impactedScenarioCount).toBe(1)

    const reviewSummary = await getPrReviewSummary(failedRerunSha)
    expect(reviewSummary?.summary.scenarioGroups[0]?.hasNewerFailedRun).toBe(true)
    expect(reviewSummary?.summary.scenarioGroups[0]?.reviewState).toBe('warning')
    expect(reviewSummary?.summary.scenarioGroups[0]?.visibleSeriesId).toBeNull()
  })

  it('treats refresh-summaries replay as idempotent for settled commit and PR summaries', async () => {
    const harness = createPipelineHarness()
    const replaySha = '6666666666666666666666666666666666666666'

    await harness.acceptUpload(
      buildEnvelope({
        artifact: buildSimpleArtifact({
          scenarioId: 'scenario-replay',
          chunkSizes: size(123, 45, 38),
          cssSizes: size(10, 8, 6),
        }),
        git: {
          commitSha: baseSha,
          branch: 'main',
        },
        ci: buildCiContext('5600'),
      }),
    )
    await harness.processAll()

    await harness.acceptUpload(
      buildEnvelope({
        artifact: buildSimpleArtifact({
          scenarioId: 'scenario-replay',
          chunkSizes: size(150, 45, 38),
          cssSizes: size(10, 8, 6),
        }),
        git: {
          commitSha: replaySha,
          branch: 'feature/replay',
        },
        pullRequest: {
          number: 66,
          baseSha,
          baseRef: 'main',
          headSha: replaySha,
          headRef: 'feature/replay',
        },
        ci: buildCiContext('5601'),
      }),
    )
    await harness.processAll()

    const commitSummaryBeforeReplay = await getCommitGroupSummary(replaySha)
    const reviewSummaryBeforeReplay = await getPrReviewSummary(replaySha)
    expect(commitSummaryBeforeReplay).toBeTruthy()
    expect(reviewSummaryBeforeReplay).toBeTruthy()

    const replayRepositoryId = commitSummaryBeforeReplay?.repository_id ?? ''
    const replayCommitGroupId = commitSummaryBeforeReplay?.commit_group_id ?? ''

    await handleRefreshSummariesMessage(
      buildQueueMessage({
        schemaVersion: 1,
        kind: 'refresh-summaries',
        repositoryId: replayRepositoryId,
        commitGroupId: replayCommitGroupId,
        dedupeKey: `refresh-summaries:${replayCommitGroupId}:replay-1:v1`,
      }),
      env,
      harness.logger,
    )
    await handleRefreshSummariesMessage(
      buildQueueMessage({
        schemaVersion: 1,
        kind: 'refresh-summaries',
        repositoryId: replayRepositoryId,
        commitGroupId: replayCommitGroupId,
        dedupeKey: `refresh-summaries:${replayCommitGroupId}:replay-2:v1`,
      }),
      env,
      harness.logger,
    )

    const commitSummaryAfterReplay = await getCommitGroupSummary(replaySha)
    const reviewSummaryAfterReplay = await getPrReviewSummary(replaySha)
    expect(await countRows('commit_group_summaries')).toBe(2)
    expect(await countRows('pr_review_summaries')).toBe(1)
    expect(commitSummaryAfterReplay?.summary_json).toBe(commitSummaryBeforeReplay?.summary_json)
    expect(commitSummaryAfterReplay?.settled_at).toBe(commitSummaryBeforeReplay?.settled_at)
    expect(reviewSummaryAfterReplay?.summary_json).toBe(reviewSummaryBeforeReplay?.summary_json)
    expect(reviewSummaryAfterReplay?.settled_at).toBe(reviewSummaryBeforeReplay?.settled_at)
  })
})

function createPipelineHarness() {
  const logger = buildLogger()
  const normalizeSendSpy = vi.spyOn(env.NORMALIZE_RUN_QUEUE, 'send')
  const deriveSendSpy = vi.spyOn(env.DERIVE_RUN_QUEUE, 'send')
  const scheduleSendSpy = vi.spyOn(env.SCHEDULE_COMPARISONS_QUEUE, 'send')
  const materializeSendSpy = vi.spyOn(env.MATERIALIZE_COMPARISON_QUEUE, 'send')
  const refreshSendSpy = vi.spyOn(env.REFRESH_SUMMARIES_QUEUE, 'send')
  normalizeSendSpy.mockClear()
  deriveSendSpy.mockClear()
  scheduleSendSpy.mockClear()
  materializeSendSpy.mockClear()
  refreshSendSpy.mockClear()

  let normalizeIndex = 0
  let deriveIndex = 0
  let scheduleIndex = 0
  let materializeIndex = 0
  let refreshIndex = 0

  return {
    logger,
    acceptUpload,
    drainDerive,
    drainMaterialize,
    drainNormalize,
    drainRefresh,
    drainSchedule,
    processAll,
  }

  async function acceptUpload(envelope: ReturnType<typeof buildEnvelope>) {
    const response = await sendUploadRequest(envelope)
    expect(response.status).toBe(202)
    return response
  }

  async function drainRefresh() {
    while (refreshIndex < refreshSendSpy.mock.calls.length) {
      const refreshMessageBody = refreshSendSpy.mock.calls[refreshIndex]?.[0]
      refreshIndex += 1
      await handleRefreshSummariesMessage(buildQueueMessage(refreshMessageBody), env, logger)
    }
  }

  async function drainNormalize() {
    while (normalizeIndex < normalizeSendSpy.mock.calls.length) {
      const normalizeMessageBody = normalizeSendSpy.mock.calls[normalizeIndex]?.[0]
      normalizeIndex += 1
      await handleNormalizeRunMessage(buildQueueMessage(normalizeMessageBody), env, logger)
    }
  }

  async function drainDerive() {
    while (deriveIndex < deriveSendSpy.mock.calls.length) {
      const deriveMessageBody = deriveSendSpy.mock.calls[deriveIndex]?.[0]
      deriveIndex += 1
      await handleDeriveRunMessage(buildQueueMessage(deriveMessageBody), env, logger)
    }
  }

  async function drainSchedule() {
    while (scheduleIndex < scheduleSendSpy.mock.calls.length) {
      const scheduleMessageBody = scheduleSendSpy.mock.calls[scheduleIndex]?.[0]
      scheduleIndex += 1
      await handleScheduleComparisonsMessage(buildQueueMessage(scheduleMessageBody), env, logger)
    }
  }

  async function drainMaterialize() {
    while (materializeIndex < materializeSendSpy.mock.calls.length) {
      const materializeMessageBody = materializeSendSpy.mock.calls[materializeIndex]?.[0]
      materializeIndex += 1
      await handleMaterializeComparisonMessage(buildQueueMessage(materializeMessageBody), env, logger)
    }
  }

  async function processAll() {
    await drainRefresh()
    await drainNormalize()
    await drainDerive()
    await drainRefresh()
    await drainSchedule()
    await drainRefresh()
    await drainMaterialize()
    await drainRefresh()
  }
}

async function getCommitGroupSummary(commitSha: string) {
  const row = await env.DB.prepare(
    `SELECT
       id,
       repository_id,
       commit_group_id,
       status,
       settled_at,
       fresh_scenario_count,
       pending_scenario_count,
       inherited_scenario_count,
       missing_scenario_count,
       failed_scenario_count,
       summary_json
     FROM commit_group_summaries
     WHERE commit_sha = ?
     LIMIT 1`,
  ).bind(commitSha).first<{
    id: string
    repository_id: string
    commit_group_id: string
    status: string
    settled_at: string | null
    fresh_scenario_count: number
    pending_scenario_count: number
    inherited_scenario_count: number
    missing_scenario_count: number
    failed_scenario_count: number
    summary_json: string
  }>()

  return row
    ? {
        ...row,
        summary: JSON.parse(row.summary_json),
      }
    : null
}

async function getPrReviewSummary(commitSha: string) {
  const row = await env.DB.prepare(
    `SELECT
       status,
       settled_at,
       regression_count,
       acknowledged_regression_count,
       summary_json
     FROM pr_review_summaries
     WHERE commit_sha = ?
     LIMIT 1`,
  ).bind(commitSha).first<{
    status: string
    settled_at: string | null
    regression_count: number
    acknowledged_regression_count: number
    summary_json: string
  }>()

  return row
    ? {
        ...row,
        summary: JSON.parse(row.summary_json),
      }
    : null
}

function buildQueueMessage(body: unknown) {
  return {
    id: 'msg-1',
    attempts: 1,
    body,
    ack: vi.fn(),
    retry: vi.fn(),
  }
}

function buildLogger() {
  return {
    error: vi.fn(),
    warn: vi.fn(),
  }
}

async function sendUploadRequest(
  envelope: ReturnType<typeof buildEnvelope>,
  token = env.BUNDLE_UPLOAD_TOKEN,
) {
  const executionContext = createExecutionContext()
  const worker = (exports as unknown as {
    default: {
      fetch: (request: Request, env: Cloudflare.Env, ctx: ExecutionContext) => Promise<Response>
    }
  }).default

  const response = await worker.fetch(
    new Request('https://bundle.test/api/v1/uploads/scenario-runs', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(envelope),
    }),
    env,
    executionContext,
  )

  await waitOnExecutionContext(executionContext)

  return response
}

function buildEnvelope(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    artifact: buildSimpleArtifact(),
    repository: {
      githubRepoId: 123,
      owner: 'acme',
      name: 'widget',
      installationId: 456,
    },
    git: {
      commitSha: baseSha,
      branch: 'main',
    },
    scenarioSource: {
      kind: 'fixture-app',
    },
    ci: buildCiContext('999'),
    ...overrides,
  }
}

function buildCiContext(workflowRunId: string) {
  return {
    provider: 'github-actions',
    workflowRunId,
    workflowRunAttempt: 1,
    job: 'build',
    actionVersion: 'v1',
  }
}

function buildSimpleArtifact({
  scenarioId = 'fixture-app-cost',
  generatedAt = '2026-04-06T12:00:00.000Z',
  chunkFileName = 'assets/main.js',
  cssFileName = 'assets/main.css',
  chunkSizes = size(123, 45, 38),
  cssSizes = size(10, 8, 6),
}: {
  chunkFileName?: string
  chunkSizes?: { brotli: number; gzip: number; raw: number }
  cssFileName?: string
  cssSizes?: { brotli: number; gzip: number; raw: number }
  generatedAt?: string
  scenarioId?: string
} = {}) {
  return {
    schemaVersion: 1,
    pluginVersion: '0.1.0',
    generatedAt,
    scenario: {
      id: scenarioId,
      kind: 'fixture-app',
    },
    build: {
      bundler: 'vite',
      bundlerVersion: '8.0.4',
      rootDir: '/tmp/repo',
    },
    environments: [
      {
        name: 'default',
        build: {
          outDir: 'dist',
        },
        manifest: {
          'src/main.ts': {
            file: chunkFileName,
            src: 'src/main.ts',
            isEntry: true,
            css: [cssFileName],
          },
        },
        chunks: [
          {
            fileName: chunkFileName,
            name: 'main',
            isEntry: true,
            isDynamicEntry: false,
            facadeModuleId: '/tmp/repo/src/main.ts',
            imports: [],
            dynamicImports: [],
            implicitlyLoadedBefore: [],
            importedCss: [cssFileName],
            importedAssets: [],
            modules: [
              {
                rawId: '/tmp/repo/src/main.ts',
                renderedLength: chunkSizes.raw,
                originalLength: 456,
              },
            ],
            sizes: chunkSizes,
          },
        ],
        assets: [
          {
            fileName: cssFileName,
            names: ['main.css'],
            needsCodeReference: false,
            sizes: cssSizes,
          },
        ],
        warnings: [],
      },
    ],
  }
}

function size(raw: number, gzip: number, brotli: number) {
  return { raw, gzip, brotli }
}

async function countRows(tableName: string) {
  const result = await env.DB.prepare(`SELECT COUNT(*) AS count FROM ${tableName}`).first<{
    count: number
  }>()

  return result?.count ?? 0
}
