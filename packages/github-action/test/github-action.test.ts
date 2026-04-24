import fs from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

import {
  BUNDLE_ARTIFACT_OUTPUT_ENV_VAR,
  DEFAULT_ARTIFACT_RELATIVE_PATH,
} from "@workspace/contracts/shared"
import { afterEach, describe, expect, it, vi } from "vitest"

import { parseActionInputs, runAction } from "../src/index.js"

const coreMock = vi.hoisted(() => ({
  getIDToken: vi.fn(),
  getInput: vi.fn(),
  setFailed: vi.fn(),
  setOutput: vi.fn(),
}))

vi.mock("@actions/core", () => coreMock)

const tempDirectories = new Set<string>()
const packageDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const sha = "0123456789abcdef0123456789abcdef01234567"

afterEach(async () => {
  await Promise.all(
    [...tempDirectories].map(async (directory) => {
      await fs.rm(directory, { recursive: true, force: true })
    }),
  )

  tempDirectories.clear()
  coreMock.getIDToken.mockReset()
  vi.restoreAllMocks()
})

describe("parseActionInputs", () => {
  it("rejects command and source together", () => {
    expect(() =>
      parseActionInputs({
        command: "pnpm build",
        source: "export { Button } from '@acme/ui'",
      }),
    ).toThrow(/command and source cannot both be provided/i)
  })
})

describe("runAction", () => {
  it("builds and uploads a repo-defined synthetic-import scenario", async () => {
    const workingDirectory = await createTempDirectory("synthetic-")

    await writeFiles(workingDirectory, {
      "src/library.ts": "export const buttonLabel = 'Button'\n",
    })

    let uploadedBody = ""
    coreMock.getIDToken.mockResolvedValue("oidc-token")
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      const url = toRequestUrl(input)

      if (url === "https://bundle.example.com/api/v1/uploads/github-actions/token") {
        expect(JSON.parse(requireRequestBodyText(init))).toEqual({ token: "oidc-token" })
        return Response.json({
          expiresAt: "2026-04-06T12:10:00.000Z",
          installationId: 456,
          repositoryId: "01ARZ3NDEKTSV4RRFFQ69G5FAV",
          token: "scoped-upload-token",
        })
      }

      uploadedBody = requireRequestBodyText(init)
      expect(url).toBe("https://bundle.example.com/api/v1/uploads/scenario-runs")
      expect(init?.headers).toMatchObject({
        authorization: "Bearer scoped-upload-token",
      })
      return new Response('{"ok":true}', { status: 202 })
    })

    const result = await runAction(
      {
        workingDirectory,
        scenario: "button-cost",
        source: "export { buttonLabel } from './src/library.ts'",
      },
      {
        env: await createActionEnvironment(workingDirectory),
        fetch: fetchMock,
      },
    )

    const uploadedEnvelope = JSON.parse(uploadedBody)
    const generatedEntryFile = path.join(workingDirectory, ".bundle.synthetic-button-cost.mjs")

    expect(result.mode).toBe("repo-synthetic")
    expect(result.scenarioId).toBe("button-cost")
    await expect(fs.access(generatedEntryFile)).rejects.toThrow()
    expect(uploadedEnvelope.scenarioSource).toEqual({ kind: "repo-synthetic" })
    expect(uploadedEnvelope.syntheticDefinition).toEqual({
      source: "export { buttonLabel } from './src/library.ts'",
    })
    expect(uploadedEnvelope.artifact.scenario).toEqual({
      id: "button-cost",
      kind: "synthetic-import",
    })
    expect(uploadedEnvelope.repository.installationId).toBe(456)
    expect(uploadedEnvelope.git.branch).toBe("main")
    expect(uploadedEnvelope.ci.workflowRunAttempt).toBe(2)
    expect(coreMock.getIDToken).toHaveBeenCalledWith("https://bundle.example.com")
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it("runs a fixture-app command and uploads the plugin artifact", async () => {
    const workingDirectory = await createTempDirectory("fixture-")
    const expectedArtifactPath = path.join(workingDirectory, DEFAULT_ARTIFACT_RELATIVE_PATH)

    await writeFiles(workingDirectory, {
      "write-artifact.mjs": [
        "import fs from 'node:fs/promises'",
        "import path from 'node:path'",
        "",
        `const artifactPath = process.env.${BUNDLE_ARTIFACT_OUTPUT_ENV_VAR}`,
        "if (!artifactPath) throw new Error('Missing artifact output env')",
        "const artifact = {",
        "  schemaVersion: 1,",
        "  pluginVersion: '0.0.0',",
        "  generatedAt: '2026-04-06T12:00:00.000Z',",
        "  scenario: {",
        "    id: 'fixture-app-cost',",
        "    kind: 'fixture-app',",
        "  },",
        "  build: {",
        "    bundler: 'vite',",
        "    bundlerVersion: '8.0.4',",
        "    rootDir: path.join(process.cwd(), 'apps/web'),",
        "  },",
        "  environments: [",
        "    {",
        "      name: 'default',",
        "      build: {",
        "        outDir: 'dist',",
        "      },",
        "      manifest: {",
        "        'src/main.ts': {",
        "          file: 'assets/main.js',",
        "          src: 'src/main.ts',",
        "          isEntry: true,",
        "        },",
        "      },",
        "      chunks: [",
        "        {",
        "          fileName: 'assets/main.js',",
        "          name: 'main',",
        "          isEntry: true,",
        "          isDynamicEntry: false,",
        "          facadeModuleId: 'src/main.ts',",
        "          imports: [],",
        "          dynamicImports: [],",
        "          implicitlyLoadedBefore: [],",
        "          importedCss: [],",
        "          importedAssets: [],",
        "          modules: [",
        "            {",
        "              rawId: 'src/main.ts',",
        "              renderedLength: 123,",
        "              originalLength: 123,",
        "            },",
        "          ],",
        "          sizes: {",
        "            raw: 123,",
        "            gzip: 45,",
        "            brotli: 38,",
        "          },",
        "        },",
        "      ],",
        "      assets: [],",
        "      warnings: [],",
        "    },",
        "  ],",
        "}",
        "",
        "await fs.mkdir(path.dirname(artifactPath), { recursive: true })",
        "await fs.writeFile(artifactPath, `${JSON.stringify(artifact, null, 2)}\\n`)",
        "",
      ].join("\n"),
    })

    let uploadedBody = ""
    coreMock.getIDToken.mockResolvedValue("oidc-token")
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      const url = toRequestUrl(input)

      if (url === "https://bundle.example.com/api/v1/uploads/github-actions/token") {
        return Response.json({
          expiresAt: "2026-04-06T12:10:00.000Z",
          installationId: 456,
          repositoryId: "01ARZ3NDEKTSV4RRFFQ69G5FAV",
          token: "scoped-upload-token",
        })
      }

      uploadedBody = requireRequestBodyText(init)
      return new Response('{"ok":true}', { status: 202 })
    })

    const result = await runAction(
      {
        command: "node write-artifact.mjs",
        workingDirectory,
      },
      {
        env: await createActionEnvironment(workingDirectory),
        fetch: fetchMock,
      },
    )

    const uploadedEnvelope = JSON.parse(uploadedBody)

    expect(result.artifactPath).toBe(expectedArtifactPath)
    expect(result.mode).toBe("fixture-app")
    expect(result.scenarioId).toBe("fixture-app-cost")
    expect(uploadedEnvelope.scenarioSource).toEqual({ kind: "fixture-app" })
    expect(uploadedEnvelope.syntheticDefinition).toBeUndefined()
    expect(uploadedEnvelope.artifact.scenario).toEqual({
      id: "fixture-app-cost",
      kind: "fixture-app",
    })
  })

  it("fails when the fixture-app command does not produce the artifact", async () => {
    const workingDirectory = await createTempDirectory("missing-artifact-")

    await expect(
      runAction(
        {
          command: "node --eval \"console.log('noop')\"",
          workingDirectory,
        },
        {
          env: await createActionEnvironment(workingDirectory),
          fetch: vi.fn<typeof fetch>(),
        },
      ),
    ).rejects.toThrow(/Could not find the expected artifact/i)
  })
})

async function createTempDirectory(prefix: string) {
  const directory = await fs.mkdtemp(path.join(packageDir, `.tmp-${prefix}`))
  tempDirectories.add(directory)
  return directory
}

async function writeFiles(rootDirectory: string, files: Record<string, string>) {
  await Promise.all(
    Object.entries(files).map(async ([relativePath, contents]) => {
      const filePath = path.join(rootDirectory, relativePath)
      await fs.mkdir(path.dirname(filePath), { recursive: true })
      await fs.writeFile(filePath, contents)
    }),
  )
}

function toRequestUrl(input: Parameters<typeof fetch>[0]) {
  if (typeof input === "string") {
    return input
  }

  return input instanceof URL ? input.toString() : input.url
}

function requireRequestBodyText(init?: RequestInit) {
  if (typeof init?.body !== "string") {
    throw new Error("Expected a string request body")
  }

  return init.body
}

async function createActionEnvironment(workingDirectory: string) {
  const eventPath = path.join(workingDirectory, "github-event.json")

  await fs.writeFile(
    eventPath,
    `${JSON.stringify(
      {
        ref: "refs/heads/main",
        repository: {
          id: 123,
          full_name: "acme/widget",
          name: "widget",
          owner: {
            login: "acme",
          },
        },
      },
      null,
      2,
    )}\n`,
  )

  return {
    BUNDLE_API_ORIGIN: "https://bundle.example.com",
    GITHUB_ACTION_REF: "v1",
    GITHUB_EVENT_NAME: "push",
    GITHUB_EVENT_PATH: eventPath,
    GITHUB_JOB: "build",
    GITHUB_REF_NAME: "main",
    GITHUB_REPOSITORY: "acme/widget",
    GITHUB_REPOSITORY_ID: "123",
    GITHUB_RUN_ATTEMPT: "2",
    GITHUB_RUN_ID: "999",
    GITHUB_SHA: sha,
  } satisfies NodeJS.ProcessEnv
}
