import * as v from "valibot"

import {
  PLUGIN_SCENARIO_KINDS,
  isoTimestampSchema,
  nonEmptyStringArraySchema,
  nonEmptyStringSchema,
  nonNegativeIntegerSchema,
  scenarioSlugSchema,
  schemaVersionV1Schema,
} from "./shared.js"

export const fileSizesV1Schema = v.strictObject({
  raw: nonNegativeIntegerSchema,
  gzip: nonNegativeIntegerSchema,
  brotli: nonNegativeIntegerSchema,
})

export const artifactWarningV1Schema = v.strictObject({
  code: nonEmptyStringSchema,
  message: nonEmptyStringSchema,
})

export const chunkModuleArtifactV1Schema = v.strictObject({
  rawId: nonEmptyStringSchema,
  renderedLength: nonNegativeIntegerSchema,
  originalLength: nonNegativeIntegerSchema,
})

export const chunkArtifactV1Schema = v.strictObject({
  fileName: nonEmptyStringSchema,
  name: nonEmptyStringSchema,
  isEntry: v.boolean(),
  isDynamicEntry: v.boolean(),
  facadeModuleId: v.nullable(nonEmptyStringSchema),
  imports: v.array(nonEmptyStringSchema),
  dynamicImports: v.array(nonEmptyStringSchema),
  implicitlyLoadedBefore: v.array(nonEmptyStringSchema),
  importedCss: v.array(nonEmptyStringSchema),
  importedAssets: v.array(nonEmptyStringSchema),
  modules: v.pipe(v.array(chunkModuleArtifactV1Schema), v.nonEmpty()),
  sizes: fileSizesV1Schema,
})

export const assetArtifactV1Schema = v.strictObject({
  fileName: nonEmptyStringSchema,
  names: nonEmptyStringArraySchema,
  originalFileNames: v.optional(v.array(nonEmptyStringSchema)),
  needsCodeReference: v.boolean(),
  sizes: fileSizesV1Schema,
})

export const viteManifestEntrySchema = v.objectWithRest(
  {
    src: v.optional(nonEmptyStringSchema),
    file: nonEmptyStringSchema,
    css: v.optional(v.array(nonEmptyStringSchema)),
    assets: v.optional(v.array(nonEmptyStringSchema)),
    isEntry: v.optional(v.boolean()),
    name: v.optional(nonEmptyStringSchema),
    isDynamicEntry: v.optional(v.boolean()),
    imports: v.optional(v.array(nonEmptyStringSchema)),
    dynamicImports: v.optional(v.array(nonEmptyStringSchema)),
  },
  v.unknown(),
)

export const environmentArtifactV1Schema = v.strictObject({
  name: nonEmptyStringSchema,
  build: v.strictObject({
    outDir: nonEmptyStringSchema,
  }),
  manifest: v.pipe(
    v.record(nonEmptyStringSchema, viteManifestEntrySchema),
    v.check(
      (manifest) => Object.keys(manifest).length > 0,
      "Each environment must include a non-empty manifest",
    ),
  ),
  chunks: v.array(chunkArtifactV1Schema),
  assets: v.array(assetArtifactV1Schema),
  warnings: v.array(artifactWarningV1Schema),
})

export const pluginArtifactV1Schema = v.strictObject({
  schemaVersion: schemaVersionV1Schema,
  pluginVersion: nonEmptyStringSchema,
  generatedAt: isoTimestampSchema,
  scenario: v.strictObject({
    id: scenarioSlugSchema,
    kind: v.union(PLUGIN_SCENARIO_KINDS.map((kind) => v.literal(kind))),
  }),
  build: v.strictObject({
    bundler: v.literal("vite"),
    bundlerVersion: nonEmptyStringSchema,
    rootDir: nonEmptyStringSchema,
  }),
  environments: v.pipe(
    v.array(environmentArtifactV1Schema),
    v.nonEmpty(),
    v.check((environments) => {
      const names = environments.map((environment) => environment.name)
      return new Set(names).size === names.length
    }, "Environment names must be unique within one artifact"),
  ),
})

export type FileSizesV1 = v.InferOutput<typeof fileSizesV1Schema>
export type ArtifactWarningV1 = v.InferOutput<typeof artifactWarningV1Schema>
export type ChunkModuleArtifactV1 = v.InferOutput<typeof chunkModuleArtifactV1Schema>
export type ChunkArtifactV1 = v.InferOutput<typeof chunkArtifactV1Schema>
export type AssetArtifactV1 = v.InferOutput<typeof assetArtifactV1Schema>
export type ViteManifestEntry = v.InferOutput<typeof viteManifestEntrySchema>
export type EnvironmentArtifactV1 = v.InferOutput<typeof environmentArtifactV1Schema>
export type PluginArtifactV1 = v.InferOutput<typeof pluginArtifactV1Schema>
