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
    const repositoryPageText = await repositoryPage.text()
    expect(repositoryPage.status).toBe(200)
    expect(repositoryPage.headers.get("content-type")).toContain("text/html")
    expect(repositoryPageText).toContain("Scenarios for")
    expect(repositoryPageText).toContain("Uncovered / no policy")

    const historyPage = await fetchPage(
      "https://bundle.test/r/acme/widget/history?branch=main&scenario=all&env=all&entrypoint=all&lens=entry-js-direct-css&metric=gzip",
    )
    const historyPageText = await historyPage.text()
    expect(historyPage.status).toBe(200)
    expect(historyPageText).toContain("History mode")
    expect(historyPageText).toContain("Branch markers")
    expect(historyPageText).toContain("Scenario rollups")
    expect(historyPageText).toContain("Branch evolution")
    expect(historyPageText).toContain("Compare builder")

    const scenarioPage = await fetchPage(
      "https://bundle.test/r/acme/widget/scenarios/fixture-app-cost?branch=main&env=all&entrypoint=all&lens=entry-js-direct-css&metric=gzip&tab=history",
    )
    const scenarioPageText = await scenarioPage.text()
    expect(scenarioPage.status).toBe(200)
    expect(scenarioPageText).toContain("A scenario is one reproducible bundle target.")
    expect(scenarioPageText).toContain("Current outputs")
    expect(scenarioPageText).toContain("Output evolution over time")
    expect(scenarioPageText).toContain("History states")

    const scenarioTreemapPage = await fetchPage(
      "https://bundle.test/r/acme/widget/scenarios/fixture-app-cost?branch=main&env=default&entrypoint=src/main.ts&lens=entry-js-direct-css&metric=gzip&tab=treemap",
    )
    const scenarioTreemapText = await scenarioTreemapPage.text()
    expect(scenarioTreemapPage.status).toBe(200)
    expect(scenarioTreemapText).toContain("Expert visualizer")
    expect(scenarioTreemapText).toContain("Where size lives")
    expect(scenarioTreemapText).toContain("Source-line attribution is unavailable")
    expect(scenarioTreemapText).toContain("Chunks")

    const comparePage = await fetchPage(
      `https://bundle.test/r/acme/widget/compare${defaultStringifySearch({ base: baseSha, head: headSha, metric: "gzip" })}`,
    )
    const comparePageText = await comparePage.text()
    expect(comparePage.status).toBe(200)
    expect(comparePageText).toContain("Compare")
    expect(comparePageText).toContain("Compare presets")
    expect(comparePageText).toContain("Compatibility")
    expect(comparePageText).toContain("Scenario groups")
    expect(comparePageText).toContain("policy-grade inputs")
    expect(comparePageText).toContain("fixture-app-cost")

    const compareAssetsPage = await fetchPage(
      `https://bundle.test/r/acme/widget/compare${defaultStringifySearch({ base: baseSha, head: headSha, scenario: "fixture-app-cost", env: "default", entrypoint: "src/main.ts", lens: "entry-js-direct-css", metric: "gzip", tab: "assets" })}`,
    )
    const compareAssetsText = await compareAssetsPage.text()
    expect(compareAssetsPage.status).toBe(200)
    expect(compareAssetsText).toContain("Which assets/packages changed")
    expect(compareAssetsText).toContain("Assets")
  })

  it("serves the PR-scoped compare page through the worker", async () => {
    const harness = createPipelineHarness()

    await seedPrComparison(harness)

    const comparePage = await fetchPage(
      `https://bundle.test/r/acme/widget/compare${defaultStringifySearch({ pr: 42, base: baseSha, head: prHeadSha })}`,
    )
    const comparePageText = await comparePage.text()

    expect(comparePage.status).toBe(200)
    expect(comparePageText).toContain("Review PR #")
    expect(comparePageText).toContain("Needs review")
    expect(comparePageText).toContain("Policy state is not_configured")
    expect(comparePageText).toContain("scenario-pr")
    expect(comparePageText).toContain('<details open=""><summary><span>scenario-pr')
    expect(comparePageText).not.toContain("Blocked by policy")
    expect(comparePageText).not.toContain("Confidence")
    expect(comparePageText).not.toContain("Sourcemap")
  })

  it("shows an explicit unavailable verdict when no PR review summary matches the selected base/head", async () => {
    const harness = createPipelineHarness()

    await seedPrComparison(harness)

    const comparePage = await fetchPage(
      `https://bundle.test/r/acme/widget/compare${defaultStringifySearch({ pr: 42, base: baseSha, head: headSha })}`,
    )
    const comparePageText = await comparePage.text()

    expect(comparePage.status).toBe(200)
    expect(comparePageText).toContain("Review summary unavailable")
    expect(comparePageText).toContain("No PR review summary matched this base/head context.")
    expect(comparePageText).not.toContain("Review passes")
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
    expect(repositoryPageText).toContain("Stale / missing")
    expect(repositoryPageText).toContain("Awaiting first processed measurement.")

    const scenarioPage = await fetchPage(
      "https://bundle.test/r/acme/empty-widget/scenarios/lonely-scenario?env=all&entrypoint=all&lens=entry-js-direct-css",
    )
    const scenarioPageText = await scenarioPage.text()

    expect(scenarioPage.status).toBe(200)
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
