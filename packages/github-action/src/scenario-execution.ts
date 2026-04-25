import { spawn } from "node:child_process"
import path from "node:path"

import { BUNDLE_ARTIFACT_OUTPUT_ENV_VAR } from "@workspace/contracts/shared"
import { type PluginArtifactV1 } from "@workspace/contracts/plugin-artifact"

import { loadArtifact, resetArtifactFile } from "./artifact-loading.js"
import { materializeSyntheticSource } from "./synthetic-source.js"

export async function runFixtureAppScenario(
  workingDirectory: string,
  command: string,
  artifactPath: string,
  env: NodeJS.ProcessEnv,
): Promise<PluginArtifactV1> {
  await resetArtifactFile(artifactPath)
  await runCommand(command, workingDirectory, {
    ...env,
    [BUNDLE_ARTIFACT_OUTPUT_ENV_VAR]: artifactPath,
  })

  const artifact = await loadArtifact(artifactPath)

  if (artifact.scenario.kind !== "fixture-app") {
    throw new Error(
      `Fixture-app mode expected a plugin-declared fixture-app artifact, received ${artifact.scenario.kind}`,
    )
  }

  return artifact
}

export async function runRepoSyntheticScenario(
  workingDirectory: string,
  scenario: string,
  source: string,
  artifactPath: string,
): Promise<PluginArtifactV1> {
  await resetArtifactFile(artifactPath)

  const syntheticSource = await materializeSyntheticSource(workingDirectory, scenario, source)
  const [{ build }, { bundleTracker }] = await Promise.all([
    import("vite"),
    import("@chunk-scope/vite-plugin"),
  ])

  try {
    await build({
      configFile: false,
      plugins: [
        bundleTracker({
          scenario,
          kind: "synthetic-import",
          artifactOutput: artifactPath,
        }),
      ],
      publicDir: false,
      root: workingDirectory,
      build: {
        emptyOutDir: true,
        manifest: false,
        outDir: path.relative(workingDirectory, syntheticSource.outDir),
        rollupOptions: {
          input: syntheticSource.entryFile,
        },
      },
    })

    const artifact = await loadArtifact(artifactPath)

    if (artifact.scenario.kind !== "synthetic-import") {
      throw new Error(
        `Synthetic-import mode expected a synthetic-import artifact, received ${artifact.scenario.kind}`,
      )
    }

    if (artifact.scenario.id !== scenario) {
      throw new Error(
        `Synthetic-import mode expected scenario ${scenario}, received ${artifact.scenario.id}`,
      )
    }

    return artifact
  } finally {
    await syntheticSource.cleanup()
  }
}

async function runCommand(command: string, workingDirectory: string, env: NodeJS.ProcessEnv) {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, {
      cwd: workingDirectory,
      env: {
        ...process.env,
        ...env,
      },
      shell: true,
      stdio: "inherit",
    })

    child.on("error", reject)
    child.on("exit", (code) => {
      if (code === 0) {
        resolve()
        return
      }

      reject(new Error(`Build command failed with exit code ${code}: ${command}`))
    })
  })
}
