import * as v from "valibot"

import { fileSizesV1Schema } from "./plugin-artifact.js"
import {
  ciContextSchema,
  gitContextSchema,
  pullRequestContextSchema,
  repositoryContextSchema,
  scenarioSourceSchema,
  syntheticDefinitionSchema,
} from "./upload-envelope.js"
import {
  PLUGIN_SCENARIO_KINDS,
  isoTimestampSchema,
  nonEmptyStringArraySchema,
  nonEmptyStringSchema,
  nonNegativeIntegerSchema,
  positiveIntegerSchema,
  scenarioSlugSchema,
  schemaVersionV1Schema,
  ulidSchema,
} from "./shared.js"

const NORMALIZED_MODULE_SCOPES = ["app", "package", "virtual", "other"] as const
const ENTRYPOINT_KINDS = ["entry", "dynamic-entry"] as const
const CHUNK_GRAPH_EDGE_KINDS = ["static-import", "dynamic-import"] as const
const ASSET_RELATION_KINDS = ["css", "asset"] as const

export const normalizedModuleReferenceV1Schema = v.strictObject({
  rawId: nonEmptyStringSchema,
  stableId: nonEmptyStringSchema,
  scope: v.union(NORMALIZED_MODULE_SCOPES.map((scope) => v.literal(scope))),
})

export const normalizedModuleV1Schema = v.strictObject({
  rawId: nonEmptyStringSchema,
  stableId: nonEmptyStringSchema,
  scope: v.union(NORMALIZED_MODULE_SCOPES.map((scope) => v.literal(scope))),
  renderedLength: nonNegativeIntegerSchema,
  originalLength: nonNegativeIntegerSchema,
})

export const normalizedSnapshotWarningV1Schema = v.strictObject({
  code: nonEmptyStringSchema,
  message: nonEmptyStringSchema,
})

export const normalizedEntrypointV1Schema = v.strictObject({
  key: nonEmptyStringSchema,
  kind: v.union(ENTRYPOINT_KINDS.map((kind) => v.literal(kind))),
  chunkFileName: nonEmptyStringSchema,
  manifestSourceKeys: v.array(nonEmptyStringSchema),
  facadeModule: v.nullable(normalizedModuleReferenceV1Schema),
  importedCss: v.array(nonEmptyStringSchema),
  importedAssets: v.array(nonEmptyStringSchema),
  staticImportedChunkFileNames: v.array(nonEmptyStringSchema),
  dynamicImportedChunkFileNames: v.array(nonEmptyStringSchema),
})

export const normalizedChunkV1Schema = v.strictObject({
  fileName: nonEmptyStringSchema,
  fileLabel: nonEmptyStringSchema,
  name: nonEmptyStringSchema,
  isEntry: v.boolean(),
  isDynamicEntry: v.boolean(),
  facadeModule: v.nullable(normalizedModuleReferenceV1Schema),
  manifestSourceKeys: v.array(nonEmptyStringSchema),
  ownerRoots: v.array(nonEmptyStringSchema),
  imports: v.array(nonEmptyStringSchema),
  dynamicImports: v.array(nonEmptyStringSchema),
  implicitlyLoadedBefore: v.array(nonEmptyStringSchema),
  importedCss: v.array(nonEmptyStringSchema),
  importedAssets: v.array(nonEmptyStringSchema),
  moduleIds: nonEmptyStringArraySchema,
  totalRenderedLength: nonNegativeIntegerSchema,
  sizes: fileSizesV1Schema,
  modules: v.pipe(v.array(normalizedModuleV1Schema), v.nonEmpty()),
})

export const normalizedAssetV1Schema = v.strictObject({
  fileName: nonEmptyStringSchema,
  fileLabel: nonEmptyStringSchema,
  kind: nonEmptyStringSchema,
  names: nonEmptyStringArraySchema,
  originalFileNames: v.array(nonEmptyStringSchema),
  sourceKeys: v.array(nonEmptyStringSchema),
  importerKeys: v.array(nonEmptyStringSchema),
  importerFiles: v.array(nonEmptyStringSchema),
  ownerRoots: v.array(nonEmptyStringSchema),
  needsCodeReference: v.boolean(),
  sizes: fileSizesV1Schema,
})

export const normalizedPackageV1Schema = v.strictObject({
  packageName: nonEmptyStringSchema,
  moduleCount: positiveIntegerSchema,
  renderedLength: nonNegativeIntegerSchema,
})

export const normalizedChunkGraphEdgeV1Schema = v.strictObject({
  kind: v.union(CHUNK_GRAPH_EDGE_KINDS.map((kind) => v.literal(kind))),
  fromChunkFileName: nonEmptyStringSchema,
  toChunkFileName: nonEmptyStringSchema,
})

export const normalizedAssetRelationV1Schema = v.strictObject({
  kind: v.union(ASSET_RELATION_KINDS.map((kind) => v.literal(kind))),
  chunkFileName: nonEmptyStringSchema,
  assetFileName: nonEmptyStringSchema,
})

export const normalizedEnvironmentSnapshotV1Schema = v.strictObject({
  name: nonEmptyStringSchema,
  build: v.strictObject({
    outDir: nonEmptyStringSchema,
  }),
  entrypoints: v.pipe(
    v.array(normalizedEntrypointV1Schema),
    v.nonEmpty(),
    v.check((entrypoints) => {
      const keys = entrypoints.map((entrypoint) => entrypoint.key)
      return new Set(keys).size === keys.length
    }, "Entrypoint keys must be unique within one environment"),
  ),
  chunks: v.pipe(v.array(normalizedChunkV1Schema), v.nonEmpty()),
  assets: v.array(normalizedAssetV1Schema),
  packages: v.array(normalizedPackageV1Schema),
  chunkGraphEdges: v.array(normalizedChunkGraphEdgeV1Schema),
  assetRelations: v.array(normalizedAssetRelationV1Schema),
  warnings: v.array(normalizedSnapshotWarningV1Schema),
})

export const normalizedSnapshotSourceV1Schema = v.strictObject({
  artifactR2Key: nonEmptyStringSchema,
  envelopeR2Key: nonEmptyStringSchema,
  artifactSha256: nonEmptyStringSchema,
  envelopeSha256: nonEmptyStringSchema,
  artifactSchemaVersion: positiveIntegerSchema,
  uploadSchemaVersion: positiveIntegerSchema,
})

export const normalizedSnapshotV1Schema = v.strictObject({
  schemaVersion: schemaVersionV1Schema,
  normalizedAt: isoTimestampSchema,
  scenarioRunId: ulidSchema,
  repositoryId: ulidSchema,
  commitGroupId: ulidSchema,
  scenario: v.strictObject({
    id: scenarioSlugSchema,
    kind: v.union(PLUGIN_SCENARIO_KINDS.map((kind) => v.literal(kind))),
  }),
  scenarioSource: scenarioSourceSchema,
  syntheticDefinition: v.optional(syntheticDefinitionSchema),
  repository: repositoryContextSchema,
  git: gitContextSchema,
  pullRequest: v.optional(pullRequestContextSchema),
  ci: ciContextSchema,
  build: v.strictObject({
    bundler: v.literal("vite"),
    bundlerVersion: nonEmptyStringSchema,
    pluginVersion: nonEmptyStringSchema,
    generatedAt: isoTimestampSchema,
    rootDir: nonEmptyStringSchema,
  }),
  raw: normalizedSnapshotSourceV1Schema,
  environments: v.pipe(
    v.array(normalizedEnvironmentSnapshotV1Schema),
    v.nonEmpty(),
    v.check((environments) => {
      const names = environments.map((environment) => environment.name)
      return new Set(names).size === names.length
    }, "Environment names must be unique within one normalized snapshot"),
  ),
})

export type NormalizedModuleReferenceV1 = v.InferOutput<typeof normalizedModuleReferenceV1Schema>
export type NormalizedModuleV1 = v.InferOutput<typeof normalizedModuleV1Schema>
export type NormalizedSnapshotWarningV1 = v.InferOutput<typeof normalizedSnapshotWarningV1Schema>
export type NormalizedEntrypointV1 = v.InferOutput<typeof normalizedEntrypointV1Schema>
export type NormalizedChunkV1 = v.InferOutput<typeof normalizedChunkV1Schema>
export type NormalizedAssetV1 = v.InferOutput<typeof normalizedAssetV1Schema>
export type NormalizedPackageV1 = v.InferOutput<typeof normalizedPackageV1Schema>
export type NormalizedChunkGraphEdgeV1 = v.InferOutput<typeof normalizedChunkGraphEdgeV1Schema>
export type NormalizedAssetRelationV1 = v.InferOutput<typeof normalizedAssetRelationV1Schema>
export type NormalizedEnvironmentSnapshotV1 = v.InferOutput<
  typeof normalizedEnvironmentSnapshotV1Schema
>
export type NormalizedSnapshotSourceV1 = v.InferOutput<typeof normalizedSnapshotSourceV1Schema>
export type NormalizedSnapshotV1 = v.InferOutput<typeof normalizedSnapshotV1Schema>
