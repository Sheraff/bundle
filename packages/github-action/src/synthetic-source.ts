import fs from "node:fs/promises"
import path from "node:path"

const GENERATED_SCENARIOS_DIRECTORY = path.join(".bundle", "generated", "scenarios")

export interface SyntheticSourceFiles {
  cleanup(): Promise<void>
  entryFile: string
  outDir: string
}

export async function materializeSyntheticSource(
  workingDirectory: string,
  scenario: string,
  source: string,
): Promise<SyntheticSourceFiles> {
  const entryFile = path.join(workingDirectory, `.bundle.synthetic-${scenario}.mjs`)
  const outDir = path.join(workingDirectory, GENERATED_SCENARIOS_DIRECTORY, scenario, "dist")

  await fs.mkdir(path.dirname(entryFile), { recursive: true })
  await fs.writeFile(entryFile, ensureTrailingNewline(source))

  return {
    entryFile,
    outDir,
    async cleanup() {
      await fs.rm(entryFile, { force: true })
    },
  }
}

function ensureTrailingNewline(value: string) {
  return value.endsWith("\n") ? value : `${value}\n`
}
