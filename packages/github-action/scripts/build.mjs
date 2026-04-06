import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { build } from 'esbuild'

const packageDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

await fs.rm(path.join(packageDir, 'dist'), { recursive: true, force: true })

await build({
  absWorkingDir: packageDir,
  bundle: true,
  entryPoints: ['src/main.ts'],
  external: ['fsevents'],
  format: 'esm',
  outfile: 'dist/index.js',
  platform: 'node',
  target: 'node20',
})
