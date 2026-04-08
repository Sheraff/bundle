import { describe, expect, it } from "vitest"

import {
  matchEnvironmentPair,
  type StableIdentityAsset,
  type StableIdentityChunk,
  type StableIdentityEnvironment,
} from "../src/stable-identity.js"

describe("stable identity matcher", () => {
  it("matches entries across hash churn and preserves exact-source assets", () => {
    const result = matchEnvironmentPair(
      environment({
        chunks: [entryChunk("assets/main-old.js", "src/main.ts")],
        assets: [
          asset("assets/logo-old.svg", {
            kind: "svg",
            sourceKeys: ["src/assets/logo.svg"],
            importerFiles: ["assets/main-old.js"],
            importerKeys: ["src/main.ts"],
            ownerRoots: ["src/main.ts"],
          }),
        ],
      }),
      environment({
        chunks: [entryChunk("assets/main-new.js", "src/main.ts")],
        assets: [
          asset("assets/logo-new.svg", {
            kind: "svg",
            sourceKeys: ["src/assets/logo.svg"],
            importerFiles: ["assets/main-new.js"],
            importerKeys: ["src/main.ts"],
            ownerRoots: ["src/main.ts"],
          }),
        ],
      }),
    )

    expect(result.entries.same).toEqual([
      expect.objectContaining({
        relation: "same",
        from: "assets/main-old.js",
        to: "assets/main-new.js",
        confidence: "exact",
      }),
    ])
    expect(result.assets.same).toEqual([
      expect.objectContaining({
        relation: "same",
        from: "assets/logo-old.svg",
        to: "assets/logo-new.svg",
        confidence: "exact",
      }),
    ])
  })

  it("detects shared-chunk and generated-css splits from importer lineage", () => {
    const result = matchEnvironmentPair(
      environment({
        chunks: [
          entryChunk("assets/main-old.js", "src/main.ts", {
            imports: ["chunks/shared-old.js"],
          }),
          sharedChunk(
            "chunks/shared-old.js",
            ["src/main.ts"],
            [moduleEntry("src/shared/format.ts", 60), moduleEntry("src/shared/view.ts", 40)],
          ),
        ],
        assets: [
          asset("assets/shared-old.css", {
            kind: "css",
            importerFiles: ["chunks/shared-old.js"],
            importerKeys: ["src/main.ts"],
            ownerRoots: ["src/main.ts"],
            sizes: size(30, 10, 8),
          }),
        ],
      }),
      environment({
        chunks: [
          entryChunk("assets/main-new.js", "src/main.ts", {
            imports: ["chunks/route-format.js", "chunks/route-ui.js"],
          }),
          sharedChunk(
            "chunks/route-format.js",
            ["src/main.ts"],
            [moduleEntry("src/shared/format.ts", 60)],
          ),
          sharedChunk(
            "chunks/route-ui.js",
            ["src/main.ts"],
            [moduleEntry("src/shared/view.ts", 40)],
          ),
        ],
        assets: [
          asset("assets/route-format.css", {
            kind: "css",
            importerFiles: ["chunks/route-format.js"],
            importerKeys: ["src/main.ts"],
            ownerRoots: ["src/main.ts"],
            sizes: size(18, 7, 5),
          }),
          asset("assets/route-ui.css", {
            kind: "css",
            importerFiles: ["chunks/route-ui.js"],
            importerKeys: ["src/main.ts"],
            ownerRoots: ["src/main.ts"],
            sizes: size(12, 5, 4),
          }),
        ],
      }),
    )

    expect(result.sharedChunks.split).toEqual([
      expect.objectContaining({
        relation: "split",
        from: "chunks/shared-old.js",
        to: ["chunks/route-format.js", "chunks/route-ui.js"],
      }),
    ])
    expect(result.css.split).toEqual([
      expect.objectContaining({
        relation: "split",
        from: "assets/shared-old.css",
        to: ["assets/route-format.css", "assets/route-ui.css"],
      }),
    ])
  })

  it("detects shared-chunk merges", () => {
    const result = matchEnvironmentPair(
      environment({
        chunks: [
          entryChunk("assets/main-old.js", "src/main.ts", {
            imports: ["chunks/format-old.js", "chunks/ui-old.js"],
          }),
          sharedChunk(
            "chunks/format-old.js",
            ["src/main.ts"],
            [moduleEntry("src/shared/format.ts", 55)],
          ),
          sharedChunk("chunks/ui-old.js", ["src/main.ts"], [moduleEntry("src/shared/view.ts", 45)]),
        ],
      }),
      environment({
        chunks: [
          entryChunk("assets/main-new.js", "src/main.ts", {
            imports: ["chunks/shared-new.js"],
          }),
          sharedChunk(
            "chunks/shared-new.js",
            ["src/main.ts"],
            [moduleEntry("src/shared/format.ts", 55), moduleEntry("src/shared/view.ts", 45)],
          ),
        ],
      }),
    )

    expect(result.sharedChunks.merge).toEqual([
      expect.objectContaining({
        relation: "merge",
        from: ["chunks/format-old.js", "chunks/ui-old.js"],
        to: "chunks/shared-new.js",
      }),
    ])
  })

  it("falls back to low-confidence shared chunk continuity when only labels and owner roots match", () => {
    const result = matchEnvironmentPair(
      environment({
        chunks: [
          entryChunk("assets/main-old.js", "src/main.ts", {
            imports: ["chunks/shared-old.js"],
          }),
          sharedChunk(
            "chunks/shared-old.js",
            ["src/main.ts"],
            [moduleEntry("src/shared/alpha.ts", 55), moduleEntry("src/shared/beta.ts", 45)],
            {
              fileLabel: "shared.js",
            },
          ),
        ],
      }),
      environment({
        chunks: [
          entryChunk("assets/main-new.js", "src/main.ts", {
            imports: ["chunks/shared-new.js"],
          }),
          sharedChunk(
            "chunks/shared-new.js",
            ["src/main.ts"],
            [moduleEntry("src/shared/gamma.ts", 52), moduleEntry("src/shared/delta.ts", 48)],
            {
              fileLabel: "shared.js",
            },
          ),
        ],
      }),
    )

    expect(result.sharedChunks.same).toEqual([
      expect.objectContaining({
        relation: "same",
        from: "chunks/shared-old.js",
        to: "chunks/shared-new.js",
        confidence: "low",
      }),
    ])
    expect(result.sharedChunks.removed).toEqual([])
    expect(result.sharedChunks.added).toEqual([])
  })

  it("emits ambiguous shared-chunk lineage when overlap stays under-explained", () => {
    const result = matchEnvironmentPair(
      environment({
        chunks: [
          entryChunk("assets/main-old.js", "src/main.ts", {
            imports: ["chunks/shared-old.js"],
          }),
          sharedChunk(
            "chunks/shared-old.js",
            ["src/main.ts"],
            [moduleEntry("src/shared/alpha.ts", 60), moduleEntry("src/shared/beta.ts", 40)],
          ),
        ],
      }),
      environment({
        chunks: [
          entryChunk("assets/main-new.js", "src/main.ts", {
            imports: ["chunks/alpha-ish.js", "chunks/beta-ish.js"],
          }),
          sharedChunk(
            "chunks/alpha-ish.js",
            ["src/main.ts"],
            [moduleEntry("src/shared/alpha.ts", 35), moduleEntry("src/shared/gamma.ts", 20)],
          ),
          sharedChunk(
            "chunks/beta-ish.js",
            ["src/main.ts"],
            [moduleEntry("src/shared/beta.ts", 25), moduleEntry("src/shared/delta.ts", 15)],
          ),
        ],
      }),
    )

    expect(result.sharedChunks.ambiguous).toEqual([
      expect.objectContaining({
        relation: "ambiguous",
        from: "chunks/shared-old.js",
        to: ["chunks/alpha-ish.js", "chunks/beta-ish.js"],
        confidence: "low",
      }),
    ])
  })

  it("matches generated css assets from importer lineage without source keys", () => {
    const result = matchEnvironmentPair(
      environment({
        chunks: [entryChunk("assets/main-old.js", "src/main.ts")],
        assets: [
          asset("assets/theme-old.css", {
            fileLabel: "theme.css",
            kind: "css",
            importerFiles: ["assets/main-old.js"],
            importerKeys: ["src/main.ts"],
            ownerRoots: ["src/main.ts"],
            sizes: size(21, 8, 6),
          }),
        ],
      }),
      environment({
        chunks: [entryChunk("assets/main-new.js", "src/main.ts")],
        assets: [
          asset("assets/theme-new.css", {
            fileLabel: "theme.css",
            kind: "css",
            importerFiles: ["assets/main-new.js"],
            importerKeys: ["src/main.ts"],
            ownerRoots: ["src/main.ts"],
            sizes: size(20, 8, 6),
          }),
        ],
      }),
    )

    expect(result.css.same).toEqual([
      expect.objectContaining({
        relation: "same",
        from: "assets/theme-old.css",
        to: "assets/theme-new.css",
        confidence: "strong",
      }),
    ])
  })
})

function environment(overrides: Partial<StableIdentityEnvironment>): StableIdentityEnvironment {
  return {
    chunks: [],
    assets: [],
    ...overrides,
  }
}

function entryChunk(
  fileName: string,
  identity: string,
  overrides: Partial<StableIdentityChunk> = {},
): StableIdentityChunk {
  return chunk(fileName, {
    isEntry: true,
    isDynamicEntry: false,
    facadeModule: { stableId: identity },
    manifestSourceKeys: [identity],
    ownerRoots: [identity],
    modules: [moduleEntry(identity, 100)],
    ...overrides,
  })
}

function sharedChunk(
  fileName: string,
  ownerRoots: string[],
  modules: StableIdentityChunk["modules"],
  overrides: Partial<StableIdentityChunk> = {},
): StableIdentityChunk {
  return chunk(fileName, {
    isEntry: false,
    isDynamicEntry: false,
    facadeModule: null,
    manifestSourceKeys: [],
    ownerRoots,
    modules,
    ...overrides,
  })
}

function chunk(
  fileName: string,
  overrides: Partial<StableIdentityChunk> = {},
): StableIdentityChunk {
  const modules = overrides.modules ?? []
  const totalRenderedLength = modules.reduce((total, module) => total + module.renderedLength, 0)

  return {
    fileName,
    fileLabel: fileName,
    isEntry: false,
    isDynamicEntry: false,
    facadeModule: null,
    manifestSourceKeys: [],
    ownerRoots: [],
    imports: [],
    dynamicImports: [],
    modules,
    moduleIds: modules.map((module) => module.stableId),
    totalRenderedLength,
    sizes: size(
      totalRenderedLength,
      Math.max(1, Math.floor(totalRenderedLength / 2)),
      Math.max(1, Math.floor(totalRenderedLength / 3)),
    ),
    ...overrides,
  }
}

function moduleEntry(stableId: string, renderedLength: number) {
  return {
    stableId,
    renderedLength,
  }
}

function asset(
  fileName: string,
  overrides: Partial<StableIdentityAsset> = {},
): StableIdentityAsset {
  return {
    fileName,
    fileLabel: fileName,
    kind: "svg",
    sourceKeys: [],
    importerKeys: [],
    importerFiles: [],
    ownerRoots: [],
    sizes: size(10, 5, 4),
    ...overrides,
  }
}

function size(raw: number, gzip: number, brotli: number) {
  return { raw, gzip, brotli }
}
