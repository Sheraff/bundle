import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { stableIdentityCapturePlugin } from '../../../harness/capture-plugin.mjs';

function manualChunks(id) {
  const normalizedId = id.replaceAll('\\', '/');

  if (normalizedId.includes('/node_modules/')) {
    return 'vendor';
  }

  if (normalizedId.includes('/src/shared/')) {
    return 'shell-bundle';
  }

  return undefined;
}

export default defineConfig({
  plugins: [
    react(),
    stableIdentityCapturePlugin({
      fixtureId: 'react-routes',
      versionId: 'v3',
      scenarioId: 'react-routes',
      artifactFile: new URL('../../../artifacts/react-routes/v3.json', import.meta.url),
    }),
  ],
  build: {
    assetsInlineLimit: 0,
    manifest: true,
    rollupOptions: {
      input: path.resolve('src/main.jsx'),
      output: {
        manualChunks,
        entryFileNames: 'entries/[name]-[hash].js',
        chunkFileNames: 'chunks/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
    },
  },
});
