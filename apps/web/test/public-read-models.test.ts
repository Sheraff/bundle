import { env } from "cloudflare:workers"
import { describe, expect, it } from "vitest"
import { ulid } from "ulid"

import {
  getNeutralComparePageData,
  getPullRequestComparePageData,
  getRepositoryOverviewPageData,
  getScenarioPageData,
} from "../src/lib/public-read-models.server.js"
import { buildCiContext, buildEnvelope, buildSimpleArtifact, size } from "./support/builders.js"
import { insertRepository, insertScenario } from "./support/db-helpers.js"
import { dispatchQueueMessage, TEST_QUEUE_NAMES } from "./queue-test-helpers.js"
import { createPipelineHarness } from "./support/pipeline-harness.js"

const baseSha = "0123456789abcdef0123456789abcdef01234567"
const headSha = "1111111111111111111111111111111111111111"
const prHeadSha = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"

describe("public read models", () => {
  it("throws when the repository does not exist", async () => {
    await expect(
      getRepositoryOverviewPageData(env, {
        owner: "acme",
        repo: "missing-widget",
      }),
    ).rejects.toThrow("Repository acme/missing-widget was not found.")
  })

  it("throws when the scenario does not exist for the repository", async () => {
    await insertRepository({
      id: "repo-read-missing-scenario",
      githubRepoId: 3001,
      installationId: 3001,
      owner: "acme",
      name: "read-missing-scenario",
    })

    await expect(
      getScenarioPageData(env, {
        owner: "acme",
        repo: "read-missing-scenario",
        scenario: "missing-scenario",
      }),
    ).rejects.toThrow("Scenario missing-scenario was not found for this repository.")
  })

  it("returns no neutral compare rows when the requested base/head pair does not exist", async () => {
    const harness = createPipelineHarness()

    await seedBranchComparison(harness)

    const data = await getNeutralComparePageData(env, {
      owner: "acme",
      repo: "widget",
      search: {
        base: "9999999999999999999999999999999999999999",
        head: headSha,
      },
    })

    expect(data.contextMatched).toBe(false)
    expect(data.latestSummary?.commitSha).toBe(headSha)
    expect(data.neutralRows).toEqual([])
    expect(data.selectedNeutralRow).toBeNull()
  })

  it("keeps URL branch state even when the selected branch has no summaries", async () => {
    const harness = createPipelineHarness()

    await seedBranchComparison(harness)

    const data = await getScenarioPageData(env, {
      owner: "acme",
      repo: "widget",
      scenario: "fixture-app-cost",
      branch: "release/does-not-exist",
      env: "all",
      entrypoint: "all",
      lens: "entry-js-direct-css",
    })

    expect(data.branch).toBe("release/does-not-exist")
    expect(data.latestSummary).toBeNull()
    expect(data.latestFreshScenario).toBeNull()
    expect(data.history).toEqual([])
  })

  it("keeps PR compare acknowledgement-aware while neutral compare stays acknowledgement-neutral", async () => {
    const harness = createPipelineHarness()

    await seedBranchComparison(harness)
    await seedPrComparison(harness)

    const comparison = await env.DB.prepare(
      `SELECT id, repository_id, pull_request_id, series_id
       FROM comparisons
       WHERE kind = 'pr-base' AND selected_head_commit_sha = ?
       ORDER BY created_at ASC
       LIMIT 1`,
    )
      .bind(prHeadSha)
      .first<{
        id: string
        repository_id: string
        pull_request_id: string
        series_id: string
      }>()
    expect(comparison?.id).toBeTruthy()

    const commitGroup = await env.DB.prepare(
      `SELECT id
       FROM commit_groups
       WHERE commit_sha = ?
       LIMIT 1`,
    )
      .bind(prHeadSha)
      .first<{ id: string }>()
    expect(commitGroup?.id).toBeTruthy()

    const ackId = ulid()
    const ackTimestamp = "2026-04-07T12:30:00.000Z"
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
        comparison?.repository_id ?? "",
        comparison?.pull_request_id ?? "",
        comparison?.id ?? "",
        comparison?.series_id ?? "",
        "metric:total-raw-bytes",
        "flo",
        "known regression",
        ackTimestamp,
        ackTimestamp,
      )
      .run()

    const refreshResult = await dispatchQueueMessage(TEST_QUEUE_NAMES.refreshSummaries, {
      schemaVersion: 1,
      kind: "refresh-summaries",
      repositoryId: comparison?.repository_id ?? "",
      commitGroupId: commitGroup?.id ?? "",
      dedupeKey: "refresh-summaries:public-read-acknowledgement:v1",
    })
    expect(refreshResult).toBeAcknowledged()

    const prData = await getPullRequestComparePageData(env, {
      owner: "acme",
      repo: "widget",
      search: {
        pr: 42,
        base: baseSha,
        head: prHeadSha,
      },
    })
    const neutralData = await getNeutralComparePageData(env, {
      owner: "acme",
      repo: "widget",
      search: {
        base: baseSha,
        head: headSha,
      },
    })

    expect(prData.reviewedRows[0]?.primaryItem).toEqual(
      expect.objectContaining({
        acknowledged: true,
        reviewState: "acknowledged",
      }),
    )
    expect(neutralData.neutralRows[0]?.primaryItem).toEqual(
      expect.not.objectContaining({
        acknowledged: expect.anything(),
      }),
    )
  })
})

async function seedBranchComparison(harness: ReturnType<typeof createPipelineHarness>) {
  await harness.acceptUpload(
    buildEnvelope({
      artifact: buildSimpleArtifact({
        scenarioId: "fixture-app-cost",
        chunkSizes: size(123, 45, 38),
        cssSizes: size(10, 8, 6),
      }),
      git: {
        commitSha: baseSha,
        branch: "main",
      },
      ci: buildCiContext("8100"),
    }),
  )
  await harness.processUploadPipeline()

  await harness.acceptUpload(
    buildEnvelope({
      artifact: buildSimpleArtifact({
        scenarioId: "fixture-app-cost",
        chunkSizes: size(150, 45, 38),
        cssSizes: size(10, 8, 6),
      }),
      git: {
        commitSha: headSha,
        branch: "main",
      },
      ci: buildCiContext("8101"),
    }),
  )
  await harness.processUploadPipeline()
}

async function seedPrComparison(harness: ReturnType<typeof createPipelineHarness>) {
  await harness.acceptUpload(
    buildEnvelope({
      artifact: buildSimpleArtifact({
        scenarioId: "scenario-pr",
        chunkSizes: size(123, 45, 38),
        cssSizes: size(10, 8, 6),
      }),
      git: {
        commitSha: baseSha,
        branch: "main",
      },
      ci: buildCiContext("8200"),
    }),
  )
  await harness.processUploadPipeline()

  await harness.acceptUpload(
    buildEnvelope({
      artifact: buildSimpleArtifact({
        scenarioId: "scenario-pr",
        chunkSizes: size(150, 45, 38),
        cssSizes: size(10, 8, 6),
      }),
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
      ci: buildCiContext("8201"),
    }),
  )
  await harness.processUploadPipeline()
}
