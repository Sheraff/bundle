import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { pluginArtifactV1Schema } from '@workspace/contracts'
import * as v from 'valibot'
import { build, createBuilder } from 'vite'
import { afterEach, describe, expect, it } from 'vitest'

import { DEFAULT_ARTIFACT_RELATIVE_PATH, bundleTracker } from '../src/index.js'

const tempDirectories = new Set<string>()
const originalCwd = process.cwd()

afterEach(async () => {
  process.chdir(originalCwd)

  await Promise.all(
    [...tempDirectories].map(async (directory) => {
      await fs.rm(directory, { recursive: true, force: true })
    }),
  )

  tempDirectories.clear()
})

describe('bundleTracker', () => {
  it('writes one valid artifact under the working directory', async () => {
    const { appDir, runnerDir } = await createWorkspace({
      files: {
        'src/main.ts': "import './styles.css'\nconsole.log('bundle tracker')\n",
        'src/styles.css': 'body { color: rebeccapurple; }\n',
      },
    })

    process.chdir(runnerDir)

    await build({
      root: appDir,
      plugins: [bundleTracker({ scenario: 'minimal-react-app' })],
      build: {
        emptyOutDir: true,
        manifest: false,
        outDir: 'dist',
        rollupOptions: {
          input: path.join(appDir, 'src/main.ts'),
        },
      },
    })

    const artifactPath = path.join(runnerDir, DEFAULT_ARTIFACT_RELATIVE_PATH)
    const artifact = await readArtifact(artifactPath)
    const parsedArtifact = v.parse(pluginArtifactV1Schema, artifact)

    expect(parsedArtifact.build.rootDir).toBe(appDir)
    expect(parsedArtifact.scenario).toEqual({
      id: 'minimal-react-app',
      kind: 'fixture-app',
    })
    expect(parsedArtifact.environments).toHaveLength(1)
    expect(parsedArtifact.environments[0]?.manifest).not.toEqual({})
    expect(parsedArtifact.environments[0]?.chunks.length).toBeGreaterThan(0)

    const artifactDirectoryEntries = await fs.readdir(path.dirname(artifactPath))
    expect(artifactDirectoryEntries).toEqual(['artifact.json'])
  })

  it('aggregates multi-environment builds into one artifact', async () => {
    const { appDir, runnerDir } = await createWorkspace({
      files: {
        'src/entry-client.ts': "import './client.css'\nconsole.log('client')\n",
        'src/entry-ssr.ts': "console.log('ssr')\n",
        'src/client.css': 'body { background: black; }\n',
      },
    })

    process.chdir(runnerDir)

    const builder = await createBuilder({
      root: appDir,
      plugins: [bundleTracker({ scenario: 'client-ssr-app' })],
      build: {
        emptyOutDir: true,
        manifest: false,
        outDir: 'dist/client',
        rollupOptions: {
          input: {
            client: path.join(appDir, 'src/entry-client.ts'),
          },
        },
      },
      environments: {
        ssr: {
          consumer: 'server',
          build: {
            manifest: false,
            outDir: 'dist/ssr',
            ssr: path.join(appDir, 'src/entry-ssr.ts'),
          },
        },
      },
    })

    await builder.buildApp()

    const artifact = await readArtifact(path.join(runnerDir, DEFAULT_ARTIFACT_RELATIVE_PATH))
    const parsedArtifact = v.parse(pluginArtifactV1Schema, artifact)
    const environmentNames = parsedArtifact.environments.map((environment) => environment.name)

    expect(environmentNames).toEqual(['client', 'ssr'])
    expect(parsedArtifact.environments.every((environment) => Object.keys(environment.manifest).length > 0)).toBe(true)
  })

  it('fails the build when required emitted evidence is missing', async () => {
    const { appDir, runnerDir } = await createWorkspace({
      files: {
        'src/main.ts': "console.log('missing files')\n",
      },
    })

    process.chdir(runnerDir)

    await expect(
      build({
        root: appDir,
        plugins: [bundleTracker({ scenario: 'missing-evidence-app' })],
        build: {
          manifest: false,
          outDir: 'dist',
          rollupOptions: {
            input: path.join(appDir, 'src/main.ts'),
          },
          write: false,
        },
      }),
    ).rejects.toThrow(/manifest|Could not read/i)

    await expect(fs.access(path.join(runnerDir, DEFAULT_ARTIFACT_RELATIVE_PATH))).rejects.toThrow()
  })
})

async function createWorkspace(input: { files: Record<string, string> }) {
  const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), 'bundle-tracker-'))
  const appDir = path.join(workspaceDir, 'app')
  const runnerDir = path.join(workspaceDir, 'runner')

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
  const contents = await fs.readFile(filePath, 'utf8')
  return JSON.parse(contents)
}
