import path from 'node:path';
import { defineConfig } from 'vite';
import { stableIdentityCapturePlugin } from '../../../harness/capture-plugin.mjs';

function manualChunks(id) {
  const normalizedId = id.replaceAll('\\', '/');
  if (normalizedId.includes('/src/shared/')) {
    return 'fabric-core';
  }

  return undefined;
}

export default defineConfig({
  plugins: [
    stableIdentityCapturePlugin({
      fixtureId: 'css-assets',
      versionId: 'v3',
      scenarioId: 'css-assets',
      artifactFile: new URL('../../../artifacts/css-assets/v3.json', import.meta.url),
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
        entryFileNames: 'entries/[name]-[hash].js',
        chunkFileNames: 'chunks/[name]-[hash].js',
        assetFileNames: (assetInfo) => {
          const name = assetInfo.names?.[0] ?? 'asset';
          if (name.endsWith('.css')) {
            return 'styles/[name]-[hash][extname]';
          }

          return 'static/[name]-[hash][extname]';
        },
      },
    },
  },
});
