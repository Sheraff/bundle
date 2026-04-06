import * as core from '@actions/core'

import { runAction } from './run.js'

async function main() {
  try {
    const result = await runAction({
      command: core.getInput('command') || undefined,
      source: core.getInput('source') || undefined,
      workingDirectory: core.getInput('working-directory') || undefined,
      scenario: core.getInput('scenario') || undefined,
    })

    core.setOutput('artifact-path', result.artifactPath)
    core.setOutput('mode', result.mode)
    core.setOutput('scenario', result.scenarioId)
  } catch (error) {
    core.setFailed(error instanceof Error ? error.message : String(error))
  }
}

void main()
