import path from 'node:path';
import { defineConfig } from 'vite';
import { stableIdentityCapturePlugin } from '../../../harness/capture-plugin.mjs';

export default defineConfig({
  plugins: [
    stableIdentityCapturePlugin({
      fixtureId: 'rename-moves',
      versionId: 'v3',
      scenarioId: 'rename-moves',
      artifactFile: new URL('../../../artifacts/rename-moves/v3.json', import.meta.url),
    }),
  ],
  build: {
    assetsInlineLimit: 0,
    manifest: true,
    rollupOptions: {
      input: path.resolve('src/main.js'),
      output: {
        entryFileNames: 'entries/[name]-[hash].js',
        chunkFileNames: 'chunks/[name]-[hash].js',
        assetFileNames: 'static/[name]-[hash][extname]',
      },
    },
  },
});
