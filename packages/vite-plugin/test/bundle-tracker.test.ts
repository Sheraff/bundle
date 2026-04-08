import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { BUNDLE_ARTIFACT_OUTPUT_ENV_VAR } from "@workspace/contracts/shared"
import { pluginArtifactV1Schema } from "@workspace/contracts/plugin-artifact"
import * as v from "valibot"
import { build, createBuilder } from "vite"
import { afterEach, describe, expect, it } from "vitest"

import { DEFAULT_ARTIFACT_RELATIVE_PATH, bundleTracker } from "../src/index.js"

const tempDirectories = new Set<string>()
const originalCwd = process.cwd()
const originalArtifactOutputEnv = process.env[BUNDLE_ARTIFACT_OUTPUT_ENV_VAR]

afterEach(async () => {
  process.chdir(originalCwd)

  if (originalArtifactOutputEnv) {
    process.env[BUNDLE_ARTIFACT_OUTPUT_ENV_VAR] = originalArtifactOutputEnv
  } else {
    delete process.env[BUNDLE_ARTIFACT_OUTPUT_ENV_VAR]
  }

  await Promise.all(
    [...tempDirectories].map(async (directory) => {
      await fs.rm(directory, { recursive: true, force: true })
    }),
  )

  tempDirectories.clear()
})

describe("bundleTracker", () => {
  it("writes one valid artifact under the Vite root by default", async () => {
    const { appDir, runnerDir } = await createWorkspace({
      files: {
        "src/main.ts": "import './styles.css'\nconsole.log('bundle tracker')\n",
        "src/styles.css": "body { color: rebeccapurple; }\n",
      },
    })

    process.chdir(runnerDir)

    await build({
      root: appDir,
      plugins: [bundleTracker({ scenario: "minimal-react-app" })],
      build: {
        emptyOutDir: true,
        manifest: false,
        outDir: "dist",
        rollupOptions: {
          input: path.join(appDir, "src/main.ts"),
        },
      },
    })

    const artifactPath = path.join(appDir, DEFAULT_ARTIFACT_RELATIVE_PATH)
    const artifact = await readArtifact(artifactPath)
    const parsedArtifact = v.parse(pluginArtifactV1Schema, artifact)

    expect(parsedArtifact.build.rootDir).toBe(appDir)
    expect(parsedArtifact.scenario).toEqual({
      id: "minimal-react-app",
      kind: "fixture-app",
    })
    expect(parsedArtifact.environments).toHaveLength(1)
    expect(parsedArtifact.environments[0]?.manifest).not.toEqual({})
    expect(parsedArtifact.environments[0]?.chunks.length).toBeGreaterThan(0)

    await expect(fs.access(path.join(runnerDir, DEFAULT_ARTIFACT_RELATIVE_PATH))).rejects.toThrow()
  })

  it("writes one valid artifact to an explicit output path", async () => {
    const { appDir, runnerDir } = await createWorkspace({
      files: {
        "src/main.ts": "import './styles.css'\nconsole.log('bundle tracker')\n",
        "src/styles.css": "body { color: rebeccapurple; }\n",
      },
    })

    const artifactPath = path.join(runnerDir, DEFAULT_ARTIFACT_RELATIVE_PATH)

    await build({
      root: appDir,
      plugins: [
        bundleTracker({
          scenario: "minimal-react-app",
          artifactOutput: artifactPath,
        }),
      ],
      build: {
        emptyOutDir: true,
        manifest: false,
        outDir: "dist",
        rollupOptions: {
          input: path.join(appDir, "src/main.ts"),
        },
      },
    })

    const artifact = await readArtifact(artifactPath)
    const parsedArtifact = v.parse(pluginArtifactV1Schema, artifact)

    expect(parsedArtifact.build.rootDir).toBe(appDir)
    expect(parsedArtifact.scenario).toEqual({
      id: "minimal-react-app",
      kind: "fixture-app",
    })

    const artifactDirectoryEntries = await fs.readdir(path.dirname(artifactPath))
    expect(artifactDirectoryEntries).toEqual(["artifact.json"])
  })

  it("prefers the env artifact output over the configured option", async () => {
    const { appDir, runnerDir } = await createWorkspace({
      files: {
        "src/main.ts": "import './styles.css'\nconsole.log('bundle tracker')\n",
        "src/styles.css": "body { color: rebeccapurple; }\n",
      },
    })

    const envArtifactPath = path.join(runnerDir, DEFAULT_ARTIFACT_RELATIVE_PATH)
    const configuredArtifactPath = path.join(appDir, ".bundle", "configured-artifact.json")

    process.env[BUNDLE_ARTIFACT_OUTPUT_ENV_VAR] = envArtifactPath

    await build({
      root: appDir,
      plugins: [
        bundleTracker({
          scenario: "minimal-react-app",
          artifactOutput: configuredArtifactPath,
        }),
      ],
      build: {
        emptyOutDir: true,
        manifest: false,
        outDir: "dist",
        rollupOptions: {
          input: path.join(appDir, "src/main.ts"),
        },
      },
    })

    const artifact = await readArtifact(envArtifactPath)
    const parsedArtifact = v.parse(pluginArtifactV1Schema, artifact)

    expect(parsedArtifact.build.rootDir).toBe(appDir)
    await expect(fs.access(configuredArtifactPath)).rejects.toThrow()
  })

  it("aggregates multi-environment builds into one artifact", async () => {
    const { appDir, runnerDir } = await createWorkspace({
      files: {
        "src/entry-client.ts": "import './client.css'\nconsole.log('client')\n",
        "src/entry-ssr.ts": "console.log('ssr')\n",
        "src/client.css": "body { background: black; }\n",
      },
    })

    const artifactPath = path.join(runnerDir, DEFAULT_ARTIFACT_RELATIVE_PATH)

    const builder = await createBuilder({
      root: appDir,
      plugins: [
        bundleTracker({
          scenario: "client-ssr-app",
          artifactOutput: artifactPath,
        }),
      ],
      build: {
        emptyOutDir: true,
        manifest: false,
        outDir: "dist/client",
        rollupOptions: {
          input: {
            client: path.join(appDir, "src/entry-client.ts"),
          },
        },
      },
      environments: {
        ssr: {
          consumer: "server",
          build: {
            manifest: false,
            outDir: "dist/ssr",
            ssr: path.join(appDir, "src/entry-ssr.ts"),
          },
        },
      },
    })

    await builder.buildApp()

    const artifact = await readArtifact(artifactPath)
    const parsedArtifact = v.parse(pluginArtifactV1Schema, artifact)
    const environmentNames = parsedArtifact.environments.map((environment) => environment.name)

    expect(environmentNames).toEqual(["client", "ssr"])
    expect(
      parsedArtifact.environments.every(
        (environment) => Object.keys(environment.manifest).length > 0,
      ),
    ).toBe(true)
  })

  it("fails the build when required emitted evidence is missing", async () => {
    const { appDir, runnerDir } = await createWorkspace({
      files: {
        "src/main.ts": "console.log('missing files')\n",
      },
    })

    const artifactPath = path.join(runnerDir, DEFAULT_ARTIFACT_RELATIVE_PATH)

    await expect(
      build({
        root: appDir,
        plugins: [
          bundleTracker({
            scenario: "missing-evidence-app",
            artifactOutput: artifactPath,
          }),
        ],
        build: {
          manifest: false,
          outDir: "dist",
          rollupOptions: {
            input: path.join(appDir, "src/main.ts"),
          },
          write: false,
        },
      }),
    ).rejects.toThrow(/manifest|Could not read/i)

    await expect(fs.access(artifactPath)).rejects.toThrow()
  })
})

async function createWorkspace(input: { files: Record<string, string> }) {
  const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "bundle-tracker-"))
  const appDir = path.join(workspaceDir, "app")
  const runnerDir = path.join(workspaceDir, "runner")

  tempDirectories.add(workspaceDir)

  await fs.mkdir(appDir, { recursive: true })
  await fs.mkdir(runnerDir, { recursive: true })

  await Promise.all(
    Object.entries(input.files).map(async ([relativePath, contents]) => {
      const filePath = path.join(appDir, relativePath)
      await fs.mkdir(path.dirname(filePath), { recursive: true })
      await fs.writeFile(filePath, contents)
    }),
  )

  return { appDir, runnerDir }
}

async function readArtifact(filePath: string) {
  const contents = await fs.readFile(filePath, "utf8")
  return JSON.parse(contents)
}
