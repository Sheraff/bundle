import path from "node:path"
import { defineConfig } from "vite"
import { stableIdentityCapturePlugin } from "../../../harness/capture-plugin.mjs"

function manualChunks(id) {
  const normalizedId = id.replaceAll("\\", "/")
  if (normalizedId.includes("/src/shared/")) {
    return "portal-base"
  }

  return undefined
}

export default defineConfig({
  plugins: [
    stableIdentityCapturePlugin({
      fixtureId: "multi-entry-manifest",
      versionId: "v3",
      scenarioId: "multi-entry-manifest",
      artifactFile: new URL("../../../artifacts/multi-entry-manifest/v3.json", import.meta.url),
    }),
  ],
  build: {
    assetsInlineLimit: 0,
    manifest: true,
    rollupOptions: {
      input: {
        storefront: path.resolve("src/storefront.js"),
        admin: path.resolve("src/admin.js"),
      },
      output: {
        manualChunks,
        entryFileNames: "entries/[name]-[hash].js",
        chunkFileNames: "chunks/[name]-[hash].js",
        assetFileNames: "static/[name]-[hash][extname]",
      },
    },
  },
})
