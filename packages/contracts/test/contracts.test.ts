import { describe, expect, it } from "vitest"
import * as v from "valibot"

import {
  acknowledgeComparisonItemInputSchema,
  comparePageSearchParamsSchema,
  normalizedSnapshotV1Schema,
  pluginArtifactV1Schema,
  queueMessageSchema,
  repositoryOverviewSearchParamsSchema,
  scenarioPageSearchParamsSchema,
  uploadScenarioRunAcceptedResponseV1Schema,
  uploadScenarioRunEnvelopeV1Schema,
  workflowInputSchema,
} from "../src/index.js"

const ulid = "01ARZ3NDEKTSV4RRFFQ69G5FAV"
const secondUlid = "01ARZ3NDEKTSV4RRFFQ69G5FAW"
const sha = "0123456789abcdef0123456789abcdef01234567"

function buildArtifact(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    pluginVersion: "0.1.0",
    generatedAt: "2026-04-06T12:00:00.000Z",
    scenario: {
      id: "minimal-react-app",
      kind: "fixture-app",
    },
    build: {
      bundler: "vite",
      bundlerVersion: "7.1.0",
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
            file: "assets/main.js",
            src: "src/main.ts",
            isEntry: true,
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
                renderedLength: 123,
                originalLength: 456,
              },
            ],
            sizes: {
              raw: 123,
              gzip: 45,
              brotli: 38,
            },
          },
        ],
        assets: [
          {
            fileName: "assets/main.css",
            names: ["main.css"],
            needsCodeReference: false,
            sizes: {
              raw: 10,
              gzip: 8,
              brotli: 6,
            },
          },
        ],
        warnings: [],
      },
    ],
    ...overrides,
  }
}

function buildEnvelope(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    artifact: buildArtifact(),
    repository: {
      githubRepoId: 123,
      owner: "acme",
      name: "widget",
      installationId: 456,
    },
    git: {
      commitSha: sha,
      branch: "main",
    },
    scenarioSource: {
      kind: "fixture-app",
    },
    ci: {
      provider: "github-actions",
      workflowRunId: "999",
    },
    ...overrides,
  }
}

function buildNormalizedSnapshot(overrides: Record<string, unknown> = {}) {
  const envelope = buildEnvelope()
  const environment = envelope.artifact.environments[0]

  return {
    schemaVersion: 1,
    normalizedAt: "2026-04-06T12:05:00.000Z",
    scenarioRunId: ulid,
    repositoryId: secondUlid,
    commitGroupId: "01ARZ3NDEKTSV4RRFFQ69G5FAX",
    scenario: envelope.artifact.scenario,
    scenarioSource: envelope.scenarioSource,
    repository: envelope.repository,
    git: envelope.git,
    ci: envelope.ci,
    build: {
      bundler: envelope.artifact.build.bundler,
      bundlerVersion: envelope.artifact.build.bundlerVersion,
      pluginVersion: envelope.artifact.pluginVersion,
      generatedAt: envelope.artifact.generatedAt,
      rootDir: envelope.artifact.build.rootDir,
    },
    raw: {
      artifactR2Key: `raw/scenario-runs/${ulid}/artifact.json`,
      envelopeR2Key: `raw/scenario-runs/${ulid}/envelope.json`,
      artifactSha256: "a".repeat(64),
      envelopeSha256: "b".repeat(64),
      artifactSchemaVersion: 1,
      uploadSchemaVersion: 1,
    },
    environments: [
      {
        name: environment.name,
        build: environment.build,
        entrypoints: [
          {
            key: "src/main.ts",
            kind: "entry",
            chunkFileName: "assets/main.js",
            manifestSourceKeys: ["src/main.ts"],
            facadeModule: {
              rawId: "/tmp/repo/src/main.ts",
              stableId: "src/main.ts",
              scope: "app",
            },
            importedCss: ["assets/main.css"],
            importedAssets: [],
            staticImportedChunkFileNames: [],
            dynamicImportedChunkFileNames: [],
          },
        ],
        chunks: [
          {
            fileName: "assets/main.js",
            fileLabel: "main.js",
            name: "main",
            isEntry: true,
            isDynamicEntry: false,
            facadeModule: {
              rawId: "/tmp/repo/src/main.ts",
              stableId: "src/main.ts",
              scope: "app",
            },
            manifestSourceKeys: ["src/main.ts"],
            ownerRoots: ["src/main.ts"],
            imports: [],
            dynamicImports: [],
            implicitlyLoadedBefore: [],
            importedCss: ["assets/main.css"],
            importedAssets: [],
            moduleIds: ["src/main.ts"],
            totalRenderedLength: 123,
            sizes: environment.chunks[0].sizes,
            modules: [
              {
                rawId: "/tmp/repo/src/main.ts",
                stableId: "src/main.ts",
                scope: "app",
                renderedLength: 123,
                originalLength: 456,
              },
            ],
          },
        ],
        assets: [
          {
            fileName: "assets/main.css",
            fileLabel: "main.css",
            kind: "css",
            names: ["main.css"],
            originalFileNames: [],
            sourceKeys: [],
            importerKeys: ["src/main.ts"],
            importerFiles: ["assets/main.js"],
            ownerRoots: ["src/main.ts"],
            needsCodeReference: false,
            sizes: environment.assets[0].sizes,
          },
        ],
        packages: [],
        chunkGraphEdges: [],
        assetRelations: [
          {
            kind: "css",
            chunkFileName: "assets/main.js",
            assetFileName: "assets/main.css",
          },
        ],
        warnings: [],
      },
    ],
    ...overrides,
  }
}

describe("pluginArtifactV1Schema", () => {
  it("accepts a valid artifact payload", () => {
    const result = v.safeParse(pluginArtifactV1Schema, buildArtifact())

    expect(result.success).toBe(true)
  })

  it("rejects duplicate environment names", () => {
    const artifact = buildArtifact({
      environments: [
        buildArtifact().environments[0],
        {
          ...buildArtifact().environments[0],
          build: { outDir: "dist-client" },
        },
      ],
    })

    const result = v.safeParse(pluginArtifactV1Schema, artifact)

    expect(result.success).toBe(false)
  })

  it("rejects an environment without a manifest", () => {
    const artifact = buildArtifact({
      environments: [
        {
          ...buildArtifact().environments[0],
          manifest: {},
        },
      ],
    })

    const result = v.safeParse(pluginArtifactV1Schema, artifact)

    expect(result.success).toBe(false)
  })

  it("allows optional originalFileNames on assets", () => {
    const artifact = buildArtifact({
      environments: [
        {
          ...buildArtifact().environments[0],
          assets: [
            {
              ...buildArtifact().environments[0].assets[0],
              originalFileNames: ["src/styles/main.css"],
            },
          ],
        },
      ],
    })

    const result = v.safeParse(pluginArtifactV1Schema, artifact)

    expect(result.success).toBe(true)
  })
})

describe("uploadScenarioRunEnvelopeV1Schema", () => {
  it("accepts a fixture-app envelope without a synthetic definition", () => {
    const result = v.safeParse(uploadScenarioRunEnvelopeV1Schema, buildEnvelope())

    expect(result.success).toBe(true)
  })

  it("requires syntheticDefinition for synthetic uploads", () => {
    const result = v.safeParse(
      uploadScenarioRunEnvelopeV1Schema,
      buildEnvelope({
        scenarioSource: { kind: "repo-synthetic" },
      }),
    )

    expect(result.success).toBe(false)
  })

  it("requires hostedScenarioId for hosted synthetic uploads", () => {
    const result = v.safeParse(
      uploadScenarioRunEnvelopeV1Schema,
      buildEnvelope({
        scenarioSource: { kind: "hosted-synthetic" },
        syntheticDefinition: {
          source: "export { Button } from '@acme/ui'",
        },
      }),
    )

    expect(result.success).toBe(false)
  })

  it("accepts a hosted synthetic envelope when both contracts are present", () => {
    const result = v.safeParse(
      uploadScenarioRunEnvelopeV1Schema,
      buildEnvelope({
        scenarioSource: {
          kind: "hosted-synthetic",
          hostedScenarioId: ulid,
        },
        syntheticDefinition: {
          displayName: "Button import",
          source: "export { Button } from '@acme/ui'",
        },
      }),
    )

    expect(result.success).toBe(true)
  })
})

describe("normalizedSnapshotV1Schema", () => {
  it("accepts a valid normalized snapshot payload", () => {
    const result = v.safeParse(normalizedSnapshotV1Schema, buildNormalizedSnapshot())

    expect(result.success).toBe(true)
  })

  it("rejects duplicate environment names", () => {
    const snapshot = buildNormalizedSnapshot({
      environments: [
        buildNormalizedSnapshot().environments[0],
        {
          ...buildNormalizedSnapshot().environments[0],
          build: { outDir: "dist-client" },
        },
      ],
    })

    const result = v.safeParse(normalizedSnapshotV1Schema, snapshot)

    expect(result.success).toBe(false)
  })

  it("rejects duplicate entrypoint keys within one environment", () => {
    const snapshot = buildNormalizedSnapshot({
      environments: [
        {
          ...buildNormalizedSnapshot().environments[0],
          entrypoints: [
            buildNormalizedSnapshot().environments[0].entrypoints[0],
            {
              ...buildNormalizedSnapshot().environments[0].entrypoints[0],
              chunkFileName: "assets/secondary.js",
            },
          ],
        },
      ],
    })

    const result = v.safeParse(normalizedSnapshotV1Schema, snapshot)

    expect(result.success).toBe(false)
  })
})

describe("uploadScenarioRunAcceptedResponseV1Schema", () => {
  it("accepts a queued upload acknowledgement", () => {
    const result = v.safeParse(uploadScenarioRunAcceptedResponseV1Schema, {
      schemaVersion: 1,
      accepted: true,
      repositoryId: ulid,
      commitGroupId: secondUlid,
      scenarioRunId: "01ARZ3NDEKTSV4RRFFQ69G5FAX",
      status: "queued",
    })

    expect(result.success).toBe(true)
  })

  it("rejects responses without an accepted flag", () => {
    const result = v.safeParse(uploadScenarioRunAcceptedResponseV1Schema, {
      schemaVersion: 1,
      repositoryId: ulid,
      commitGroupId: secondUlid,
      scenarioRunId: "01ARZ3NDEKTSV4RRFFQ69G5FAX",
      status: "queued",
    })

    expect(result.success).toBe(false)
  })
})

describe("queueMessageSchema", () => {
  it("requires schemaVersion, repositoryId, target id, and dedupeKey", () => {
    const result = v.safeParse(queueMessageSchema, {
      schemaVersion: 1,
      kind: "normalize-run",
      repositoryId: ulid,
      scenarioRunId: secondUlid,
    })

    expect(result.success).toBe(false)
  })

  it("accepts detail generation requests", () => {
    const result = v.safeParse(queueMessageSchema, {
      schemaVersion: 1,
      kind: "generate-detail",
      repositoryId: ulid,
      comparisonId: secondUlid,
      detailKind: "graph",
      dedupeKey: "comparison:graph:v1",
    })

    expect(result.success).toBe(true)
  })
})

describe("workflowInputSchema", () => {
  it("requires orchestrationKey on workflow inputs", () => {
    const result = v.safeParse(workflowInputSchema, {
      schemaVersion: 1,
      kind: "CommitGroupSettlementWorkflow",
      repositoryId: ulid,
      commitGroupId: secondUlid,
    })

    expect(result.success).toBe(false)
  })

  it("accepts repository backfill workflow inputs", () => {
    const result = v.safeParse(workflowInputSchema, {
      schemaVersion: 1,
      kind: "RepositoryBackfillWorkflow",
      repositoryId: ulid,
      backfillScope: "repository:all",
      orchestrationKey: "backfill:v1",
    })

    expect(result.success).toBe(true)
  })
})

describe("public route search params", () => {
  it("requires lens on repository overview routes", () => {
    const result = v.safeParse(repositoryOverviewSearchParamsSchema, {
      branch: "main",
    })

    expect(result.success).toBe(false)
  })

  it("requires lens on scenario routes", () => {
    const result = v.safeParse(scenarioPageSearchParamsSchema, {
      branch: "main",
      env: "all",
      entrypoint: "all",
    })

    expect(result.success).toBe(false)
  })

  it("allows compare routes without lens for top-level tables", () => {
    const result = v.safeParse(comparePageSearchParamsSchema, {
      base: sha,
      head: sha,
    })

    expect(result.success).toBe(true)
  })

  it("rejects compare routes that use all for env", () => {
    const result = v.safeParse(comparePageSearchParamsSchema, {
      base: sha,
      head: sha,
      env: "all",
    })

    expect(result.success).toBe(false)
  })
})

describe("mutation contracts", () => {
  it("requires the PR-scoped acknowledgement identifiers", () => {
    const result = v.safeParse(acknowledgeComparisonItemInputSchema, {
      repositoryId: ulid,
      pullRequestId: secondUlid,
      comparisonId: ulid,
      itemKey: "raw",
    })

    expect(result.success).toBe(false)
  })
})
