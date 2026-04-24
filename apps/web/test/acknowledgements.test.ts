import { env } from "cloudflare:workers"
import { describe, expect, it, vi } from "vitest"

import {
  acknowledgeComparisonItemForUser,
  AcknowledgementValidationError,
} from "../src/acknowledgements.js"
import { upsertUserWithGithubToken } from "../src/github/onboarding.js"
import { getPullRequestComparePageData } from "../src/lib/public-read-models.server.js"
import { buildCiContext, buildEnvelope, buildSimpleArtifact, size } from "./support/builders.js"
import { createPipelineHarness } from "./support/pipeline-harness.js"
import { toRequestUrl } from "./support/request-helpers.js"

const baseSha = "0123456789abcdef0123456789abcdef01234567"
const prHeadSha = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"

describe("acknowledgement writes", () => {
  it("writes a PR comparison item acknowledgement and refreshes the PR read model", async () => {
    const harness = createPipelineHarness()
    await seedPrComparison(harness)
    const comparison = await loadPrComparison()
    const user = await seedGithubUser("reviewer")

    stubRepositoryPermission("reviewer", "write")

    const result = await acknowledgeComparisonItemForUser(env, user, {
      comparisonId: comparison.id,
      itemKey: "metric:total-raw-bytes",
      note: "known regression while refactoring exports",
      pullRequestId: comparison.pull_request_id,
      repositoryId: comparison.repository_id,
      seriesId: comparison.series_id,
    })
    await harness.drainRefresh()

    const acknowledgement = await env.DB.prepare(
      `SELECT actor_github_user_id, actor_login, note
       FROM acknowledgements
       WHERE id = ?`,
    )
      .bind(result.acknowledgementId)
      .first<{ actor_github_user_id: number; actor_login: string; note: string | null }>()
    const prData = await getPullRequestComparePageData(env, {
      owner: "acme",
      repo: "widget",
      search: {
        base: baseSha,
        head: prHeadSha,
        pr: 42,
      },
    })

    expect(acknowledgement).toMatchObject({
      actor_github_user_id: user.githubUserId,
      actor_login: "reviewer",
      note: "known regression while refactoring exports",
    })
    expect(prData.reviewedRows[0]?.primaryItem).toMatchObject({
      acknowledged: true,
      note: "known regression while refactoring exports",
      reviewState: "acknowledged",
    })
    expect(prData.latestReviewSummary?.counts.acknowledgedRegressionCount).toBe(1)
  })

  it("rejects acknowledgement writes without repository write permission", async () => {
    const harness = createPipelineHarness()
    await seedPrComparison(harness)
    const comparison = await loadPrComparison()
    const user = await seedGithubUser("reader")

    stubRepositoryPermission("reader", "read")

    await expect(
      acknowledgeComparisonItemForUser(env, user, {
        comparisonId: comparison.id,
        itemKey: "metric:total-raw-bytes",
        pullRequestId: comparison.pull_request_id,
        repositoryId: comparison.repository_id,
        seriesId: comparison.series_id,
      }),
    ).rejects.toThrow("Repository write permission is required.")

    const count = await env.DB.prepare("SELECT COUNT(*) AS count FROM acknowledgements").first<{
      count: number
    }>()
    expect(count?.count).toBe(0)
  })

  it("rejects non-regression comparison items", async () => {
    const harness = createPipelineHarness()
    await seedPrComparison(harness)
    const comparison = await loadPrComparison()
    const user = await seedGithubUser("reviewer")

    stubRepositoryPermission("reviewer", "write")

    await expect(
      acknowledgeComparisonItemForUser(env, user, {
        comparisonId: comparison.id,
        itemKey: "metric:total-brotli-bytes",
        pullRequestId: comparison.pull_request_id,
        repositoryId: comparison.repository_id,
        seriesId: comparison.series_id,
      }),
    ).rejects.toBeInstanceOf(AcknowledgementValidationError)
  })
})

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
      ci: buildCiContext("8400"),
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
      ci: buildCiContext("8401"),
    }),
  )
  await harness.processUploadPipeline()
}

async function loadPrComparison() {
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

  if (!comparison) {
    throw new Error("Expected a seeded PR comparison.")
  }

  return comparison
}

async function seedGithubUser(login: string) {
  return upsertUserWithGithubToken(
    env,
    {
      avatarUrl: null,
      githubUserId: login === "reviewer" ? 9001 : 9002,
      login,
      name: null,
    },
    {
      accessToken: `${login}-token`,
      accessTokenExpiresAt: null,
      refreshToken: null,
      refreshTokenExpiresAt: null,
    },
  )
}

function stubRepositoryPermission(login: string, permission: string) {
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(async (input) => {
      expect(toRequestUrl(input)).toBe(
        `https://api.github.com/repos/acme/widget/collaborators/${login}/permission`,
      )
      return Response.json({ permission })
    }),
  )
}
