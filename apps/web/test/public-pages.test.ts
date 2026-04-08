import { defaultStringifySearch } from "@tanstack/react-router"
import { describe, expect, it } from "vitest"

import { buildCiContext, buildEnvelope, buildSimpleArtifact, size } from "./support/builders.js"
import { insertRepository, insertScenario } from "./support/db-helpers.js"
import { createPipelineHarness } from "./support/pipeline-harness.js"
import { fetchPage } from "./support/request-helpers.js"

const baseSha = "0123456789abcdef0123456789abcdef01234567"
const headSha = "1111111111111111111111111111111111111111"
const prHeadSha = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"

describe("public pages", () => {
  it("serves repository, scenario, and compare pages through the worker", async () => {
    const harness = createPipelineHarness()

    await harness.acceptUpload(
      buildEnvelope({
        git: {
          commitSha: baseSha,
          branch: "main",
        },
        ci: buildCiContext("7000"),
      }),
    )
    await harness.processUploadPipeline()

    await harness.acceptUpload(
      buildEnvelope({
        git: {
          commitSha: headSha,
          branch: "main",
        },
        ci: buildCiContext("7001"),
      }),
    )
    await harness.processUploadPipeline()

    const repositoryPage = await fetchPage(
      "https://bundle.test/r/acme/widget?lens=entry-js-direct-css",
    )
    expect(repositoryPage.status).toBe(200)
    expect(repositoryPage.headers.get("content-type")).toContain("text/html")
    expect(await repositoryPage.text()).toContain("Repository overview public page.")

    const scenarioPage = await fetchPage(
      "https://bundle.test/r/acme/widget/scenarios/fixture-app-cost?branch=main&env=all&entrypoint=all&lens=entry-js-direct-css",
    )
    const scenarioPageText = await scenarioPage.text()
    expect(scenarioPage.status).toBe(200)
    expect(scenarioPageText).toContain("Scenario public page.")

    const comparePage = await fetchPage(
      `https://bundle.test/r/acme/widget/compare${defaultStringifySearch({ base: baseSha, head: headSha })}`,
    )
    const comparePageText = await comparePage.text()
    expect(comparePage.status).toBe(200)
    expect(comparePageText).toContain("Compare")
    expect(comparePageText).toContain("fixture-app-cost")
  })

  it("serves the PR-scoped compare page through the worker", async () => {
    const harness = createPipelineHarness()

    await seedPrComparison(harness)

    const comparePage = await fetchPage(
      `https://bundle.test/r/acme/widget/compare${defaultStringifySearch({ pr: 42, base: baseSha, head: prHeadSha })}`,
    )
    const comparePageText = await comparePage.text()

    expect(comparePage.status).toBe(200)
    expect(comparePageText).toContain("PR Compare")
    expect(comparePageText).toContain("scenario-pr")
  })

  it("renders empty states when a repository and scenario exist without branch summaries yet", async () => {
    await insertRepository({
      id: "repo-empty",
      githubRepoId: 999,
      installationId: 456,
      owner: "acme",
      name: "empty-widget",
    })
    await insertScenario({
      id: "scenario-empty",
      repositoryId: "repo-empty",
      slug: "lonely-scenario",
      sourceKind: "fixture-app",
    })

    const repositoryPage = await fetchPage(
      "https://bundle.test/r/acme/empty-widget?lens=entry-js-direct-css",
    )
    const repositoryPageText = await repositoryPage.text()

    expect(repositoryPage.status).toBe(200)
    expect(repositoryPageText).toContain("No branch data yet")
    expect(repositoryPageText).toContain("No settled branch summary is available yet.")

    const scenarioPage = await fetchPage(
      "https://bundle.test/r/acme/empty-widget/scenarios/lonely-scenario?env=all&entrypoint=all&lens=entry-js-direct-css",
    )
    const scenarioPageText = await scenarioPage.text()

    expect(scenarioPage.status).toBe(200)
    expect(scenarioPageText).toContain("No branch data yet")
    expect(scenarioPageText).toContain("No branch summary is available for this scenario yet.")
  })

  it("returns an error page when compare search params are invalid", async () => {
    const response = await fetchPage(
      "https://bundle.test/r/acme/widget/compare?base=not-a-sha&head=still-not-a-sha",
    )

    expect(response.status).toBe(500)
  })

  it("returns an error page when repository or scenario pages do not exist", async () => {
    const repositoryPage = await fetchPage("https://bundle.test/r/acme/missing-widget")
    const repositoryPageText = await repositoryPage.text()
    expect(repositoryPage.status).toBe(500)
    expect(repositoryPageText).toContain("Repository acme/missing-widget was not found.")

    await insertRepository({
      id: "repo-missing-scenario-page",
      githubRepoId: 1001,
      installationId: 1001,
      owner: "acme",
      name: "missing-scenario-page",
    })

    const scenarioPage = await fetchPage(
      "https://bundle.test/r/acme/missing-scenario-page/scenarios/not-there",
    )
    const scenarioPageText = await scenarioPage.text()
    expect(scenarioPage.status).toBe(500)
    expect(scenarioPageText).toContain("Scenario not-there was not found for this repository.")
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
      ci: buildCiContext("7600"),
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
      ci: buildCiContext("7601"),
    }),
  )
  await harness.processUploadPipeline()
}
