import path from "node:path"
import { defineConfig } from "vite"
import { stableIdentityCapturePlugin } from "../../../harness/capture-plugin.mjs"

export default defineConfig({
  plugins: [
    stableIdentityCapturePlugin({
      fixtureId: "rename-moves",
      versionId: "v2",
      scenarioId: "rename-moves",
      artifactFile: new URL("../../../artifacts/rename-moves/v2.json", import.meta.url),
    }),
  ],
  build: {
    assetsInlineLimit: 0,
    manifest: true,
    rollupOptions: {
      input: path.resolve("src/main.js"),
    },
  },
})
