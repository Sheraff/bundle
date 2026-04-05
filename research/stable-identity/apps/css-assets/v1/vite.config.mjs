import path from 'node:path';
import { defineConfig } from 'vite';
import { stableIdentityCapturePlugin } from '../../../harness/capture-plugin.mjs';

function manualChunks(id) {
  const normalizedId = id.replaceAll('\\', '/');
  if (normalizedId.includes('/src/shared/')) {
    return 'skin-one';
  }

  return undefined;
}

export default defineConfig({
  plugins: [
    stableIdentityCapturePlugin({
      fixtureId: 'css-assets',
      versionId: 'v1',
      scenarioId: 'css-assets',
      artifactFile: new URL('../../../artifacts/css-assets/v1.json', import.meta.url),
    }),
  ],
  build: {
    assetsInlineLimit: 0,
    manifest: true,
    rollupOptions: {
      input: {
        landing: path.resolve('src/landing.js'),
        workbench: path.resolve('src/workbench.js'),
      },
      output: {
        manualChunks,
      },
    },
  },
});
