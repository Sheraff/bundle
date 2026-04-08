import path from "node:path"
import { defineConfig } from "vite"
import { stableIdentityCapturePlugin } from "../../../harness/capture-plugin.mjs"

function manualClientChunks(id) {
  const normalizedId = id.replaceAll("\\", "/")
  if (
    normalizedId.includes("/src/shared/clientFrame.js") ||
    normalizedId.includes("/src/shared/renderMetrics.js")
  ) {
    return "browser-shell"
  }

  if (normalizedId.includes("/src/shared/formatBytes.js")) {
    return "browser-format"
  }

  return undefined
}

function manualServerChunks(id) {
  const normalizedId = id.replaceAll("\\", "/")
  if (
    normalizedId.includes("/src/shared/server") ||
    normalizedId.includes("/src/shared/formatBytes.js")
  ) {
    return "server-shell"
  }

  return undefined
}

export default defineConfig(() => {
  return {
    plugins: [
      stableIdentityCapturePlugin({
        fixtureId: "client-ssr",
        versionId: "v2",
        scenarioId: "client-ssr",
        artifactFile: {
          client: new URL("../../../artifacts/client-ssr/v2-client.json", import.meta.url),
          ssr: new URL("../../../artifacts/client-ssr/v2-ssr.json", import.meta.url),
        },
      }),
    ],
    build: {
      assetsInlineLimit: 0,
      manifest: true,
      outDir: "dist/client",
      rollupOptions: {
        input: {
          client: path.resolve("src/entry-client.js"),
        },
        output: {
          manualChunks: manualClientChunks,
          entryFileNames: "entries/[name]-[hash].js",
          chunkFileNames: "chunks/[name]-[hash].js",
          assetFileNames: "static/[name]-[hash][extname]",
        },
      },
    },
    environments: {
      ssr: {
        consumer: "server",
        build: {
          outDir: "dist/ssr",
          manifest: true,
          ssr: path.resolve("src/entry-ssr.js"),
          rollupOptions: {
            output: {
              manualChunks: manualServerChunks,
              entryFileNames: "entries/[name]-[hash].js",
              chunkFileNames: "chunks/[name]-[hash].js",
              assetFileNames: "static/[name]-[hash][extname]",
            },
          },
        },
      },
    },
  }
})
