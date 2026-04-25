import fs from "node:fs/promises"
import path from "node:path"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"

import { build } from "esbuild"

const packageDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

await fs.rm(path.join(packageDir, "dist"), { recursive: true, force: true })

await build({
  absWorkingDir: packageDir,
  bundle: true,
  entryPoints: ["src/index.ts"],
  external: ["vite"],
  format: "esm",
  outfile: "dist/index.js",
  platform: "node",
  target: "node20",
})

const declarations = spawnSync("pnpm", ["exec", "tsc", "--project", "tsconfig.build.json"], {
  cwd: packageDir,
  stdio: "inherit",
})

if (declarations.status !== 0) {
  process.exit(declarations.status ?? 1)
}
