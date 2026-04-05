import path from 'node:path';
import { defineConfig } from 'vite';
import { stableIdentityCapturePlugin } from '../../../harness/capture-plugin.mjs';

function manualChunks(id) {
  const normalizedId = id.replaceAll('\\', '/');
  if (normalizedId.includes('/src/shared/')) {
    return 'bridge-core';
  }

  return undefined;
}

export default defineConfig({
  plugins: [
    stableIdentityCapturePlugin({
      fixtureId: 'ambiguous-shared',
      versionId: 'v1',
      scenarioId: 'ambiguous-shared',
      artifactFile: new URL('../../../artifacts/ambiguous-shared/v1.json', import.meta.url),
    }),
  ],
  build: {
    manifest: true,
    rollupOptions: {
      input: path.resolve('src/main.js'),
      output: {
        manualChunks,
      },
    },
  },
});
