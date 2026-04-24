import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test"
import { env, exports } from "cloudflare:workers"
import { ulid } from "ulid"
import { describe, expect, it, vi } from "vitest"

import { createUploadToken } from "../src/uploads/upload-token.js"
import { dispatchQueueMessage, TEST_QUEUE_NAMES } from "./queue-test-helpers.js"

const baseSha = "0123456789abcdef0123456789abcdef01234567"
const nextSha = "1111111111111111111111111111111111111111"
const laterBaseSha = "2222222222222222222222222222222222222222"
const prHeadSha = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"

describe("comparison and budget jobs", () => {
  it("stores a no-baseline branch comparison for the first processed series", async () => {
    const logger = buildLogger()
    const result = await processEnvelope(
      buildEnvelope({
        git: {
          commitSha: baseSha,
          branch: "main",
        },
        ci: buildCiContext("1000"),
      }),
      logger,
    )

    expect(result.materializeMessageBodies).toHaveLength(0)

    const comparison = await env.DB.prepare(
      `SELECT
         kind,
         status,
         requested_head_sha,
         selected_head_commit_sha,
         selected_base_commit_sha,
         budget_state
       FROM comparisons
       LIMIT 1`,
    ).first<{
      budget_state: string
      kind: string
      requested_head_sha: string
      selected_base_commit_sha: string | null
      selected_head_commit_sha: string
      status: string
    }>()

    expect(comparison).toEqual({
      kind: "branch-previous",
      status: "no-baseline",
      requested_head_sha: baseSha,
      selected_head_commit_sha: baseSha,
      selected_base_commit_sha: null,
      budget_state: "not-configured",
    })
    expect(await countRows("comparisons")).toBe(1)
    expect(await countRows("budget_results")).toBe(0)
  })

  it("materializes branch comparisons with stable-identity summaries and no-op budget state", async () => {
    const logger = buildLogger()

    await processEnvelope(
      buildEnvelope({
        git: {
          commitSha: baseSha,
          branch: "main",
        },
        ci: buildCiContext("1000"),
        artifact: buildSplitBaseArtifact(),
      }),
      logger,
    )

    await processEnvelope(
      buildEnvelope({
        git: {
          commitSha: nextSha,
          branch: "main",
        },
        ci: buildCiContext("1001"),
        artifact: buildSplitHeadArtifact(),
      }),
      logger,
    )

    const comparison = await env.DB.prepare(
      `SELECT
         status,
         selected_base_commit_sha,
         current_total_raw_bytes,
         baseline_total_raw_bytes,
         delta_total_raw_bytes,
         selected_entrypoint_relation,
         stable_identity_summary_json,
         has_degraded_stable_identity,
         budget_state
       FROM comparisons
       WHERE kind = 'branch-previous' AND selected_head_commit_sha = ?`,
    )
      .bind(nextSha)
      .first<{
        baseline_total_raw_bytes: number | null
        budget_state: string
        current_total_raw_bytes: number
        delta_total_raw_bytes: number | null
        has_degraded_stable_identity: number
        selected_base_commit_sha: string | null
        selected_entrypoint_relation: string | null
        stable_identity_summary_json: string | null
        status: string
      }>()

    const stableIdentitySummary = comparison?.stable_identity_summary_json
      ? JSON.parse(comparison.stable_identity_summary_json)
      : null

    expect(comparison).toMatchObject({
      status: "materialized",
      selected_base_commit_sha: baseSha,
      current_total_raw_bytes: 162,
      baseline_total_raw_bytes: 133,
      delta_total_raw_bytes: 29,
      selected_entrypoint_relation: "same",
      has_degraded_stable_identity: 0,
      budget_state: "not-configured",
    })
    expect(stableIdentitySummary).toMatchObject({
      selectedEntrypoint: {
        relation: "same",
      },
      entries: {
        sameCount: 1,
      },
      sharedChunks: {
        splitCount: 1,
      },
      css: {
        splitCount: 1,
      },
      degraded: {
        totalCount: 0,
      },
    })
    expect(await countRows("budget_results")).toBe(0)
  })

  it("keeps PR baseline selection anchored to runs available when the head uploaded", async () => {
    const logger = buildLogger()

    await processEnvelope(
      buildEnvelope({
        git: {
          commitSha: baseSha,
          branch: "main",
        },
        ci: buildCiContext("2000"),
        artifact: buildSimpleArtifact({
          generatedAt: "2026-04-06T12:00:00.000Z",
        }),
      }),
      logger,
    )

    const prResult = await processEnvelope(
      buildEnvelope({
        git: {
          commitSha: prHeadSha,
          branch: "feature/login",
        },
        pullRequest: {
          number: 42,
          baseSha,
          baseRef: "main",
          headSha: prHeadSha,
          headRef: "feature/login",
        },
        ci: buildCiContext("2001"),
        artifact: buildSimpleArtifact({
          generatedAt: "2026-04-06T12:10:00.000Z",
          chunkFileName: "assets/main-pr.js",
          cssFileName: "assets/main-pr.css",
          chunkSizes: size(140, 50, 40),
          cssSizes: size(11, 8, 6),
        }),
      }),
      logger,
    )

    await processEnvelope(
      buildEnvelope({
        git: {
          commitSha: laterBaseSha,
          branch: "main",
        },
        ci: buildCiContext("2002"),
        artifact: buildSimpleArtifact({
          generatedAt: "2026-04-06T12:20:00.000Z",
          chunkFileName: "assets/main-late.js",
          cssFileName: "assets/main-late.css",
          chunkSizes: size(170, 61, 48),
          cssSizes: size(14, 10, 8),
        }),
      }),
      logger,
    )

    const materializeSendSpy = vi.spyOn(env.MATERIALIZE_COMPARISON_QUEUE, "send")
    materializeSendSpy.mockClear()

    for (const scheduleMessageBody of prResult.scheduleMessageBodies) {
      const scheduleResult = await dispatchQueueMessage(
        TEST_QUEUE_NAMES.scheduleComparisons,
        scheduleMessageBody,
      )
      expect(scheduleResult).toBeAcknowledged()
    }

    for (const materializeMessageBody of materializeSendSpy.mock.calls.map((call) => call[0])) {
      const materializeResult = await dispatchQueueMessage(
        TEST_QUEUE_NAMES.materializeComparison,
        materializeMessageBody,
      )
      expect(materializeResult).toBeAcknowledged()
    }

    const comparison = await env.DB.prepare(
      `SELECT
         status,
         requested_base_sha,
         selected_base_commit_sha,
         selected_head_commit_sha,
         budget_state
       FROM comparisons
       WHERE kind = 'pr-base' AND selected_head_commit_sha = ?`,
    )
      .bind(prHeadSha)
      .first<{
        budget_state: string
        requested_base_sha: string | null
        selected_base_commit_sha: string | null
        selected_head_commit_sha: string
        status: string
      }>()

    expect(comparison).toEqual({
      status: "materialized",
      requested_base_sha: baseSha,
      selected_base_commit_sha: baseSha,
      selected_head_commit_sha: prHeadSha,
      budget_state: "not-configured",
    })
    expect(comparison?.selected_base_commit_sha).not.toBe(laterBaseSha)
    expect(await countRows("comparisons")).toBe(4)
    expect(await countRows("budget_results")).toBe(0)
  })

  it("acks invalid schedule-comparisons messages instead of retrying them", async () => {
    const result = await dispatchQueueMessage(TEST_QUEUE_NAMES.scheduleComparisons, {
      schemaVersion: 1,
      kind: "schedule-comparisons",
      repositoryId: "01ARZ3NDEKTSV4RRFFQ69G5FAV",
      dedupeKey: "schedule-comparisons:test:v1",
    })
    expect(result).toBeAcknowledged()
  })

  it("acks invalid materialize-comparison messages instead of retrying them", async () => {
    const result = await dispatchQueueMessage(TEST_QUEUE_NAMES.materializeComparison, {
      schemaVersion: 1,
      kind: "materialize-comparison",
      repositoryId: "01ARZ3NDEKTSV4RRFFQ69G5FAV",
      dedupeKey: "materialize-comparison:test:v1",
    })
    expect(result).toBeAcknowledged()
  })

  it("retries transient schedule-comparisons failures without duplicating comparison rows", async () => {
    const logger = buildLogger()

    await processEnvelope(
      buildEnvelope({
        git: {
          commitSha: baseSha,
          branch: "main",
        },
        ci: buildCiContext("3000"),
      }),
      logger,
    )

    const nextResult = await processEnvelope(
      buildEnvelope({
        git: {
          commitSha: nextSha,
          branch: "main",
        },
        ci: buildCiContext("3001"),
        artifact: buildSimpleArtifact({
          generatedAt: "2026-04-06T12:10:00.000Z",
          chunkFileName: "assets/main-next.js",
          cssFileName: "assets/main-next.css",
          chunkSizes: size(150, 54, 43),
          cssSizes: size(12, 9, 7),
        }),
      }),
      logger,
      {
        runSchedule: false,
        runMaterialize: false,
      },
    )

    const sendSpy = vi
      .spyOn(env.MATERIALIZE_COMPARISON_QUEUE, "send")
      .mockRejectedValueOnce(new Error("queue unavailable"))

    const firstResult = await dispatchQueueMessage(
      TEST_QUEUE_NAMES.scheduleComparisons,
      nextResult.scheduleMessageBodies[0],
    )
    expect(firstResult).toBeRetried()
    expect(await countRows("comparisons")).toBe(2)

    const secondResult = await dispatchQueueMessage(
      TEST_QUEUE_NAMES.scheduleComparisons,
      nextResult.scheduleMessageBodies[0],
    )
    expect(secondResult).toBeAcknowledged()
    expect(sendSpy).toHaveBeenCalledTimes(2)
    expect(await countRows("comparisons")).toBe(2)
  })

  it("retries transient materialize-comparison failures and later succeeds", async () => {
    const logger = buildLogger()

    await processEnvelope(
      buildEnvelope({
        git: {
          commitSha: baseSha,
          branch: "main",
        },
        ci: buildCiContext("3010"),
      }),
      logger,
    )

    const nextResult = await processEnvelope(
      buildEnvelope({
        git: {
          commitSha: nextSha,
          branch: "main",
        },
        ci: buildCiContext("3011"),
        artifact: buildSimpleArtifact({
          generatedAt: "2026-04-06T12:10:00.000Z",
          chunkFileName: "assets/main-next.js",
          cssFileName: "assets/main-next.css",
          chunkSizes: size(150, 54, 43),
          cssSizes: size(12, 9, 7),
        }),
      }),
      logger,
      {
        runMaterialize: false,
      },
    )

    const getSpy = vi
      .spyOn(env.CACHE_BUCKET, "get")
      .mockRejectedValueOnce(new Error("bucket unavailable"))

    const firstResult = await dispatchQueueMessage(
      TEST_QUEUE_NAMES.materializeComparison,
      nextResult.materializeMessageBodies[0],
    )
    expect(firstResult).toBeRetried()

    const queuedComparison = await env.DB.prepare(
      `SELECT status
       FROM comparisons
       WHERE kind = 'branch-previous' AND selected_head_commit_sha = ?`,
    )
      .bind(nextSha)
      .first<{ status: string }>()

    expect(queuedComparison?.status).toBe("queued")

    const secondResult = await dispatchQueueMessage(
      TEST_QUEUE_NAMES.materializeComparison,
      nextResult.materializeMessageBodies[0],
    )
    expect(secondResult).toBeAcknowledged()
    expect(getSpy).toHaveBeenCalled()

    const materializedComparison = await env.DB.prepare(
      `SELECT status
       FROM comparisons
       WHERE kind = 'branch-previous' AND selected_head_commit_sha = ?`,
    )
      .bind(nextSha)
      .first<{ status: string }>()

    expect(materializedComparison?.status).toBe("materialized")
  })

  it("keeps schedule-comparisons idempotent when the same message is replayed", async () => {
    const logger = buildLogger()

    await processEnvelope(
      buildEnvelope({
        git: {
          commitSha: baseSha,
          branch: "main",
        },
        ci: buildCiContext("3020"),
      }),
      logger,
    )

    const nextResult = await processEnvelope(
      buildEnvelope({
        git: {
          commitSha: nextSha,
          branch: "main",
        },
        ci: buildCiContext("3021"),
        artifact: buildSimpleArtifact({
          generatedAt: "2026-04-06T12:10:00.000Z",
          chunkFileName: "assets/main-next.js",
          cssFileName: "assets/main-next.css",
          chunkSizes: size(150, 54, 43),
          cssSizes: size(12, 9, 7),
        }),
      }),
      logger,
      {
        runSchedule: false,
        runMaterialize: false,
      },
    )

    const firstResult = await dispatchQueueMessage(
      TEST_QUEUE_NAMES.scheduleComparisons,
      nextResult.scheduleMessageBodies[0],
    )
    const secondResult = await dispatchQueueMessage(
      TEST_QUEUE_NAMES.scheduleComparisons,
      nextResult.scheduleMessageBodies[0],
    )
    expect(firstResult).toBeAcknowledged()
    expect(secondResult).toBeAcknowledged()

    const count = await env.DB.prepare(
      `SELECT COUNT(*) AS count
       FROM comparisons
       WHERE kind = 'branch-previous' AND selected_head_commit_sha = ?`,
    )
      .bind(nextSha)
      .first<{ count: number }>()

    expect(count?.count).toBe(1)
    expect(await countRows("comparisons")).toBe(2)
  })

  it("treats an already-materialized comparison as idempotent", async () => {
    const logger = buildLogger()

    await processEnvelope(
      buildEnvelope({
        git: {
          commitSha: baseSha,
          branch: "main",
        },
        ci: buildCiContext("3030"),
      }),
      logger,
    )

    const nextResult = await processEnvelope(
      buildEnvelope({
        git: {
          commitSha: nextSha,
          branch: "main",
        },
        ci: buildCiContext("3031"),
        artifact: buildSimpleArtifact({
          generatedAt: "2026-04-06T12:10:00.000Z",
          chunkFileName: "assets/main-next.js",
          cssFileName: "assets/main-next.css",
          chunkSizes: size(150, 54, 43),
          cssSizes: size(12, 9, 7),
        }),
      }),
      logger,
      {
        runMaterialize: false,
      },
    )

    const materializeMessageBody = nextResult.materializeMessageBodies[0]

    const firstResult = await dispatchQueueMessage(
      TEST_QUEUE_NAMES.materializeComparison,
      materializeMessageBody,
    )
    expect(firstResult).toBeAcknowledged()

    const beforeReplay = await env.DB.prepare(
      `SELECT status, stable_identity_summary_json
       FROM comparisons
       WHERE kind = 'branch-previous' AND selected_head_commit_sha = ?`,
    )
      .bind(nextSha)
      .first<{
        stable_identity_summary_json: string | null
        status: string
      }>()

    const secondResult = await dispatchQueueMessage(
      TEST_QUEUE_NAMES.materializeComparison,
      materializeMessageBody,
    )
    expect(secondResult).toBeAcknowledged()

    const afterReplay = await env.DB.prepare(
      `SELECT status, stable_identity_summary_json
       FROM comparisons
       WHERE kind = 'branch-previous' AND selected_head_commit_sha = ?`,
    )
      .bind(nextSha)
      .first<{
        stable_identity_summary_json: string | null
        status: string
      }>()

    expect(beforeReplay).toEqual(afterReplay)
    expect(afterReplay?.status).toBe("materialized")
    expect(await countRows("budget_results")).toBe(0)
  })

  it("stores a PR comparison with no baseline when no processed base-branch run exists", async () => {
    const logger = buildLogger()

    await processEnvelope(
      buildEnvelope({
        git: {
          commitSha: prHeadSha,
          branch: "feature/empty-base",
        },
        pullRequest: {
          number: 7,
          baseSha: baseSha,
          baseRef: "main",
          headSha: prHeadSha,
          headRef: "feature/empty-base",
        },
        ci: buildCiContext("3040"),
      }),
      logger,
    )

    const comparison = await env.DB.prepare(
      `SELECT status, selected_base_commit_sha
       FROM comparisons
       WHERE kind = 'pr-base' AND selected_head_commit_sha = ?`,
    )
      .bind(prHeadSha)
      .first<{
        selected_base_commit_sha: string | null
        status: string
      }>()

    expect(comparison).toEqual({
      status: "no-baseline",
      selected_base_commit_sha: null,
    })
  })

  it("selects the latest eligible PR base-branch candidate before the head upload cutoff", async () => {
    const logger = buildLogger()
    const middleBaseSha = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"

    await processEnvelope(
      buildEnvelope({
        git: {
          commitSha: baseSha,
          branch: "main",
        },
        ci: buildCiContext("3050"),
        artifact: buildSimpleArtifact({
          generatedAt: "2026-04-06T12:00:00.000Z",
        }),
      }),
      logger,
    )

    await processEnvelope(
      buildEnvelope({
        git: {
          commitSha: middleBaseSha,
          branch: "main",
        },
        ci: buildCiContext("3051"),
        artifact: buildSimpleArtifact({
          generatedAt: "2026-04-06T12:05:00.000Z",
          chunkFileName: "assets/main-middle.js",
          cssFileName: "assets/main-middle.css",
          chunkSizes: size(132, 48, 39),
          cssSizes: size(11, 8, 6),
        }),
      }),
      logger,
    )

    await processEnvelope(
      buildEnvelope({
        git: {
          commitSha: prHeadSha,
          branch: "feature/login",
        },
        pullRequest: {
          number: 42,
          baseSha: middleBaseSha,
          baseRef: "main",
          headSha: prHeadSha,
          headRef: "feature/login",
        },
        ci: buildCiContext("3052"),
        artifact: buildSimpleArtifact({
          generatedAt: "2026-04-06T12:10:00.000Z",
          chunkFileName: "assets/main-pr.js",
          cssFileName: "assets/main-pr.css",
          chunkSizes: size(140, 50, 40),
          cssSizes: size(11, 8, 6),
        }),
      }),
      logger,
    )

    const comparison = await env.DB.prepare(
      `SELECT selected_base_commit_sha
       FROM comparisons
       WHERE kind = 'pr-base' AND selected_head_commit_sha = ?`,
    )
      .bind(prHeadSha)
      .first<{ selected_base_commit_sha: string | null }>()

    expect(comparison?.selected_base_commit_sha).toBe(middleBaseSha)
  })

  it("skips earlier reruns from the same commit group when selecting a branch baseline", async () => {
    const logger = buildLogger()
    const branchHeadSha = "cccccccccccccccccccccccccccccccccccccccc"

    await processEnvelope(
      buildEnvelope({
        git: {
          commitSha: baseSha,
          branch: "main",
        },
        ci: buildCiContext("3060"),
        artifact: buildSimpleArtifact({
          generatedAt: "2026-04-06T12:00:00.000Z",
        }),
      }),
      logger,
    )

    await processEnvelope(
      buildEnvelope({
        git: {
          commitSha: branchHeadSha,
          branch: "main",
        },
        ci: buildCiContext("3061"),
        artifact: buildSimpleArtifact({
          generatedAt: "2026-04-06T12:10:00.000Z",
          chunkFileName: "assets/main-first.js",
          cssFileName: "assets/main-first.css",
          chunkSizes: size(140, 50, 40),
          cssSizes: size(11, 8, 6),
        }),
      }),
      logger,
    )

    const rerunResult = await processEnvelope(
      buildEnvelope({
        git: {
          commitSha: branchHeadSha,
          branch: "main",
        },
        ci: buildCiContext("3062"),
        artifact: buildSimpleArtifact({
          generatedAt: "2026-04-06T12:20:00.000Z",
          chunkFileName: "assets/main-rerun.js",
          cssFileName: "assets/main-rerun.css",
          chunkSizes: size(150, 54, 43),
          cssSizes: size(12, 9, 7),
        }),
      }),
      logger,
    )

    const rerunScenarioRunId = (rerunResult.scheduleMessageBodies[0] as { scenarioRunId: string })
      .scenarioRunId
    const comparison = await env.DB.prepare(
      `SELECT selected_base_commit_sha
       FROM comparisons
       WHERE kind = 'branch-previous' AND head_scenario_run_id = ?`,
    )
      .bind(rerunScenarioRunId)
      .first<{ selected_base_commit_sha: string | null }>()

    expect(comparison?.selected_base_commit_sha).toBe(baseSha)
  })

  it("schedules and materializes one comparison per series for multi-entry runs", async () => {
    const logger = buildLogger()

    await processEnvelope(
      buildEnvelope({
        git: {
          commitSha: baseSha,
          branch: "main",
        },
        ci: buildCiContext("3070"),
        artifact: buildMultiEntrypointArtifact(),
      }),
      logger,
    )

    await processEnvelope(
      buildEnvelope({
        git: {
          commitSha: nextSha,
          branch: "main",
        },
        ci: buildCiContext("3071"),
        artifact: buildMultiEntrypointArtifact({
          generatedAt: "2026-04-06T12:10:00.000Z",
          mainChunkSizes: size(135, 49, 39),
          adminChunkSizes: size(102, 37, 30),
        }),
      }),
      logger,
    )

    const comparisonCount = await env.DB.prepare(
      `SELECT COUNT(*) AS count
       FROM comparisons
       WHERE kind = 'branch-previous' AND selected_head_commit_sha = ? AND status = 'materialized'`,
    )
      .bind(nextSha)
      .first<{ count: number }>()

    expect(comparisonCount?.count).toBe(2)
  })

  it("persists merge stable-identity summaries", async () => {
    const logger = buildLogger()
    const mergeHeadSha = "dddddddddddddddddddddddddddddddddddddddd"

    await processEnvelope(
      buildEnvelope({
        git: {
          commitSha: baseSha,
          branch: "main",
        },
        ci: buildCiContext("3080"),
        artifact: buildMergeBaseArtifact(),
      }),
      logger,
    )

    await processEnvelope(
      buildEnvelope({
        git: {
          commitSha: mergeHeadSha,
          branch: "main",
        },
        ci: buildCiContext("3081"),
        artifact: buildMergeHeadArtifact(),
      }),
      logger,
    )

    const comparison = await env.DB.prepare(
      `SELECT stable_identity_summary_json, has_degraded_stable_identity
       FROM comparisons
       WHERE kind = 'branch-previous' AND selected_head_commit_sha = ?`,
    )
      .bind(mergeHeadSha)
      .first<{
        has_degraded_stable_identity: number
        stable_identity_summary_json: string | null
      }>()

    const summary = comparison?.stable_identity_summary_json
      ? JSON.parse(comparison.stable_identity_summary_json)
      : null

    expect(summary).toMatchObject({
      sharedChunks: {
        mergeCount: 1,
      },
      degraded: {
        totalCount: 0,
      },
    })
    expect(comparison?.has_degraded_stable_identity).toBe(0)
  })

  it("persists low-confidence stable-identity matches as degraded results", async () => {
    const logger = buildLogger()
    const lowConfidenceHeadSha = "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"

    await processEnvelope(
      buildEnvelope({
        git: {
          commitSha: baseSha,
          branch: "main",
        },
        ci: buildCiContext("3090"),
        artifact: buildLowConfidenceBaseArtifact(),
      }),
      logger,
    )

    await processEnvelope(
      buildEnvelope({
        git: {
          commitSha: lowConfidenceHeadSha,
          branch: "main",
        },
        ci: buildCiContext("3091"),
        artifact: buildLowConfidenceHeadArtifact(),
      }),
      logger,
    )

    const comparison = await env.DB.prepare(
      `SELECT stable_identity_summary_json, has_degraded_stable_identity
       FROM comparisons
       WHERE kind = 'branch-previous' AND selected_head_commit_sha = ?`,
    )
      .bind(lowConfidenceHeadSha)
      .first<{
        has_degraded_stable_identity: number
        stable_identity_summary_json: string | null
      }>()

    const summary = comparison?.stable_identity_summary_json
      ? JSON.parse(comparison.stable_identity_summary_json)
      : null

    expect(summary).toMatchObject({
      sharedChunks: {
        lowConfidenceSameCount: 1,
      },
      degraded: {
        totalCount: 1,
      },
    })
    expect(comparison?.has_degraded_stable_identity).toBe(1)
  })

  it("persists ambiguous stable-identity matches as degraded results", async () => {
    const logger = buildLogger()
    const ambiguousHeadSha = "ffffffffffffffffffffffffffffffffffffffff"

    await processEnvelope(
      buildEnvelope({
        git: {
          commitSha: baseSha,
          branch: "main",
        },
        ci: buildCiContext("3100"),
        artifact: buildAmbiguousBaseArtifact(),
      }),
      logger,
    )

    await processEnvelope(
      buildEnvelope({
        git: {
          commitSha: ambiguousHeadSha,
          branch: "main",
        },
        ci: buildCiContext("3101"),
        artifact: buildAmbiguousHeadArtifact(),
      }),
      logger,
    )

    const comparison = await env.DB.prepare(
      `SELECT stable_identity_summary_json, has_degraded_stable_identity
       FROM comparisons
       WHERE kind = 'branch-previous' AND selected_head_commit_sha = ?`,
    )
      .bind(ambiguousHeadSha)
      .first<{
        has_degraded_stable_identity: number
        stable_identity_summary_json: string | null
      }>()

    const summary = comparison?.stable_identity_summary_json
      ? JSON.parse(comparison.stable_identity_summary_json)
      : null

    expect(summary).toMatchObject({
      sharedChunks: {
        ambiguousCount: 1,
      },
      degraded: {
        totalCount: 1,
      },
    })
    expect(comparison?.has_degraded_stable_identity).toBe(1)
  })

  it("marks the comparison as failed when the selected environment is missing from a snapshot", async () => {
    const logger = buildLogger()

    await processEnvelope(
      buildEnvelope({
        git: {
          commitSha: baseSha,
          branch: "main",
        },
        ci: buildCiContext("3110"),
      }),
      logger,
    )

    const nextResult = await processEnvelope(
      buildEnvelope({
        git: {
          commitSha: nextSha,
          branch: "main",
        },
        ci: buildCiContext("3111"),
        artifact: buildSimpleArtifact({
          generatedAt: "2026-04-06T12:10:00.000Z",
          chunkFileName: "assets/main-next.js",
          cssFileName: "assets/main-next.css",
          chunkSizes: size(150, 54, 43),
          cssSizes: size(12, 9, 7),
        }),
      }),
      logger,
      {
        runMaterialize: false,
      },
    )

    const comparisonMeta = await env.DB.prepare(
      `SELECT c.id, sr.normalized_snapshot_r2_key AS base_snapshot_key
       FROM comparisons c
       JOIN scenario_runs sr ON sr.id = c.base_scenario_run_id
       WHERE c.kind = 'branch-previous' AND c.selected_head_commit_sha = ?`,
    )
      .bind(nextSha)
      .first<{
        base_snapshot_key: string
        id: string
      }>()

    const snapshotObject = await env.CACHE_BUCKET.get(comparisonMeta!.base_snapshot_key)
    const snapshot = JSON.parse(await snapshotObject!.text()) as {
      environments: Array<{ name: string }>
    }
    snapshot.environments[0]!.name = "server"
    await env.CACHE_BUCKET.put(
      comparisonMeta!.base_snapshot_key,
      `${JSON.stringify(snapshot, null, 2)}\n`,
      {
        httpMetadata: {
          contentType: "application/json",
        },
      },
    )

    const result = await dispatchQueueMessage(
      TEST_QUEUE_NAMES.materializeComparison,
      nextResult.materializeMessageBodies[0],
    )

    const failedComparison = await env.DB.prepare(
      `SELECT status, failure_code
       FROM comparisons
       WHERE id = ?`,
    )
      .bind(comparisonMeta!.id)
      .first<{
        failure_code: string | null
        status: string
      }>()

    expect(result).toBeAcknowledged()
    expect(failedComparison).toEqual({
      status: "failed",
      failure_code: "environment_missing",
    })
  })

  it("marks the comparison as failed when a normalized snapshot object is missing", async () => {
    const logger = buildLogger()

    await processEnvelope(
      buildEnvelope({
        git: {
          commitSha: baseSha,
          branch: "main",
        },
        ci: buildCiContext("3120"),
      }),
      logger,
    )

    const nextResult = await processEnvelope(
      buildEnvelope({
        git: {
          commitSha: nextSha,
          branch: "main",
        },
        ci: buildCiContext("3121"),
        artifact: buildSimpleArtifact({
          generatedAt: "2026-04-06T12:10:00.000Z",
          chunkFileName: "assets/main-next.js",
          cssFileName: "assets/main-next.css",
          chunkSizes: size(150, 54, 43),
          cssSizes: size(12, 9, 7),
        }),
      }),
      logger,
      {
        runMaterialize: false,
      },
    )

    const comparisonMeta = await env.DB.prepare(
      `SELECT c.id, sr.normalized_snapshot_r2_key AS base_snapshot_key
       FROM comparisons c
       JOIN scenario_runs sr ON sr.id = c.base_scenario_run_id
       WHERE c.kind = 'branch-previous' AND c.selected_head_commit_sha = ?`,
    )
      .bind(nextSha)
      .first<{
        base_snapshot_key: string
        id: string
      }>()

    await env.CACHE_BUCKET.delete(comparisonMeta!.base_snapshot_key)

    const result = await dispatchQueueMessage(
      TEST_QUEUE_NAMES.materializeComparison,
      nextResult.materializeMessageBodies[0],
    )
    expect(result).toBeAcknowledged()

    const failedComparison = await env.DB.prepare(
      `SELECT status, failure_code
       FROM comparisons
       WHERE id = ?`,
    )
      .bind(comparisonMeta!.id)
      .first<{
        failure_code: string | null
        status: string
      }>()

    expect(failedComparison).toEqual({
      status: "failed",
      failure_code: "normalized_snapshot_missing",
    })
  })

  it("marks the comparison as failed when a normalized snapshot object becomes invalid JSON data", async () => {
    const logger = buildLogger()

    await processEnvelope(
      buildEnvelope({
        git: {
          commitSha: baseSha,
          branch: "main",
        },
        ci: buildCiContext("3130"),
      }),
      logger,
    )

    const nextResult = await processEnvelope(
      buildEnvelope({
        git: {
          commitSha: nextSha,
          branch: "main",
        },
        ci: buildCiContext("3131"),
        artifact: buildSimpleArtifact({
          generatedAt: "2026-04-06T12:10:00.000Z",
          chunkFileName: "assets/main-next.js",
          cssFileName: "assets/main-next.css",
          chunkSizes: size(150, 54, 43),
          cssSizes: size(12, 9, 7),
        }),
      }),
      logger,
      {
        runMaterialize: false,
      },
    )

    const comparisonMeta = await env.DB.prepare(
      `SELECT c.id, sr.normalized_snapshot_r2_key AS base_snapshot_key
       FROM comparisons c
       JOIN scenario_runs sr ON sr.id = c.base_scenario_run_id
       WHERE c.kind = 'branch-previous' AND c.selected_head_commit_sha = ?`,
    )
      .bind(nextSha)
      .first<{
        base_snapshot_key: string
        id: string
      }>()

    await env.CACHE_BUCKET.put(comparisonMeta!.base_snapshot_key, "{}", {
      httpMetadata: {
        contentType: "application/json",
      },
    })

    const result = await dispatchQueueMessage(
      TEST_QUEUE_NAMES.materializeComparison,
      nextResult.materializeMessageBodies[0],
    )
    expect(result).toBeAcknowledged()

    const failedComparison = await env.DB.prepare(
      `SELECT status, failure_code
       FROM comparisons
       WHERE id = ?`,
    )
      .bind(comparisonMeta!.id)
      .first<{
        failure_code: string | null
        status: string
      }>()

    expect(failedComparison).toEqual({
      status: "failed",
      failure_code: "invalid_normalized_snapshot",
    })
  })

  it("keeps dynamic-entry continuity in Step 7 comparisons", async () => {
    const logger = buildLogger()
    const dynamicHeadSha = "9999999999999999999999999999999999999999"

    await processEnvelope(
      buildEnvelope({
        git: {
          commitSha: baseSha,
          branch: "main",
        },
        ci: buildCiContext("3140"),
        artifact: buildDynamicEntrypointArtifact(),
      }),
      logger,
    )

    await processEnvelope(
      buildEnvelope({
        git: {
          commitSha: dynamicHeadSha,
          branch: "main",
        },
        ci: buildCiContext("3141"),
        artifact: buildDynamicEntrypointArtifact({
          generatedAt: "2026-04-06T12:10:00.000Z",
          lazyFileName: "chunks/lazy-new.js",
          lazyCssFileName: "assets/lazy-new.css",
        }),
      }),
      logger,
    )

    const comparison = await env.DB.prepare(
      `SELECT c.selected_entrypoint_relation, c.stable_identity_summary_json
       FROM comparisons c
       JOIN series s ON s.id = c.series_id
       WHERE c.kind = 'branch-previous'
         AND c.selected_head_commit_sha = ?
         AND s.entrypoint_kind = 'dynamic-entry'`,
    )
      .bind(dynamicHeadSha)
      .first<{
        selected_entrypoint_relation: string | null
        stable_identity_summary_json: string | null
      }>()

    const summary = comparison?.stable_identity_summary_json
      ? JSON.parse(comparison.stable_identity_summary_json)
      : null

    expect(comparison?.selected_entrypoint_relation).toBe("same")
    expect(summary).toMatchObject({
      dynamicEntries: {
        sameCount: 1,
      },
    })
  })

  it("keeps manifest-only HTML entrypoint continuity in Step 7 comparisons", async () => {
    const logger = buildLogger()
    const htmlHeadSha = "8888888888888888888888888888888888888888"

    await processEnvelope(
      buildEnvelope({
        git: {
          commitSha: baseSha,
          branch: "main",
        },
        ci: buildCiContext("3150"),
        artifact: buildManifestOnlyHtmlArtifact(),
      }),
      logger,
    )

    await processEnvelope(
      buildEnvelope({
        git: {
          commitSha: htmlHeadSha,
          branch: "main",
        },
        ci: buildCiContext("3151"),
        artifact: buildManifestOnlyHtmlArtifact({
          generatedAt: "2026-04-06T12:10:00.000Z",
          jsFileName: "assets/main-new.js",
          cssFileName: "assets/main-new.css",
        }),
      }),
      logger,
    )

    const comparison = await env.DB.prepare(
      `SELECT c.selected_entrypoint_relation, c.selected_entrypoint_evidence_json
       FROM comparisons c
       JOIN series s ON s.id = c.series_id
       WHERE c.kind = 'branch-previous'
         AND c.selected_head_commit_sha = ?
         AND s.entrypoint_key = 'index.html'`,
    )
      .bind(htmlHeadSha)
      .first<{
        selected_entrypoint_evidence_json: string | null
        selected_entrypoint_relation: string | null
      }>()

    expect(comparison?.selected_entrypoint_relation).toBe("same")
    expect(comparison?.selected_entrypoint_evidence_json).toContain("identity:index.html")
  })
})

async function processEnvelope(
  envelope: ReturnType<typeof buildEnvelope>,
  _logger = buildLogger(),
  {
    runSchedule = true,
    runMaterialize = true,
  }: {
    runMaterialize?: boolean
    runSchedule?: boolean
  } = {},
) {
  const normalizeSendSpy = vi.spyOn(env.NORMALIZE_RUN_QUEUE, "send")
  const deriveSendSpy = vi.spyOn(env.DERIVE_RUN_QUEUE, "send")
  const scheduleSendSpy = vi.spyOn(env.SCHEDULE_COMPARISONS_QUEUE, "send")
  const materializeSendSpy = vi.spyOn(env.MATERIALIZE_COMPARISON_QUEUE, "send")
  normalizeSendSpy.mockClear()
  deriveSendSpy.mockClear()
  scheduleSendSpy.mockClear()
  materializeSendSpy.mockClear()

  const response = await sendUploadRequest(envelope)
  expect(response.status).toBe(202)

  const normalizeMessageBody = normalizeSendSpy.mock.calls.at(-1)?.[0]
  const normalizeResult = await dispatchQueueMessage(
    TEST_QUEUE_NAMES.normalizeRun,
    normalizeMessageBody,
  )
  expect(normalizeResult).toBeAcknowledged()

  const deriveMessageBody = deriveSendSpy.mock.calls.at(-1)?.[0]
  const deriveResult = await dispatchQueueMessage(TEST_QUEUE_NAMES.deriveRun, deriveMessageBody)
  expect(deriveResult).toBeAcknowledged()

  const scheduleMessageBodies = scheduleSendSpy.mock.calls.map((call) => call[0])

  if (runSchedule) {
    for (const scheduleMessageBody of scheduleMessageBodies) {
      const scheduleResult = await dispatchQueueMessage(
        TEST_QUEUE_NAMES.scheduleComparisons,
        scheduleMessageBody,
      )
      expect(scheduleResult).toBeAcknowledged()
    }
  }

  const materializeMessageBodies = materializeSendSpy.mock.calls.map((call) => call[0])

  if (runMaterialize) {
    for (const materializeMessageBody of materializeMessageBodies) {
      const materializeResult = await dispatchQueueMessage(
        TEST_QUEUE_NAMES.materializeComparison,
        materializeMessageBody,
      )
      expect(materializeResult).toBeAcknowledged()
    }
  }

  return {
    scheduleMessageBodies,
    materializeMessageBodies,
  }
}

function buildLogger() {
  return {
    error: vi.fn(),
    warn: vi.fn(),
  }
}

async function sendUploadRequest(envelope: ReturnType<typeof buildEnvelope>, token?: string) {
  const uploadToken = token ?? (await createTestUploadToken(envelope))
  const executionContext = createExecutionContext()
  const worker = (
    exports as unknown as {
      default: {
        fetch: (request: Request, env: Cloudflare.Env, ctx: ExecutionContext) => Promise<Response>
      }
    }
  ).default

  const response = await worker.fetch(
    new Request("https://bundle.test/api/v1/uploads/scenario-runs", {
      method: "POST",
      headers: {
        authorization: `Bearer ${uploadToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(envelope),
    }),
    env,
    executionContext,
  )

  await waitOnExecutionContext(executionContext)

  return response
}

async function createTestUploadToken(envelope: ReturnType<typeof buildEnvelope>) {
  const timestamp = new Date().toISOString()

  await env.DB.prepare(
    `INSERT INTO repositories (
      id,
      github_repo_id,
      owner,
      name,
      installation_id,
      enabled,
      visibility,
      created_at,
      updated_at
    )
    VALUES (?, ?, ?, ?, ?, 1, 'public', ?, ?)
    ON CONFLICT(github_repo_id) DO UPDATE SET
      owner = excluded.owner,
      name = excluded.name,
      installation_id = excluded.installation_id,
      enabled = 1,
      visibility = 'public',
      disabled_at = NULL,
      deleted_at = NULL,
      updated_at = excluded.updated_at`,
  )
    .bind(
      ulid(),
      envelope.repository.githubRepoId,
      envelope.repository.owner,
      envelope.repository.name,
      envelope.repository.installationId,
      timestamp,
      timestamp,
    )
    .run()

  const repository = await env.DB.prepare(
    "SELECT id FROM repositories WHERE github_repo_id = ? LIMIT 1",
  )
    .bind(envelope.repository.githubRepoId)
    .first<{ id: string }>()

  if (!repository) {
    throw new Error("Could not prepare repository for upload test.")
  }

  return createUploadToken(env, {
    commitSha: envelope.git.commitSha,
    githubRepoId: envelope.repository.githubRepoId,
    installationId: envelope.repository.installationId,
    owner: envelope.repository.owner,
    repositoryId: repository.id,
    repositoryName: envelope.repository.name,
    runAttempt: envelope.ci.workflowRunAttempt,
    runId: envelope.ci.workflowRunId,
  })
}

async function countRows(tableName: string) {
  const result = await env.DB.prepare(`SELECT COUNT(*) AS count FROM ${tableName}`).first<{
    count: number
  }>()

  return result?.count ?? 0
}

function buildEnvelope(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    artifact: buildSimpleArtifact(),
    repository: {
      githubRepoId: 123,
      owner: "acme",
      name: "widget",
      installationId: 456,
    },
    git: {
      commitSha: baseSha,
      branch: "main",
    },
    scenarioSource: {
      kind: "fixture-app",
    },
    ci: buildCiContext("999"),
    ...overrides,
  }
}

function buildCiContext(workflowRunId: string) {
  return {
    provider: "github-actions",
    workflowRunId,
    workflowRunAttempt: 1,
    job: "build",
    actionVersion: "v1",
  }
}

function buildSimpleArtifact({
  generatedAt = "2026-04-06T12:00:00.000Z",
  chunkFileName = "assets/main.js",
  cssFileName = "assets/main.css",
  chunkSizes = size(123, 45, 38),
  cssSizes = size(10, 8, 6),
}: {
  chunkFileName?: string
  chunkSizes?: { brotli: number; gzip: number; raw: number }
  cssFileName?: string
  cssSizes?: { brotli: number; gzip: number; raw: number }
  generatedAt?: string
} = {}) {
  return {
    schemaVersion: 1,
    pluginVersion: "0.1.0",
    generatedAt,
    scenario: {
      id: "fixture-app-cost",
      kind: "fixture-app",
    },
    build: {
      bundler: "vite",
      bundlerVersion: "8.0.4",
      rootDir: "/tmp/repo",
    },
    environments: [
      {
        name: "default",
        build: {
          outDir: "dist",
        },
        manifest: {
          "src/main.ts": {
            file: chunkFileName,
            src: "src/main.ts",
            isEntry: true,
            css: [cssFileName],
          },
        },
        chunks: [
          {
            fileName: chunkFileName,
            name: "main",
            isEntry: true,
            isDynamicEntry: false,
            facadeModuleId: "/tmp/repo/src/main.ts",
            imports: [],
            dynamicImports: [],
            implicitlyLoadedBefore: [],
            importedCss: [cssFileName],
            importedAssets: [],
            modules: [
              {
                rawId: "/tmp/repo/src/main.ts",
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
            names: ["main.css"],
            needsCodeReference: false,
            sizes: cssSizes,
          },
        ],
        warnings: [],
      },
    ],
  }
}

function buildArtifactWithEnvironments({
  generatedAt = "2026-04-06T12:00:00.000Z",
  environments,
}: {
  environments: Array<Record<string, unknown>>
  generatedAt?: string
}) {
  return {
    schemaVersion: 1,
    pluginVersion: "0.1.0",
    generatedAt,
    scenario: {
      id: "fixture-app-cost",
      kind: "fixture-app",
    },
    build: {
      bundler: "vite",
      bundlerVersion: "8.0.4",
      rootDir: "/tmp/repo",
    },
    environments,
  }
}

function buildMultiEntrypointArtifact({
  generatedAt = "2026-04-06T12:00:00.000Z",
  mainChunkSizes = size(123, 45, 38),
  adminChunkSizes = size(90, 33, 27),
}: {
  adminChunkSizes?: { brotli: number; gzip: number; raw: number }
  generatedAt?: string
  mainChunkSizes?: { brotli: number; gzip: number; raw: number }
} = {}) {
  return buildArtifactWithEnvironments({
    generatedAt,
    environments: [
      {
        name: "default",
        build: {
          outDir: "dist",
        },
        manifest: {
          "src/admin.ts": {
            file: "assets/admin.js",
            src: "src/admin.ts",
            isEntry: true,
            css: ["assets/admin.css"],
          },
          "src/main.ts": {
            file: "assets/main.js",
            src: "src/main.ts",
            isEntry: true,
            css: ["assets/main.css"],
          },
        },
        chunks: [
          {
            fileName: "assets/main.js",
            name: "main",
            isEntry: true,
            isDynamicEntry: false,
            facadeModuleId: "/tmp/repo/src/main.ts",
            imports: [],
            dynamicImports: [],
            implicitlyLoadedBefore: [],
            importedCss: ["assets/main.css"],
            importedAssets: [],
            modules: [
              {
                rawId: "/tmp/repo/src/main.ts",
                renderedLength: mainChunkSizes.raw,
                originalLength: 456,
              },
            ],
            sizes: mainChunkSizes,
          },
          {
            fileName: "assets/admin.js",
            name: "admin",
            isEntry: true,
            isDynamicEntry: false,
            facadeModuleId: "/tmp/repo/src/admin.ts",
            imports: [],
            dynamicImports: [],
            implicitlyLoadedBefore: [],
            importedCss: ["assets/admin.css"],
            importedAssets: [],
            modules: [
              {
                rawId: "/tmp/repo/src/admin.ts",
                renderedLength: adminChunkSizes.raw,
                originalLength: 320,
              },
            ],
            sizes: adminChunkSizes,
          },
        ],
        assets: [
          {
            fileName: "assets/main.css",
            names: ["main.css"],
            needsCodeReference: false,
            sizes: size(10, 8, 6),
          },
          {
            fileName: "assets/admin.css",
            names: ["admin.css"],
            needsCodeReference: false,
            sizes: size(8, 6, 5),
          },
        ],
        warnings: [],
      },
    ],
  })
}

function buildMergeBaseArtifact() {
  return buildArtifactWithEnvironments({
    environments: [
      {
        name: "default",
        build: {
          outDir: "dist",
        },
        manifest: {
          "src/main.ts": {
            file: "assets/main-old.js",
            src: "src/main.ts",
            isEntry: true,
            imports: ["chunks/format-old.js", "chunks/ui-old.js"],
            css: ["assets/main-old.css"],
          },
        },
        chunks: [
          {
            fileName: "assets/main-old.js",
            name: "main",
            isEntry: true,
            isDynamicEntry: false,
            facadeModuleId: "/tmp/repo/src/main.ts",
            imports: ["chunks/format-old.js", "chunks/ui-old.js"],
            dynamicImports: [],
            implicitlyLoadedBefore: [],
            importedCss: ["assets/main-old.css"],
            importedAssets: [],
            modules: [
              {
                rawId: "/tmp/repo/src/main.ts",
                renderedLength: 123,
                originalLength: 456,
              },
            ],
            sizes: size(123, 45, 38),
          },
          {
            fileName: "chunks/format-old.js",
            name: "format-old",
            isEntry: false,
            isDynamicEntry: false,
            facadeModuleId: null,
            imports: [],
            dynamicImports: [],
            implicitlyLoadedBefore: [],
            importedCss: [],
            importedAssets: [],
            modules: [
              {
                rawId: "/tmp/repo/src/shared/format.ts",
                renderedLength: 55,
                originalLength: 70,
              },
            ],
            sizes: size(55, 21, 16),
          },
          {
            fileName: "chunks/ui-old.js",
            name: "ui-old",
            isEntry: false,
            isDynamicEntry: false,
            facadeModuleId: null,
            imports: [],
            dynamicImports: [],
            implicitlyLoadedBefore: [],
            importedCss: [],
            importedAssets: [],
            modules: [
              {
                rawId: "/tmp/repo/src/shared/view.ts",
                renderedLength: 45,
                originalLength: 55,
              },
            ],
            sizes: size(45, 18, 14),
          },
        ],
        assets: [
          {
            fileName: "assets/main-old.css",
            names: ["main-old.css"],
            needsCodeReference: false,
            sizes: size(10, 8, 6),
          },
        ],
        warnings: [],
      },
    ],
  })
}

function buildMergeHeadArtifact() {
  return buildArtifactWithEnvironments({
    generatedAt: "2026-04-06T12:10:00.000Z",
    environments: [
      {
        name: "default",
        build: {
          outDir: "dist",
        },
        manifest: {
          "src/main.ts": {
            file: "assets/main-new.js",
            src: "src/main.ts",
            isEntry: true,
            imports: ["chunks/shared-new.js"],
            css: ["assets/main-new.css"],
          },
        },
        chunks: [
          {
            fileName: "assets/main-new.js",
            name: "main",
            isEntry: true,
            isDynamicEntry: false,
            facadeModuleId: "/tmp/repo/src/main.ts",
            imports: ["chunks/shared-new.js"],
            dynamicImports: [],
            implicitlyLoadedBefore: [],
            importedCss: ["assets/main-new.css"],
            importedAssets: [],
            modules: [
              {
                rawId: "/tmp/repo/src/main.ts",
                renderedLength: 123,
                originalLength: 456,
              },
            ],
            sizes: size(123, 45, 38),
          },
          {
            fileName: "chunks/shared-new.js",
            name: "shared-new",
            isEntry: false,
            isDynamicEntry: false,
            facadeModuleId: null,
            imports: [],
            dynamicImports: [],
            implicitlyLoadedBefore: [],
            importedCss: [],
            importedAssets: [],
            modules: [
              {
                rawId: "/tmp/repo/src/shared/format.ts",
                renderedLength: 55,
                originalLength: 70,
              },
              {
                rawId: "/tmp/repo/src/shared/view.ts",
                renderedLength: 45,
                originalLength: 55,
              },
            ],
            sizes: size(100, 39, 30),
          },
        ],
        assets: [
          {
            fileName: "assets/main-new.css",
            names: ["main-new.css"],
            needsCodeReference: false,
            sizes: size(10, 8, 6),
          },
        ],
        warnings: [],
      },
    ],
  })
}

function buildLowConfidenceBaseArtifact() {
  return buildArtifactWithEnvironments({
    environments: [
      {
        name: "default",
        build: {
          outDir: "dist",
        },
        manifest: {
          "src/main.ts": {
            file: "assets/main-old.js",
            src: "src/main.ts",
            isEntry: true,
            imports: ["chunks/shared-aaaaaa.js"],
            css: ["assets/main-old.css"],
          },
        },
        chunks: [
          {
            fileName: "assets/main-old.js",
            name: "main",
            isEntry: true,
            isDynamicEntry: false,
            facadeModuleId: "/tmp/repo/src/main.ts",
            imports: ["chunks/shared-aaaaaa.js"],
            dynamicImports: [],
            implicitlyLoadedBefore: [],
            importedCss: ["assets/main-old.css"],
            importedAssets: [],
            modules: [
              {
                rawId: "/tmp/repo/src/main.ts",
                renderedLength: 123,
                originalLength: 456,
              },
            ],
            sizes: size(123, 45, 38),
          },
          {
            fileName: "chunks/shared-aaaaaa.js",
            name: "shared-old",
            isEntry: false,
            isDynamicEntry: false,
            facadeModuleId: null,
            imports: [],
            dynamicImports: [],
            implicitlyLoadedBefore: [],
            importedCss: [],
            importedAssets: [],
            modules: [
              {
                rawId: "/tmp/repo/src/shared/alpha.ts",
                renderedLength: 55,
                originalLength: 60,
              },
              {
                rawId: "/tmp/repo/src/shared/beta.ts",
                renderedLength: 45,
                originalLength: 50,
              },
            ],
            sizes: size(100, 39, 30),
          },
        ],
        assets: [
          {
            fileName: "assets/main-old.css",
            names: ["main-old.css"],
            needsCodeReference: false,
            sizes: size(10, 8, 6),
          },
        ],
        warnings: [],
      },
    ],
  })
}

function buildLowConfidenceHeadArtifact() {
  return buildArtifactWithEnvironments({
    generatedAt: "2026-04-06T12:10:00.000Z",
    environments: [
      {
        name: "default",
        build: {
          outDir: "dist",
        },
        manifest: {
          "src/main.ts": {
            file: "assets/main-new.js",
            src: "src/main.ts",
            isEntry: true,
            imports: ["chunks/shared-bbbbbb.js"],
            css: ["assets/main-new.css"],
          },
        },
        chunks: [
          {
            fileName: "assets/main-new.js",
            name: "main",
            isEntry: true,
            isDynamicEntry: false,
            facadeModuleId: "/tmp/repo/src/main.ts",
            imports: ["chunks/shared-bbbbbb.js"],
            dynamicImports: [],
            implicitlyLoadedBefore: [],
            importedCss: ["assets/main-new.css"],
            importedAssets: [],
            modules: [
              {
                rawId: "/tmp/repo/src/main.ts",
                renderedLength: 123,
                originalLength: 456,
              },
            ],
            sizes: size(123, 45, 38),
          },
          {
            fileName: "chunks/shared-bbbbbb.js",
            name: "shared-new",
            isEntry: false,
            isDynamicEntry: false,
            facadeModuleId: null,
            imports: [],
            dynamicImports: [],
            implicitlyLoadedBefore: [],
            importedCss: [],
            importedAssets: [],
            modules: [
              {
                rawId: "/tmp/repo/src/shared/gamma.ts",
                renderedLength: 52,
                originalLength: 58,
              },
              {
                rawId: "/tmp/repo/src/shared/delta.ts",
                renderedLength: 48,
                originalLength: 54,
              },
            ],
            sizes: size(100, 39, 30),
          },
        ],
        assets: [
          {
            fileName: "assets/main-new.css",
            names: ["main-new.css"],
            needsCodeReference: false,
            sizes: size(10, 8, 6),
          },
        ],
        warnings: [],
      },
    ],
  })
}

function buildAmbiguousBaseArtifact() {
  return buildArtifactWithEnvironments({
    environments: [
      {
        name: "default",
        build: {
          outDir: "dist",
        },
        manifest: {
          "src/main.ts": {
            file: "assets/main-old.js",
            src: "src/main.ts",
            isEntry: true,
            imports: ["chunks/shared-old.js"],
            css: ["assets/main-old.css"],
          },
        },
        chunks: [
          {
            fileName: "assets/main-old.js",
            name: "main",
            isEntry: true,
            isDynamicEntry: false,
            facadeModuleId: "/tmp/repo/src/main.ts",
            imports: ["chunks/shared-old.js"],
            dynamicImports: [],
            implicitlyLoadedBefore: [],
            importedCss: ["assets/main-old.css"],
            importedAssets: [],
            modules: [
              {
                rawId: "/tmp/repo/src/main.ts",
                renderedLength: 123,
                originalLength: 456,
              },
            ],
            sizes: size(123, 45, 38),
          },
          {
            fileName: "chunks/shared-old.js",
            name: "shared-old",
            isEntry: false,
            isDynamicEntry: false,
            facadeModuleId: null,
            imports: [],
            dynamicImports: [],
            implicitlyLoadedBefore: [],
            importedCss: [],
            importedAssets: [],
            modules: [
              {
                rawId: "/tmp/repo/src/shared/alpha.ts",
                renderedLength: 60,
                originalLength: 68,
              },
              {
                rawId: "/tmp/repo/src/shared/beta.ts",
                renderedLength: 40,
                originalLength: 48,
              },
            ],
            sizes: size(100, 39, 30),
          },
        ],
        assets: [
          {
            fileName: "assets/main-old.css",
            names: ["main-old.css"],
            needsCodeReference: false,
            sizes: size(10, 8, 6),
          },
        ],
        warnings: [],
      },
    ],
  })
}

function buildAmbiguousHeadArtifact() {
  return buildArtifactWithEnvironments({
    generatedAt: "2026-04-06T12:10:00.000Z",
    environments: [
      {
        name: "default",
        build: {
          outDir: "dist",
        },
        manifest: {
          "src/main.ts": {
            file: "assets/main-new.js",
            src: "src/main.ts",
            isEntry: true,
            imports: ["chunks/alpha-ish.js", "chunks/beta-ish.js"],
            css: ["assets/main-new.css"],
          },
        },
        chunks: [
          {
            fileName: "assets/main-new.js",
            name: "main",
            isEntry: true,
            isDynamicEntry: false,
            facadeModuleId: "/tmp/repo/src/main.ts",
            imports: ["chunks/alpha-ish.js", "chunks/beta-ish.js"],
            dynamicImports: [],
            implicitlyLoadedBefore: [],
            importedCss: ["assets/main-new.css"],
            importedAssets: [],
            modules: [
              {
                rawId: "/tmp/repo/src/main.ts",
                renderedLength: 123,
                originalLength: 456,
              },
            ],
            sizes: size(123, 45, 38),
          },
          {
            fileName: "chunks/alpha-ish.js",
            name: "alpha-ish",
            isEntry: false,
            isDynamicEntry: false,
            facadeModuleId: null,
            imports: [],
            dynamicImports: [],
            implicitlyLoadedBefore: [],
            importedCss: [],
            importedAssets: [],
            modules: [
              {
                rawId: "/tmp/repo/src/shared/alpha.ts",
                renderedLength: 35,
                originalLength: 42,
              },
              {
                rawId: "/tmp/repo/src/shared/gamma.ts",
                renderedLength: 20,
                originalLength: 28,
              },
            ],
            sizes: size(55, 22, 17),
          },
          {
            fileName: "chunks/beta-ish.js",
            name: "beta-ish",
            isEntry: false,
            isDynamicEntry: false,
            facadeModuleId: null,
            imports: [],
            dynamicImports: [],
            implicitlyLoadedBefore: [],
            importedCss: [],
            importedAssets: [],
            modules: [
              {
                rawId: "/tmp/repo/src/shared/beta.ts",
                renderedLength: 25,
                originalLength: 30,
              },
              {
                rawId: "/tmp/repo/src/shared/delta.ts",
                renderedLength: 15,
                originalLength: 20,
              },
            ],
            sizes: size(40, 16, 13),
          },
        ],
        assets: [
          {
            fileName: "assets/main-new.css",
            names: ["main-new.css"],
            needsCodeReference: false,
            sizes: size(10, 8, 6),
          },
        ],
        warnings: [],
      },
    ],
  })
}

function buildDynamicEntrypointArtifact({
  generatedAt = "2026-04-06T12:00:00.000Z",
  lazyFileName = "chunks/lazy-old.js",
  lazyCssFileName = "assets/lazy-old.css",
}: {
  generatedAt?: string
  lazyCssFileName?: string
  lazyFileName?: string
} = {}) {
  return buildArtifactWithEnvironments({
    generatedAt,
    environments: [
      {
        name: "default",
        build: {
          outDir: "dist",
        },
        manifest: {
          "src/lazy.ts": {
            file: lazyFileName,
            src: "src/lazy.ts",
            isDynamicEntry: true,
            css: [lazyCssFileName],
          },
          "src/main.ts": {
            file: "assets/main.js",
            src: "src/main.ts",
            isEntry: true,
            dynamicImports: [lazyFileName],
            css: ["assets/main.css"],
          },
        },
        chunks: [
          {
            fileName: "assets/main.js",
            name: "main",
            isEntry: true,
            isDynamicEntry: false,
            facadeModuleId: "/tmp/repo/src/main.ts",
            imports: [],
            dynamicImports: [lazyFileName],
            implicitlyLoadedBefore: [],
            importedCss: ["assets/main.css"],
            importedAssets: [],
            modules: [
              {
                rawId: "/tmp/repo/src/main.ts",
                renderedLength: 123,
                originalLength: 456,
              },
            ],
            sizes: size(123, 45, 38),
          },
          {
            fileName: lazyFileName,
            name: "lazy",
            isEntry: false,
            isDynamicEntry: true,
            facadeModuleId: "/tmp/repo/src/lazy.ts",
            imports: [],
            dynamicImports: [],
            implicitlyLoadedBefore: [],
            importedCss: [lazyCssFileName],
            importedAssets: [],
            modules: [
              {
                rawId: "/tmp/repo/src/lazy.ts",
                renderedLength: 70,
                originalLength: 90,
              },
            ],
            sizes: size(70, 27, 21),
          },
        ],
        assets: [
          {
            fileName: "assets/main.css",
            names: ["main.css"],
            needsCodeReference: false,
            sizes: size(10, 8, 6),
          },
          {
            fileName: lazyCssFileName,
            names: ["lazy.css"],
            needsCodeReference: false,
            sizes: size(9, 7, 5),
          },
        ],
        warnings: [],
      },
    ],
  })
}

function buildManifestOnlyHtmlArtifact({
  generatedAt = "2026-04-06T12:00:00.000Z",
  jsFileName = "assets/main-old.js",
  cssFileName = "assets/main-old.css",
}: {
  cssFileName?: string
  generatedAt?: string
  jsFileName?: string
} = {}) {
  return buildArtifactWithEnvironments({
    generatedAt,
    environments: [
      {
        name: "default",
        build: {
          outDir: "dist",
        },
        manifest: {
          "index.html": {
            file: "index.html",
            src: "index.html",
            isEntry: true,
            imports: [jsFileName],
            css: [cssFileName],
          },
        },
        chunks: [
          {
            fileName: jsFileName,
            name: "main",
            isEntry: false,
            isDynamicEntry: false,
            facadeModuleId: "/tmp/repo/src/main.ts",
            imports: [],
            dynamicImports: [],
            implicitlyLoadedBefore: [],
            importedCss: [cssFileName],
            importedAssets: [],
            modules: [
              {
                rawId: "/tmp/repo/src/main.ts",
                renderedLength: 123,
                originalLength: 456,
              },
            ],
            sizes: size(123, 45, 38),
          },
        ],
        assets: [
          {
            fileName: cssFileName,
            names: ["main.css"],
            needsCodeReference: false,
            sizes: size(10, 8, 6),
          },
        ],
        warnings: [],
      },
    ],
  })
}

function buildSplitBaseArtifact() {
  return {
    schemaVersion: 1,
    pluginVersion: "0.1.0",
    generatedAt: "2026-04-06T12:00:00.000Z",
    scenario: {
      id: "fixture-app-cost",
      kind: "fixture-app",
    },
    build: {
      bundler: "vite",
      bundlerVersion: "8.0.4",
      rootDir: "/tmp/repo",
    },
    environments: [
      {
        name: "default",
        build: {
          outDir: "dist",
        },
        manifest: {
          "src/main.ts": {
            file: "assets/main-old.js",
            src: "src/main.ts",
            isEntry: true,
            imports: ["chunks/shared-old.js"],
            css: ["assets/main-old.css"],
          },
          "chunks/shared-old.js": {
            file: "chunks/shared-old.js",
            css: ["assets/shared-old.css"],
          },
        },
        chunks: [
          {
            fileName: "assets/main-old.js",
            name: "main",
            isEntry: true,
            isDynamicEntry: false,
            facadeModuleId: "/tmp/repo/src/main.ts",
            imports: ["chunks/shared-old.js"],
            dynamicImports: [],
            implicitlyLoadedBefore: [],
            importedCss: ["assets/main-old.css"],
            importedAssets: [],
            modules: [
              {
                rawId: "/tmp/repo/src/main.ts",
                renderedLength: 123,
                originalLength: 456,
              },
            ],
            sizes: size(123, 45, 38),
          },
          {
            fileName: "chunks/shared-old.js",
            name: "shared",
            isEntry: false,
            isDynamicEntry: false,
            facadeModuleId: null,
            imports: [],
            dynamicImports: [],
            implicitlyLoadedBefore: [],
            importedCss: ["assets/shared-old.css"],
            importedAssets: [],
            modules: [
              {
                rawId: "/tmp/repo/src/shared/format.ts",
                renderedLength: 60,
                originalLength: 70,
              },
              {
                rawId: "/tmp/repo/src/shared/view.ts",
                renderedLength: 40,
                originalLength: 50,
              },
            ],
            sizes: size(100, 40, 32),
          },
        ],
        assets: [
          {
            fileName: "assets/main-old.css",
            names: ["main-old.css"],
            needsCodeReference: false,
            sizes: size(10, 8, 6),
          },
          {
            fileName: "assets/shared-old.css",
            names: ["shared-old.css"],
            needsCodeReference: false,
            sizes: size(30, 10, 8),
          },
        ],
        warnings: [],
      },
    ],
  }
}

function buildSplitHeadArtifact() {
  return {
    schemaVersion: 1,
    pluginVersion: "0.1.0",
    generatedAt: "2026-04-06T12:10:00.000Z",
    scenario: {
      id: "fixture-app-cost",
      kind: "fixture-app",
    },
    build: {
      bundler: "vite",
      bundlerVersion: "8.0.4",
      rootDir: "/tmp/repo",
    },
    environments: [
      {
        name: "default",
        build: {
          outDir: "dist",
        },
        manifest: {
          "src/main.ts": {
            file: "assets/main-new.js",
            src: "src/main.ts",
            isEntry: true,
            imports: ["chunks/route-format.js", "chunks/route-ui.js"],
            css: ["assets/main-new.css"],
          },
          "chunks/route-format.js": {
            file: "chunks/route-format.js",
            css: ["assets/route-format.css"],
          },
          "chunks/route-ui.js": {
            file: "chunks/route-ui.js",
            css: ["assets/route-ui.css"],
          },
        },
        chunks: [
          {
            fileName: "assets/main-new.js",
            name: "main",
            isEntry: true,
            isDynamicEntry: false,
            facadeModuleId: "/tmp/repo/src/main.ts",
            imports: ["chunks/route-format.js", "chunks/route-ui.js"],
            dynamicImports: [],
            implicitlyLoadedBefore: [],
            importedCss: ["assets/main-new.css"],
            importedAssets: [],
            modules: [
              {
                rawId: "/tmp/repo/src/main.ts",
                renderedLength: 150,
                originalLength: 470,
              },
            ],
            sizes: size(150, 56, 46),
          },
          {
            fileName: "chunks/route-format.js",
            name: "route-format",
            isEntry: false,
            isDynamicEntry: false,
            facadeModuleId: null,
            imports: [],
            dynamicImports: [],
            implicitlyLoadedBefore: [],
            importedCss: ["assets/route-format.css"],
            importedAssets: [],
            modules: [
              {
                rawId: "/tmp/repo/src/shared/format.ts",
                renderedLength: 60,
                originalLength: 70,
              },
            ],
            sizes: size(60, 24, 18),
          },
          {
            fileName: "chunks/route-ui.js",
            name: "route-ui",
            isEntry: false,
            isDynamicEntry: false,
            facadeModuleId: null,
            imports: [],
            dynamicImports: [],
            implicitlyLoadedBefore: [],
            importedCss: ["assets/route-ui.css"],
            importedAssets: [],
            modules: [
              {
                rawId: "/tmp/repo/src/shared/view.ts",
                renderedLength: 40,
                originalLength: 50,
              },
            ],
            sizes: size(40, 16, 12),
          },
        ],
        assets: [
          {
            fileName: "assets/main-new.css",
            names: ["main-new.css"],
            needsCodeReference: false,
            sizes: size(12, 9, 7),
          },
          {
            fileName: "assets/route-format.css",
            names: ["route-format.css"],
            needsCodeReference: false,
            sizes: size(18, 7, 5),
          },
          {
            fileName: "assets/route-ui.css",
            names: ["route-ui.css"],
            needsCodeReference: false,
            sizes: size(12, 5, 4),
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
