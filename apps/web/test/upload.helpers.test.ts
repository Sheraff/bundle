import { describe, expect, it } from "vitest"

import { stableStringify } from "../src/uploads/accept-upload.js"
import { sha256Hex } from "../src/shared/sha256-hex.js"
import { buildStoredUploadTexts } from "../src/uploads/raw-upload-storage.js"
import { readBearerToken } from "../src/api/uploads.js"

const sha = "0123456789abcdef0123456789abcdef01234567"

describe("upload helper behavior", () => {
  it("normalizes object keys before hashing for dedupe", async () => {
    const left = {
      z: 1,
      a: {
        c: 3,
        b: 2,
      },
    }
    const right = {
      a: {
        b: 2,
        c: 3,
      },
      z: 1,
    }

    expect(stableStringify(left)).toBe(stableStringify(right))
    expect(await sha256Hex(stableStringify(left))).toBe(await sha256Hex(stableStringify(right)))
  })

  it("extracts a bearer token only from valid authorization headers", () => {
    expect(readBearerToken("Bearer test-token")).toBe("test-token")
    expect(readBearerToken("bearer test-token")).toBe("test-token")
    expect(readBearerToken("Basic test-token")).toBeNull()
    expect(readBearerToken(undefined)).toBeNull()
  })

  it("builds immutable raw artifact and envelope payloads", async () => {
    const storedTexts = await buildStoredUploadTexts(
      {
        schemaVersion: 1,
        artifact: {
          schemaVersion: 1,
          pluginVersion: "0.1.0",
          generatedAt: "2026-04-06T12:00:00.000Z",
          scenario: {
            id: "fixture-app-cost",
            kind: "fixture-app",
          },
          build: {
            bundler: "vite",
            bundlerVersion: "8.0.4",
            rootDir: "/tmp/repo",
          },
          environments: [
            {
              name: "default",
              build: {
                outDir: "dist",
              },
              manifest: {
                "src/main.ts": {
                  file: "assets/main.js",
                  src: "src/main.ts",
                  isEntry: true,
                },
              },
              chunks: [
                {
                  fileName: "assets/main.js",
                  name: "main",
                  isEntry: true,
                  isDynamicEntry: false,
                  facadeModuleId: "/tmp/repo/src/main.ts",
                  imports: [],
                  dynamicImports: [],
                  implicitlyLoadedBefore: [],
                  importedCss: ["assets/main.css"],
                  importedAssets: [],
                  modules: [
                    {
                      rawId: "/tmp/repo/src/main.ts",
                      renderedLength: 123,
                      originalLength: 456,
                    },
                  ],
                  sizes: {
                    raw: 123,
                    gzip: 45,
                    brotli: 38,
                  },
                },
              ],
              assets: [
                {
                  fileName: "assets/main.css",
                  names: ["main.css"],
                  needsCodeReference: false,
                  sizes: {
                    raw: 10,
                    gzip: 8,
                    brotli: 6,
                  },
                },
              ],
              warnings: [],
            },
          ],
        },
        repository: {
          githubRepoId: 123,
          owner: "acme",
          name: "widget",
          installationId: 456,
        },
        git: {
          commitSha: sha,
          branch: "main",
        },
        scenarioSource: {
          kind: "fixture-app",
        },
        ci: {
          provider: "github-actions",
          workflowRunId: "999",
        },
      },
      '{"schemaVersion":1}',
    )

    expect(storedTexts.artifactText).toContain("fixture-app-cost")
    expect(storedTexts.artifactText.endsWith("\n")).toBe(true)
    expect(storedTexts.envelopeText).toBe('{"schemaVersion":1}\n')
    expect(storedTexts.artifactSha256).toHaveLength(64)
    expect(storedTexts.envelopeSha256).toHaveLength(64)
    expect(storedTexts.artifactSizeBytes).toBeGreaterThan(0)
    expect(storedTexts.envelopeSizeBytes).toBeGreaterThan(0)
  })
})
