import path from 'node:path';
import { defineConfig } from 'vite';
import { stableIdentityCapturePlugin } from '../../../harness/capture-plugin.mjs';

export default defineConfig({
  plugins: [
    stableIdentityCapturePlugin({
      fixtureId: 'auto-chunk-routes',
      versionId: 'v2',
      scenarioId: 'auto-chunk-routes',
      artifactFile: new URL('../../../artifacts/auto-chunk-routes/v2.json', import.meta.url),
    }),
  ],
  build: {
    assetsInlineLimit: 0,
    manifest: true,
    rollupOptions: {
      input: path.resolve('src/main.js'),
    },
  },
});
