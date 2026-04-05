import path from 'node:path';
import { defineConfig } from 'vite';
import { stableIdentityCapturePlugin } from '../../../harness/capture-plugin.mjs';

function manualChunks(id) {
  const normalizedId = id.replaceAll('\\', '/');
  if (
    normalizedId.includes('/src/shared/platform.js') ||
    normalizedId.includes('/src/shared/renderPanel.js')
  ) {
    return 'portal-core';
  }

  if (
    normalizedId.includes('/src/shared/featureFlags.js') ||
    normalizedId.includes('/src/shared/themeTokens.js')
  ) {
    return 'portal-theme';
  }

  return undefined;
}

export default defineConfig({
  plugins: [
    stableIdentityCapturePlugin({
      fixtureId: 'multi-entry-manifest',
      versionId: 'v2',
      scenarioId: 'multi-entry-manifest',
      artifactFile: new URL('../../../artifacts/multi-entry-manifest/v2.json', import.meta.url),
    }),
  ],
  build: {
    assetsInlineLimit: 0,
    manifest: true,
    rollupOptions: {
      input: {
        storefront: path.resolve('src/storefront.js'),
        admin: path.resolve('src/admin.js'),
      },
      output: {
        manualChunks,
      },
    },
  },
});
