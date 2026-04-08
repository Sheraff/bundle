import path from "node:path"
import { defineConfig } from "vite"
import { stableIdentityCapturePlugin } from "../../../harness/capture-plugin.mjs"

function manualChunks(id) {
  const normalizedId = id.replaceAll("\\", "/")
  if (
    normalizedId.includes("/src/shared/fetchBudget.js") ||
    normalizedId.includes("/src/shared/renderBadge.js") ||
    normalizedId.includes("/src/shared/summarizeVariance.js")
  ) {
    return "bridge-left"
  }

  if (
    normalizedId.includes("/src/shared/formatWave.js") ||
    normalizedId.includes("/src/shared/renderCells.js") ||
    normalizedId.includes("/src/shared/renderSpark.js")
  ) {
    return "bridge-right"
  }

  return undefined
}

export default defineConfig({
  plugins: [
    stableIdentityCapturePlugin({
      fixtureId: "ambiguous-shared",
      versionId: "v2",
      scenarioId: "ambiguous-shared",
      artifactFile: new URL("../../../artifacts/ambiguous-shared/v2.json", import.meta.url),
    }),
  ],
  build: {
    manifest: true,
    rollupOptions: {
      input: path.resolve("src/main.js"),
      output: {
        manualChunks,
      },
    },
  },
})
