import path from 'node:path';
import { defineConfig } from 'vite';
import { stableIdentityCapturePlugin } from '../../../harness/capture-plugin.mjs';

export default defineConfig({
  plugins: [
    stableIdentityCapturePlugin({
      fixtureId: 'auto-chunk-routes',
      versionId: 'v1',
      scenarioId: 'auto-chunk-routes',
      artifactFile: new URL('../../../artifacts/auto-chunk-routes/v1.json', import.meta.url),
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
