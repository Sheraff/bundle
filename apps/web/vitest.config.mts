import path from 'node:path'

import { cloudflareTest } from '@cloudflare/vitest-pool-workers'
import { readD1Migrations } from '@cloudflare/vitest-pool-workers'
import react from '@vitejs/plugin-react'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [
    ...tanstackStart(),
    react(),
    cloudflareTest(async () => {
      const migrations = await readD1Migrations(path.join(import.meta.dirname, 'drizzle'))

      return {
        main: './src/index.ts',
        wrangler: {
          configPath: './wrangler.test.jsonc',
        },
        miniflare: {
          bindings: {
            GITHUB_APP_PRIVATE_KEY: 'test-private-key',
            TEST_MIGRATIONS: migrations,
          },
        },
      }
    }),
  ],
  test: {
    globals: true,
    setupFiles: ['./test/setup.ts'],
    exclude: ['test/**/*.helpers.test.ts'],
  },
})
