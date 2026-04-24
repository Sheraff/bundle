import path from "node:path"

import { DEFAULT_ARTIFACT_RELATIVE_PATH } from "@workspace/contracts/shared"
import { type UploadScenarioRunEnvelopeV1 } from "@workspace/contracts/upload-envelope"

import { buildUploadEnvelope } from "./envelope-builder.js"
import { collectGithubContext } from "./github-context.js"
import { parseActionInputs, type RawActionInputs } from "./inputs.js"
import { runFixtureAppScenario, runRepoSyntheticScenario } from "./scenario-execution.js"
import {
  fetchUploadRuntimeCredentials,
  parseUploadRuntimeConfig,
  uploadScenarioRunEnvelope,
} from "./upload.js"

export interface ActionRunOptions {
  cwd?: string
  env?: NodeJS.ProcessEnv
  fetch?: typeof fetch
}

export interface ActionRunResult {
  artifactPath: string
  envelope: UploadScenarioRunEnvelopeV1
  mode: "fixture-app" | "repo-synthetic"
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
  const artifactPath = path.join(parsedInputs.workingDirectory, DEFAULT_ARTIFACT_RELATIVE_PATH)

  const artifact =
    parsedInputs.mode === "fixture-app"
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

  const uploadCredentials = await fetchUploadRuntimeCredentials(
    uploadConfig,
    options.fetch ?? fetch,
  )
  const githubContext = await collectGithubContext(
    runtimeEnvironment,
    uploadCredentials.installationId,
  )
  const envelope = buildUploadEnvelope(parsedInputs, artifact, githubContext)
  const uploadResult = await uploadScenarioRunEnvelope(
    envelope,
    {
      apiOrigin: uploadConfig.apiOrigin,
      uploadToken: uploadCredentials.token,
    },
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
