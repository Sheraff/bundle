import fs from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { build } from "esbuild"

const packageDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

await fs.rm(path.join(packageDir, "dist"), { recursive: true, force: true })

await build({
  absWorkingDir: packageDir,
  banner: {
    js: 'import { createRequire as __bundleCreateRequire } from "node:module"; const require = __bundleCreateRequire(import.meta.url);',
  },
  bundle: true,
  entryPoints: ["src/main.ts"],
  external: ["fsevents", "vite"],
  format: "esm",
  outfile: "dist/index.js",
  platform: "node",
  target: "node20",
})
