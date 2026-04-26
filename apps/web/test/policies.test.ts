import { env } from "cloudflare:workers"
import { describe, expect, it } from "vitest"
import { ulid } from "ulid"

import { evaluatePoliciesForComparison } from "../src/policies.js"
import { buildCiContext, buildEnvelope, buildSimpleArtifact, size } from "./support/builders.js"
import { createPipelineHarness } from "./support/pipeline-harness.js"

const baseSha = "0123456789abcdef0123456789abcdef01234567"
const headSha = "1111111111111111111111111111111111111111"
const noBaselineSha = "2222222222222222222222222222222222222222"

describe("policy evaluation", () => {
  it("persists deterministic policy results and aggregate state", async () => {
    const harness = createPipelineHarness()
    await seedBranchComparison(harness)
    const input = await loadPolicyInput(headSha)

    await insertPolicy(input, { name: "Pass raw", thresholdBytes: 1000 })
    await insertPolicy(input, { blocking: false, name: "Warn raw", severity: "warning", thresholdBytes: 1 })
    await insertPolicy(input, { blocking: false, name: "Non-blocking raw", thresholdBytes: 1 })
    await insertPolicy(input, { blocking: true, name: "Blocking raw", thresholdBytes: 1 })
    await insertPolicy(input, { enabled: false, name: "Disabled raw", thresholdBytes: 1 })

    const result = await evaluatePoliciesForComparison(env, {
      comparison: input.comparison,
      evaluatedAt: "2026-04-08T12:00:00.000Z",
      series: input.series,
    })

    expect(result.budgetState).toBe("fail-blocking")
    await expectPolicyResults(input.comparison.id, ["disabled", "fail_blocking", "fail_non_blocking", "pass", "warn"])
  })

  it("honors accepted and expired policy decisions", async () => {
    const harness = createPipelineHarness()
    await seedBranchComparison(harness)
    const input = await loadPolicyInput(headSha)
    const acceptedPolicyId = await insertPolicy(input, { blocking: true, name: "Accepted blocking raw", thresholdBytes: 1 })
    const expiredPolicyId = await insertPolicy(input, { blocking: true, name: "Expired blocking raw", thresholdBytes: 1 })

    await insertAcceptedDecision(input, acceptedPolicyId, "2026-04-09T12:00:00.000Z")
    await insertAcceptedDecision(input, expiredPolicyId, "2026-04-07T12:00:00.000Z")

    const result = await evaluatePoliciesForComparison(env, {
      comparison: input.comparison,
      evaluatedAt: "2026-04-08T12:00:00.000Z",
      series: input.series,
    })

    expect(result.budgetState).toBe("fail-blocking")
    await expectPolicyResults(input.comparison.id, ["accepted", "fail_blocking"])
  })

  it("can re-evaluate comparisons with accepted policy decisions", async () => {
    const harness = createPipelineHarness()
    await seedBranchComparison(harness)
    const input = await loadPolicyInput(headSha)
    const acceptedPolicyId = await insertPolicy(input, { blocking: true, name: "Accepted blocking raw", thresholdBytes: 1 })

    await insertAcceptedDecision(input, acceptedPolicyId, "2026-04-09T12:00:00.000Z")

    const firstResult = await evaluatePoliciesForComparison(env, {
      comparison: input.comparison,
      evaluatedAt: "2026-04-08T12:00:00.000Z",
      series: input.series,
    })
    const secondResult = await evaluatePoliciesForComparison(env, {
      comparison: input.comparison,
      evaluatedAt: "2026-04-08T12:01:00.000Z",
      series: input.series,
    })

    expect(firstResult.budgetState).toBe("accepted")
    expect(secondResult.budgetState).toBe("accepted")
    await expectPolicyResults(input.comparison.id, ["accepted"])
  })

  it("does not evaluate policies when required comparison data is missing", async () => {
    const harness = createPipelineHarness()
    await harness.acceptUpload(
      buildEnvelope({
        artifact: buildSimpleArtifact({ scenarioId: "scenario-policy-missing" }),
        git: { branch: "main", commitSha: noBaselineSha },
        ci: buildCiContext("policy-missing"),
      }),
    )
    await harness.processUploadPipeline()
    const input = await loadPolicyInput(noBaselineSha)

    await insertPolicy(input, { name: "Missing baseline raw", thresholdBytes: 1 })

    const result = await evaluatePoliciesForComparison(env, {
      comparison: input.comparison,
      evaluatedAt: "2026-04-08T12:00:00.000Z",
      series: input.series,
    })

    expect(result.budgetState).toBe("not-evaluated")
    await expectPolicyResults(input.comparison.id, ["not_evaluated"])
  })
})

async function seedBranchComparison(harness: ReturnType<typeof createPipelineHarness>) {
  await harness.acceptUpload(
    buildEnvelope({
      artifact: buildSimpleArtifact({
        scenarioId: "scenario-policy",
        chunkSizes: size(100, 40, 32),
        cssSizes: size(10, 5, 4),
      }),
      git: { branch: "main", commitSha: baseSha },
      ci: buildCiContext("policy-base"),
    }),
  )
  await harness.processUploadPipeline()

  await harness.acceptUpload(
    buildEnvelope({
      artifact: buildSimpleArtifact({
        scenarioId: "scenario-policy",
        chunkSizes: size(150, 45, 36),
        cssSizes: size(15, 6, 5),
      }),
      git: { branch: "main", commitSha: headSha },
      ci: buildCiContext("policy-head"),
    }),
  )
  await harness.processUploadPipeline()
}

async function loadPolicyInput(commitSha: string) {
  const row = await env.DB.prepare(
    `SELECT
       c.id,
       c.repository_id AS repositoryId,
       c.series_id AS seriesId,
       c.current_total_raw_bytes AS currentTotalRawBytes,
       c.current_total_gzip_bytes AS currentTotalGzipBytes,
       c.current_total_brotli_bytes AS currentTotalBrotliBytes,
       c.delta_total_raw_bytes AS deltaTotalRawBytes,
       c.delta_total_gzip_bytes AS deltaTotalGzipBytes,
       c.delta_total_brotli_bytes AS deltaTotalBrotliBytes,
       s.scenario_id AS scenarioId,
       s.environment,
       s.entrypoint_key AS entrypointKey,
       s.lens
     FROM comparisons c
     INNER JOIN series s ON s.id = c.series_id
     WHERE c.selected_head_commit_sha = ?
     LIMIT 1`,
  )
    .bind(commitSha)
    .first<{
      currentTotalBrotliBytes: number
      currentTotalGzipBytes: number
      currentTotalRawBytes: number
      deltaTotalBrotliBytes: number | null
      deltaTotalGzipBytes: number | null
      deltaTotalRawBytes: number | null
      entrypointKey: string
      environment: string
      id: string
      lens: string
      repositoryId: string
      scenarioId: string
      seriesId: string
    }>()

  expect(row).toBeTruthy()

  return {
    comparison: {
      currentTotalBrotliBytes: row!.currentTotalBrotliBytes,
      currentTotalGzipBytes: row!.currentTotalGzipBytes,
      currentTotalRawBytes: row!.currentTotalRawBytes,
      deltaTotalBrotliBytes: row!.deltaTotalBrotliBytes,
      deltaTotalGzipBytes: row!.deltaTotalGzipBytes,
      deltaTotalRawBytes: row!.deltaTotalRawBytes,
      id: row!.id,
      repositoryId: row!.repositoryId,
      seriesId: row!.seriesId,
    },
    series: {
      entrypointKey: row!.entrypointKey,
      environment: row!.environment,
      lens: row!.lens,
      scenarioId: row!.scenarioId,
    },
  }
}

async function insertPolicy(
  input: Awaited<ReturnType<typeof loadPolicyInput>>,
  overrides: Partial<{
    blocking: boolean
    enabled: boolean
    name: string
    severity: "error" | "warning"
    thresholdBytes: number
  }> = {},
) {
  const id = ulid()
  const timestamp = "2026-04-08T12:00:00.000Z"

  await env.DB.prepare(
    `INSERT INTO policies (
       id, repository_id, scenario_id, name, environment, entrypoint_key, lens,
       size_metric, operator, threshold_bytes, severity, blocking, enabled, version,
       created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      input.comparison.repositoryId,
      input.series.scenarioId,
      overrides.name ?? "Raw policy",
      null,
      null,
      null,
      "raw",
      "delta_greater_than",
      overrides.thresholdBytes ?? 1,
      overrides.severity ?? "error",
      overrides.blocking === false ? 0 : 1,
      overrides.enabled === false ? 0 : 1,
      1,
      timestamp,
      timestamp,
    )
    .run()

  return id
}

async function insertAcceptedDecision(
  input: Awaited<ReturnType<typeof loadPolicyInput>>,
  policyId: string,
  expiresAt: string,
) {
  const timestamp = "2026-04-08T12:00:00.000Z"

  await env.DB.prepare(
    `INSERT INTO accepted_policy_decisions (
       id, repository_id, policy_id, policy_result_id, comparison_id, actor_login,
       reason, scope, expires_at, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(ulid(), input.comparison.repositoryId, policyId, null, input.comparison.id, "flo", "Known change", "comparison", expiresAt, timestamp, timestamp)
    .run()
}

async function expectPolicyResults(comparisonId: string, expectedStates: string[]) {
  const rows = await env.DB.prepare(
    `SELECT result FROM policy_results WHERE comparison_id = ? ORDER BY result ASC`,
  )
    .bind(comparisonId)
    .all<{ result: string }>()

  expect(rows.results.map((row) => row.result)).toEqual(expectedStates.sort())
}
