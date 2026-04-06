import { spawn } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'

import {
  DEFAULT_ARTIFACT_RELATIVE_PATH,
  SCHEMA_VERSION_V1,
  pluginArtifactV1Schema,
  uploadScenarioRunEnvelopeV1Schema,
  type PluginArtifactV1,
  type UploadScenarioRunEnvelopeV1,
} from '@workspace/contracts'
import { bundleTracker } from '@workspace/vite-plugin'
import * as v from 'valibot'
import { build } from 'vite'

import { collectGithubContext } from './github-context.js'
import { parseActionInputs, type RawActionInputs } from './inputs.js'
import { parseUploadRuntimeConfig, uploadScenarioRunEnvelope } from './upload.js'

const GENERATED_SCENARIOS_DIRECTORY = path.join('.bundle', 'generated', 'scenarios')

export interface ActionRunOptions {
  cwd?: string
  env?: NodeJS.ProcessEnv
  fetch?: typeof fetch
}

export interface ActionRunResult {
  artifactPath: string
  envelope: UploadScenarioRunEnvelopeV1
  mode: 'fixture-app' | 'repo-synthetic'
  scenarioId: string
  uploadUrl: string
}

export async function runAction(
  rawInputs: RawActionInputs,
  options: ActionRunOptions = {},
): Promise<ActionRunResult> {
  const parsedInputs = parseActionInputs(rawInputs, options.cwd ?? process.cwd())
  const runtimeEnvironment = options.env ?? process.env
  const uploadConfig = parseUploadRuntimeConfig(runtimeEnvironment)
  const githubContext = await collectGithubContext(runtimeEnvironment, uploadConfig.installationId)
  const artifactPath = path.join(parsedInputs.workingDirectory, DEFAULT_ARTIFACT_RELATIVE_PATH)

  const artifact =
    parsedInputs.mode === 'fixture-app'
      ? await runFixtureAppScenario(
          parsedInputs.workingDirectory,
          parsedInputs.command,
          artifactPath,
          runtimeEnvironment,
        )
      : await runRepoSyntheticScenario(
          parsedInputs.workingDirectory,
          parsedInputs.scenario,
          parsedInputs.source,
          artifactPath,
        )

  const envelope = buildUploadEnvelope(parsedInputs, artifact, githubContext)
  const uploadResult = await uploadScenarioRunEnvelope(
    envelope,
    uploadConfig,
    options.fetch ?? fetch,
  )

  return {
    artifactPath,
    envelope,
    mode: parsedInputs.mode,
    scenarioId: artifact.scenario.id,
    uploadUrl: uploadResult.uploadUrl,
  }
}

async function runFixtureAppScenario(
  workingDirectory: string,
  command: string,
  artifactPath: string,
  env: NodeJS.ProcessEnv,
) {
  await resetArtifactFile(artifactPath)
  await runCommand(command, workingDirectory, env)

  const artifact = await readArtifact(artifactPath)

  if (artifact.scenario.kind !== 'fixture-app') {
    throw new Error(
      `Fixture-app mode expected a plugin-declared fixture-app artifact, received ${artifact.scenario.kind}`,
    )
  }

  return artifact
}

async function runRepoSyntheticScenario(
  workingDirectory: string,
  scenario: string,
  source: string,
  artifactPath: string,
) {
  await resetArtifactFile(artifactPath)

  const syntheticEntryFile = path.join(
    workingDirectory,
    `.bundle.synthetic-${scenario}.mjs`,
  )
  const syntheticOutDir = path.join(
    workingDirectory,
    GENERATED_SCENARIOS_DIRECTORY,
    scenario,
    'dist',
  )

  await fs.mkdir(path.dirname(syntheticEntryFile), { recursive: true })
  await fs.writeFile(syntheticEntryFile, ensureTrailingNewline(source))

  await withWorkingDirectory(workingDirectory, async () => {
    await build({
      configFile: false,
      plugins: [bundleTracker({ scenario, kind: 'synthetic-import' })],
      publicDir: false,
      root: workingDirectory,
      build: {
        emptyOutDir: true,
        manifest: false,
        outDir: path.relative(workingDirectory, syntheticOutDir),
        rollupOptions: {
          input: syntheticEntryFile,
        },
      },
    })
  })

  const artifact = await readArtifact(artifactPath)

  if (artifact.scenario.kind !== 'synthetic-import') {
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
}

function buildUploadEnvelope(
  parsedInputs: ReturnType<typeof parseActionInputs>,
  artifact: PluginArtifactV1,
  githubContext: Awaited<ReturnType<typeof collectGithubContext>>,
) {
  const candidateEnvelope = {
    schemaVersion: SCHEMA_VERSION_V1,
    artifact,
    repository: githubContext.repository,
    git: githubContext.git,
    ...(githubContext.pullRequest ? { pullRequest: githubContext.pullRequest } : {}),
    ci: githubContext.ci,
    ...(parsedInputs.mode === 'fixture-app'
      ? {
          scenarioSource: {
            kind: 'fixture-app' as const,
          },
        }
      : {
          scenarioSource: {
            kind: 'repo-synthetic' as const,
          },
          syntheticDefinition: {
            source: parsedInputs.source,
          },
        }),
  }

  const result = v.safeParse(uploadScenarioRunEnvelopeV1Schema, candidateEnvelope)

  if (!result.success) {
    throw new Error(`Generated upload envelope is invalid: ${formatIssues(result.issues)}`)
  }

  return result.output
}

async function resetArtifactFile(artifactPath: string) {
  await fs.rm(artifactPath, { force: true })
}

async function readArtifact(filePath: string) {
  let contents: string

  try {
    contents = await fs.readFile(filePath, 'utf8')
  } catch (error) {
    throw new Error(`Could not find the expected artifact at ${filePath}`, { cause: error })
  }

  let parsedArtifact: unknown

  try {
    parsedArtifact = JSON.parse(contents)
  } catch (error) {
    throw new Error(`Could not parse the artifact at ${filePath}`, { cause: error })
  }

  const result = v.safeParse(pluginArtifactV1Schema, parsedArtifact)

  if (!result.success) {
    throw new Error(`Artifact at ${filePath} is invalid: ${formatIssues(result.issues)}`)
  }

  return result.output
}

async function runCommand(
  command: string,
  workingDirectory: string,
  env: NodeJS.ProcessEnv,
) {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, {
      cwd: workingDirectory,
      env: {
        ...process.env,
        ...env,
      },
      shell: true,
      stdio: 'inherit',
    })

    child.on('error', reject)
    child.on('exit', (code) => {
      if (code === 0) {
        resolve()
        return
      }

      reject(new Error(`Build command failed with exit code ${code}: ${command}`))
    })
  })
}

async function withWorkingDirectory<T>(workingDirectory: string, fn: () => Promise<T>) {
  const originalWorkingDirectory = process.cwd()
  process.chdir(workingDirectory)

  try {
    return await fn()
  } finally {
    process.chdir(originalWorkingDirectory)
  }
}

function ensureTrailingNewline(value: string) {
  return value.endsWith('\n') ? value : `${value}\n`
}

function formatIssues(issues: readonly { message: string }[]) {
  return issues.map((issue) => issue.message).join('; ')
}
