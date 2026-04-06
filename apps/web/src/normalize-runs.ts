import {
  SCHEMA_VERSION_V1,
  normalizedSnapshotV1Schema,
  normalizeRunQueueMessageSchema,
  pluginArtifactV1Schema,
  uploadScenarioRunEnvelopeV1Schema,
  type ArtifactWarningV1,
  type NormalizeRunQueueMessage,
  type NormalizedAssetRelationV1,
  type NormalizedAssetV1,
  type NormalizedChunkGraphEdgeV1,
  type NormalizedChunkV1,
  type NormalizedEntrypointV1,
  type NormalizedEnvironmentSnapshotV1,
  type NormalizedModuleReferenceV1,
  type NormalizedModuleV1,
  type NormalizedPackageV1,
  type NormalizedSnapshotV1,
  type PluginArtifactV1,
  type UploadScenarioRunEnvelopeV1,
  type ViteManifestEntry,
} from '@workspace/contracts'
import { eq } from 'drizzle-orm'
import * as v from 'valibot'

import { getDb, schema } from './db/index.js'
import type { AppBindings } from './env.js'

type ScenarioRunRow = typeof schema.scenarioRuns.$inferSelect

interface QueueLogger {
  error: typeof console.error
  warn: typeof console.warn
}

interface ManifestEntryRecord {
  assets: string[]
  css: string[]
  dynamicImports: string[]
  file: string
  imports: string[]
  isDynamicEntry: boolean
  isEntry: boolean
  key: string
  src: string | null
}

interface ManifestImporterRecord {
  entry: ManifestEntryRecord
  relation: 'assets' | 'css' | 'dynamicImports' | 'imports'
}

interface ChunkIndexRecord extends NormalizedChunkV1 {
  ownerRoots: string[]
}

type QueueMessageLike<TBody> = Pick<Message<TBody>, 'ack' | 'retry' | 'body' | 'id' | 'attempts'>

export async function handleNormalizeRunQueue(
  batch: MessageBatch<unknown>,
  env: AppBindings,
  _ctx?: ExecutionContext,
  logger: QueueLogger = console,
) {
  for (const message of batch.messages) {
    await handleNormalizeRunMessage(message, env, logger)
  }
}

export async function handleNormalizeRunMessage(
  message: QueueMessageLike<unknown>,
  env: AppBindings,
  logger: QueueLogger = console,
) {
  const messageResult = v.safeParse(normalizeRunQueueMessageSchema, message.body)

  if (!messageResult.success) {
    logger.error('Dropping invalid normalize-run message', formatIssues(messageResult.issues))
    message.ack()
    return
  }

  const normalizeRunMessage = message.body as NormalizeRunQueueMessage

  try {
    await normalizeScenarioRun(env, normalizeRunMessage)
    message.ack()
  } catch (error) {
    if (error instanceof TerminalNormalizeError) {
      if (error.persistFailure) {
        await markScenarioRunFailed(env, normalizeRunMessage.scenarioRunId, error.code, error.message)
      } else {
        logger.warn(error.message)
      }

      message.ack()
      return
    }

    logger.error('Retrying normalize-run message after transient failure', error)
    message.retry()
  }
}

async function normalizeScenarioRun(env: AppBindings, message: NormalizeRunQueueMessage) {
  const db = getDb(env)
  const scenarioRun = await selectOne(
    db
      .select()
      .from(schema.scenarioRuns)
      .where(eq(schema.scenarioRuns.id, message.scenarioRunId))
      .limit(1),
  )

  if (!scenarioRun) {
    throw new TerminalNormalizeError(
      'scenario_run_not_found',
      `Scenario run ${message.scenarioRunId} no longer exists.`,
      false,
    )
  }

  if (scenarioRun.repositoryId !== message.repositoryId) {
    throw new TerminalNormalizeError(
      'repository_mismatch',
      `Scenario run ${message.scenarioRunId} does not belong to repository ${message.repositoryId}.`,
    )
  }

  if (scenarioRun.normalizedAt && scenarioRun.normalizedSnapshotR2Key) {
    return
  }

  const processingTimestamp = new Date().toISOString()

  await getDb(env)
    .update(schema.scenarioRuns)
    .set({
      status: 'processing',
      normalizationStartedAt: scenarioRun.normalizationStartedAt ?? processingTimestamp,
      failureCode: null,
      failureMessage: null,
      updatedAt: processingTimestamp,
    })
    .where(eq(schema.scenarioRuns.id, scenarioRun.id))

  const artifact = await readStoredJson(
    env.RAW_UPLOADS_BUCKET,
    scenarioRun.rawArtifactR2Key,
    pluginArtifactV1Schema,
    'raw_artifact_missing',
    'invalid_raw_artifact',
  )
  const envelope = await readStoredJson(
    env.RAW_UPLOADS_BUCKET,
    scenarioRun.rawEnvelopeR2Key,
    uploadScenarioRunEnvelopeV1Schema,
    'raw_envelope_missing',
    'invalid_raw_envelope',
  )

  const normalizedAt = new Date().toISOString()
  const normalizedSnapshot = buildNormalizedSnapshot({
    normalizedAt,
    scenarioRun,
    artifact,
    envelope,
  })
  const snapshotResult = v.safeParse(normalizedSnapshotV1Schema, normalizedSnapshot)

  if (!snapshotResult.success) {
    throw new TerminalNormalizeError(
      'invalid_normalized_snapshot',
      `Generated normalized snapshot is invalid: ${formatIssues(snapshotResult.issues)}`,
    )
  }

  const normalizedSnapshotR2Key = `normalized/scenario-runs/${scenarioRun.id}/snapshot.json`
  const normalizedSnapshotText = `${JSON.stringify(snapshotResult.output, null, 2)}\n`

  await env.CACHE_BUCKET.put(normalizedSnapshotR2Key, normalizedSnapshotText, {
    httpMetadata: {
      contentType: 'application/json',
    },
    customMetadata: {
      scenarioRunId: scenarioRun.id,
      schemaVersion: String(SCHEMA_VERSION_V1),
    },
  })

  await getDb(env)
    .update(schema.scenarioRuns)
    .set({
      status: 'processing',
      normalizedSnapshotR2Key,
      normalizedSchemaVersion: SCHEMA_VERSION_V1,
      normalizedAt,
      failureCode: null,
      failureMessage: null,
      updatedAt: normalizedAt,
    })
    .where(eq(schema.scenarioRuns.id, scenarioRun.id))
}

export function buildNormalizedSnapshot({
  normalizedAt,
  scenarioRun,
  artifact,
  envelope,
}: {
  normalizedAt: string
  scenarioRun: ScenarioRunRow
  artifact: PluginArtifactV1
  envelope: UploadScenarioRunEnvelopeV1
}): NormalizedSnapshotV1 {
  return {
    schemaVersion: SCHEMA_VERSION_V1,
    normalizedAt,
    scenarioRunId: scenarioRun.id,
    repositoryId: scenarioRun.repositoryId,
    commitGroupId: scenarioRun.commitGroupId,
    scenario: artifact.scenario,
    scenarioSource: envelope.scenarioSource,
    syntheticDefinition:
      'syntheticDefinition' in envelope ? envelope.syntheticDefinition : undefined,
    repository: envelope.repository,
    git: envelope.git,
    pullRequest: envelope.pullRequest,
    ci: envelope.ci,
    build: {
      bundler: artifact.build.bundler,
      bundlerVersion: artifact.build.bundlerVersion,
      pluginVersion: artifact.pluginVersion,
      generatedAt: artifact.generatedAt,
      rootDir: artifact.build.rootDir,
    },
    raw: {
      artifactR2Key: scenarioRun.rawArtifactR2Key,
      envelopeR2Key: scenarioRun.rawEnvelopeR2Key,
      artifactSha256: scenarioRun.artifactSha256,
      envelopeSha256: scenarioRun.envelopeSha256,
      artifactSchemaVersion: scenarioRun.artifactSchemaVersion,
      uploadSchemaVersion: scenarioRun.uploadSchemaVersion,
    },
    environments: artifact.environments.map((environment) =>
      normalizeEnvironment(environment, artifact.build.rootDir),
    ),
  }
}

function normalizeEnvironment(
  environment: PluginArtifactV1['environments'][number],
  rootDir: string,
): NormalizedEnvironmentSnapshotV1 {
  const manifestIndexes = buildManifestIndexes(environment.manifest)
  const chunks = environment.chunks.map((chunk) => normalizeChunk(chunk, rootDir, manifestIndexes.selfByFile))
  const chunkByFile = new Map(chunks.map((chunk) => [chunk.fileName, chunk] as const))
  const rootEntries = getRootManifestEntries(manifestIndexes.selfByFile)

  const directAssetOwnerRoots = buildOwnerRoots(chunks, chunkByFile, rootEntries)

  return {
    name: environment.name,
    build: {
      outDir: environment.build.outDir,
    },
    entrypoints: buildEntrypoints(rootEntries, chunks, chunkByFile),
    chunks: chunks.map((chunk) => ({
      ...chunk,
      ownerRoots: sortUnique(chunk.ownerRoots),
    })),
    assets: normalizeAssets(environment, rootDir, manifestIndexes, chunkByFile, directAssetOwnerRoots),
    packages: normalizePackages(chunks),
    chunkGraphEdges: normalizeChunkGraphEdges(chunks, chunkByFile),
    assetRelations: normalizeAssetRelations(chunks),
    warnings: environment.warnings.map((warning) => normalizeWarning(warning)),
  }
}

function buildEntrypoints(
  rootEntries: ManifestEntryRecord[],
  chunks: ChunkIndexRecord[],
  chunkByFile: Map<string, ChunkIndexRecord>,
): NormalizedEntrypointV1[] {
  const entrypoints: NormalizedEntrypointV1[] = []
  const seenKeys = new Set<string>()

  for (const rootEntry of rootEntries) {
    const key = getManifestEntryKey(rootEntry)
    const rootChunk = chunkByFile.get(rootEntry.file)
    const importedCss = sortUnique(
      rootChunk ? [...rootEntry.css, ...rootChunk.importedCss] : [...rootEntry.css],
    )
    const importedAssets = sortUnique(
      rootChunk ? [...rootEntry.assets, ...rootChunk.importedAssets] : [...rootEntry.assets],
    )

    if (!rootChunk) {
      const rootFileKind = getFileKind(rootEntry.file)
      if (rootFileKind === 'css') {
        importedCss.push(rootEntry.file)
      } else if (rootFileKind && rootFileKind !== 'html' && rootFileKind !== 'js') {
        importedAssets.push(rootEntry.file)
      }
    }

    entrypoints.push({
      key,
      kind: rootEntry.isDynamicEntry ? 'dynamic-entry' : 'entry',
      chunkFileName: rootEntry.file,
      manifestSourceKeys: getManifestSourceKeys([rootEntry]),
      facadeModule: rootChunk?.facadeModule ?? null,
      importedCss: sortUnique(importedCss),
      importedAssets: sortUnique(importedAssets),
      staticImportedChunkFileNames: sortUnique(
        rootChunk
          ? [...rootEntry.imports.filter((fileName) => chunkByFile.has(fileName)), ...rootChunk.imports]
          : rootEntry.imports.filter((fileName) => chunkByFile.has(fileName)),
      ),
      dynamicImportedChunkFileNames: sortUnique(
        rootChunk
          ? [
              ...rootEntry.dynamicImports.filter((fileName) => chunkByFile.has(fileName)),
              ...rootChunk.dynamicImports,
            ]
          : rootEntry.dynamicImports.filter((fileName) => chunkByFile.has(fileName)),
      ),
    })
    seenKeys.add(key)
  }

  for (const chunk of chunks.filter((currentChunk) => currentChunk.isEntry || currentChunk.isDynamicEntry)) {
    const key = getRootKey(chunk)
    if (seenKeys.has(key)) {
      continue
    }

    entrypoints.push(normalizeEntrypoint(chunk))
  }

  return entrypoints.sort((left, right) => left.key.localeCompare(right.key))
}

function normalizeChunk(
  chunk: PluginArtifactV1['environments'][number]['chunks'][number],
  rootDir: string,
  selfByFile: Map<string, ManifestEntryRecord[]>,
): ChunkIndexRecord {
  const modules = chunk.modules
    .map((moduleEntry) => normalizeModule(moduleEntry, rootDir))
    .sort((left, right) => left.stableId.localeCompare(right.stableId))
  const facadeModule = chunk.facadeModuleId ? normalizeModuleReference(chunk.facadeModuleId, rootDir) : null

  return {
    fileName: chunk.fileName,
    fileLabel: fileLabel(chunk.fileName),
    name: chunk.name,
    isEntry: chunk.isEntry,
    isDynamicEntry: chunk.isDynamicEntry,
    facadeModule,
    manifestSourceKeys: getManifestSourceKeys(selfByFile.get(chunk.fileName) ?? []),
    ownerRoots: [],
    imports: sortUnique(chunk.imports),
    dynamicImports: sortUnique(chunk.dynamicImports),
    implicitlyLoadedBefore: sortUnique(chunk.implicitlyLoadedBefore),
    importedCss: sortUnique(chunk.importedCss),
    importedAssets: sortUnique(chunk.importedAssets),
    moduleIds: sortUnique(modules.map((moduleEntry) => moduleEntry.stableId)),
    totalRenderedLength: modules.reduce(
      (total, moduleEntry) => total + moduleEntry.renderedLength,
      0,
    ),
    sizes: chunk.sizes,
    modules,
  }
}

function normalizeEntrypoint(chunk: ChunkIndexRecord): NormalizedEntrypointV1 {
  return {
    key: getRootKey(chunk),
    kind: chunk.isEntry ? 'entry' : 'dynamic-entry',
    chunkFileName: chunk.fileName,
    manifestSourceKeys: chunk.manifestSourceKeys,
    facadeModule: chunk.facadeModule,
    importedCss: chunk.importedCss,
    importedAssets: chunk.importedAssets,
    staticImportedChunkFileNames: chunk.imports,
    dynamicImportedChunkFileNames: chunk.dynamicImports,
  }
}

function normalizeAssets(
  environment: PluginArtifactV1['environments'][number],
  rootDir: string,
  manifestIndexes: {
    importersByFile: Map<string, ManifestImporterRecord[]>
    selfByFile: Map<string, ManifestEntryRecord[]>
  },
  chunkByFile: Map<string, ChunkIndexRecord>,
  directAssetOwnerRoots: Map<string, Set<string>>,
): NormalizedAssetV1[] {
  const assetOwnerRoots = new Map(
    [...directAssetOwnerRoots.entries()].map(([fileName, ownerRoots]) => [fileName, new Set(ownerRoots)]),
  )

  for (const chunk of chunkByFile.values()) {
    for (const assetFileName of [...chunk.importedCss, ...chunk.importedAssets]) {
      const ownerRoots = assetOwnerRoots.get(assetFileName) ?? new Set<string>()
      for (const ownerRoot of chunk.ownerRoots) {
        ownerRoots.add(ownerRoot)
      }
      assetOwnerRoots.set(assetFileName, ownerRoots)
    }
  }

  return environment.assets
    .map((asset) => {
      const selfEntries = manifestIndexes.selfByFile.get(asset.fileName) ?? []
      const importerEntries = manifestIndexes.importersByFile.get(asset.fileName) ?? []
      const originalFileNames = sortUnique(
        (asset.originalFileNames ?? []).map((originalFileName) =>
          normalizeOriginalFileName(originalFileName, rootDir),
        ),
      )

      return {
        fileName: asset.fileName,
        fileLabel: fileLabel(asset.fileName),
        kind: getFileKind(asset.fileName),
        names: sortUnique(asset.names),
        originalFileNames,
        sourceKeys: sortUnique([...originalFileNames, ...getManifestSourceKeys(selfEntries)]),
        importerKeys: sortUnique(
          importerEntries.map(({ entry }) => entry.src ?? entry.key).filter(Boolean),
        ),
        importerFiles: sortUnique(importerEntries.map(({ entry }) => entry.file)),
        ownerRoots: sortUnique([...(assetOwnerRoots.get(asset.fileName) ?? new Set())]),
        needsCodeReference: asset.needsCodeReference,
        sizes: asset.sizes,
      }
    })
    .sort((left, right) => left.fileName.localeCompare(right.fileName))
}

function normalizePackages(chunks: ChunkIndexRecord[]): NormalizedPackageV1[] {
  const packages = new Map<string, { moduleIds: Set<string>; renderedLength: number }>()

  for (const chunk of chunks) {
    for (const moduleEntry of chunk.modules) {
      const packageName = packageNameFromStableId(moduleEntry.stableId)
      if (!packageName) {
        continue
      }

      const current = packages.get(packageName) ?? {
        moduleIds: new Set<string>(),
        renderedLength: 0,
      }
      current.moduleIds.add(moduleEntry.stableId)
      current.renderedLength += moduleEntry.renderedLength
      packages.set(packageName, current)
    }
  }

  return [...packages.entries()]
    .map(([packageName, value]) => ({
      packageName,
      moduleCount: value.moduleIds.size,
      renderedLength: value.renderedLength,
    }))
    .sort((left, right) => left.packageName.localeCompare(right.packageName))
}

function normalizeChunkGraphEdges(
  chunks: ChunkIndexRecord[],
  chunkByFile: Map<string, ChunkIndexRecord>,
): NormalizedChunkGraphEdgeV1[] {
  const edges = new Map<string, NormalizedChunkGraphEdgeV1>()

  for (const chunk of chunks) {
    for (const importedChunkFileName of chunk.imports) {
      if (!chunkByFile.has(importedChunkFileName)) {
        continue
      }

      const edge = {
        kind: 'static-import' as const,
        fromChunkFileName: chunk.fileName,
        toChunkFileName: importedChunkFileName,
      }
      edges.set(`${edge.kind}:${edge.fromChunkFileName}:${edge.toChunkFileName}`, edge)
    }

    for (const importedChunkFileName of chunk.dynamicImports) {
      if (!chunkByFile.has(importedChunkFileName)) {
        continue
      }

      const edge = {
        kind: 'dynamic-import' as const,
        fromChunkFileName: chunk.fileName,
        toChunkFileName: importedChunkFileName,
      }
      edges.set(`${edge.kind}:${edge.fromChunkFileName}:${edge.toChunkFileName}`, edge)
    }
  }

  return [...edges.values()].sort(compareByStableJson)
}

function normalizeAssetRelations(chunks: ChunkIndexRecord[]): NormalizedAssetRelationV1[] {
  const relations = new Map<string, NormalizedAssetRelationV1>()

  for (const chunk of chunks) {
    for (const assetFileName of chunk.importedCss) {
      const relation = {
        kind: 'css' as const,
        chunkFileName: chunk.fileName,
        assetFileName,
      }
      relations.set(`${relation.kind}:${relation.chunkFileName}:${relation.assetFileName}`, relation)
    }

    for (const assetFileName of chunk.importedAssets) {
      const relation = {
        kind: 'asset' as const,
        chunkFileName: chunk.fileName,
        assetFileName,
      }
      relations.set(`${relation.kind}:${relation.chunkFileName}:${relation.assetFileName}`, relation)
    }
  }

  return [...relations.values()].sort(compareByStableJson)
}

function normalizeWarning(warning: ArtifactWarningV1) {
  return {
    code: warning.code,
    message: warning.message,
  }
}

function buildManifestIndexes(manifest: Record<string, ViteManifestEntry>) {
  const selfByFile = new Map<string, ManifestEntryRecord[]>()
  const importersByFile = new Map<string, ManifestImporterRecord[]>()

  for (const [key, entry] of Object.entries(manifest).sort(([left], [right]) => left.localeCompare(right))) {
    const manifestEntry: ManifestEntryRecord = {
      key,
      src: entry.src ?? null,
      file: entry.file,
      isEntry: Boolean(entry.isEntry),
      isDynamicEntry: Boolean(entry.isDynamicEntry),
      imports: sortUnique(entry.imports ?? []),
      dynamicImports: sortUnique(entry.dynamicImports ?? []),
      css: sortUnique(entry.css ?? []),
      assets: sortUnique(entry.assets ?? []),
    }

    const selfEntries = selfByFile.get(entry.file) ?? []
    selfEntries.push(manifestEntry)
    selfByFile.set(entry.file, selfEntries)

    for (const fileName of manifestEntry.imports) {
      pushManifestImporter(importersByFile, fileName, {
        relation: 'imports',
        entry: manifestEntry,
      })
    }

    for (const fileName of manifestEntry.dynamicImports) {
      pushManifestImporter(importersByFile, fileName, {
        relation: 'dynamicImports',
        entry: manifestEntry,
      })
    }

    for (const fileName of manifestEntry.css) {
      pushManifestImporter(importersByFile, fileName, {
        relation: 'css',
        entry: manifestEntry,
      })
    }

    for (const fileName of manifestEntry.assets) {
      pushManifestImporter(importersByFile, fileName, {
        relation: 'assets',
        entry: manifestEntry,
      })
    }
  }

  return {
    selfByFile,
    importersByFile,
  }
}

function pushManifestImporter(
  importersByFile: Map<string, ManifestImporterRecord[]>,
  fileName: string,
  importer: ManifestImporterRecord,
) {
  const importers = importersByFile.get(fileName) ?? []
  importers.push(importer)
  importersByFile.set(fileName, importers)
}

function getRootManifestEntries(selfByFile: Map<string, ManifestEntryRecord[]>) {
  return [...selfByFile.values()]
    .flatMap((entries) => entries.filter((entry) => entry.isEntry || entry.isDynamicEntry))
    .sort((left, right) => getManifestEntryKey(left).localeCompare(getManifestEntryKey(right)))
}

function buildOwnerRoots(
  chunks: ChunkIndexRecord[],
  chunkByFile: Map<string, ChunkIndexRecord>,
  rootEntries: ManifestEntryRecord[],
) {
  const directAssetOwnerRoots = new Map<string, Set<string>>()
  const seenRootKeys = new Set<string>()

  for (const rootEntry of rootEntries) {
    const rootKey = getManifestEntryKey(rootEntry)
    seenRootKeys.add(rootKey)

    if (!chunkByFile.has(rootEntry.file)) {
      addOwnerRoot(directAssetOwnerRoots, rootEntry.file, rootKey)
    }

    for (const assetFileName of [...rootEntry.css, ...rootEntry.assets]) {
      addOwnerRoot(directAssetOwnerRoots, assetFileName, rootKey)
    }

    propagateOwnerRoot(rootKey, [rootEntry.file, ...rootEntry.imports, ...rootEntry.dynamicImports], chunkByFile)
  }

  for (const rootChunk of chunks.filter((chunk) => chunk.isEntry || chunk.isDynamicEntry)) {
    const rootKey = getRootKey(rootChunk)
    if (seenRootKeys.has(rootKey)) {
      continue
    }

    propagateOwnerRoot(rootKey, [rootChunk.fileName], chunkByFile)
  }

  return directAssetOwnerRoots
}

function propagateOwnerRoot(
  rootKey: string,
  initialFiles: string[],
  chunkByFile: Map<string, ChunkIndexRecord>,
) {
  const queue = initialFiles.filter((fileName) => chunkByFile.has(fileName))
  const visited = new Set<string>()

  while (queue.length > 0) {
    const currentFile = queue.shift()
    if (!currentFile || visited.has(currentFile)) {
      continue
    }

    visited.add(currentFile)
    const currentChunk = chunkByFile.get(currentFile)
    if (!currentChunk) {
      continue
    }

    currentChunk.ownerRoots = sortUnique([...currentChunk.ownerRoots, rootKey])
    for (const importedChunkFileName of [...currentChunk.imports, ...currentChunk.dynamicImports]) {
      if (chunkByFile.has(importedChunkFileName)) {
        queue.push(importedChunkFileName)
      }
    }
  }
}

function addOwnerRoot(assetOwnerRoots: Map<string, Set<string>>, fileName: string, rootKey: string) {
  const ownerRoots = assetOwnerRoots.get(fileName) ?? new Set<string>()
  ownerRoots.add(rootKey)
  assetOwnerRoots.set(fileName, ownerRoots)
}

function getManifestSourceKeys(manifestEntries: ManifestEntryRecord[]) {
  return sortUnique(manifestEntries.map((entry) => entry.src ?? entry.key).filter(Boolean))
}

function getManifestEntryKey(entry: ManifestEntryRecord) {
  return entry.src ?? entry.key
}

function getRootKey(chunk: Pick<ChunkIndexRecord, 'facadeModule' | 'fileName' | 'manifestSourceKeys'>) {
  return chunk.manifestSourceKeys[0] ?? chunk.facadeModule?.stableId ?? chunk.fileName
}

function normalizeModule(
  moduleEntry: PluginArtifactV1['environments'][number]['chunks'][number]['modules'][number],
  rootDir: string,
): NormalizedModuleV1 {
  const normalizedModuleReference = normalizeModuleReference(moduleEntry.rawId, rootDir)

  return {
    ...normalizedModuleReference,
    renderedLength: moduleEntry.renderedLength,
    originalLength: moduleEntry.originalLength,
  }
}

function normalizeModuleReference(rawId: string, rootDir: string): NormalizedModuleReferenceV1 {
  const normalizedRawId = toPosixPath(String(rawId))
  const virtualValue = normalizedRawId.startsWith('\0')
    ? `virtual:${normalizedRawId.slice(1)}`
    : normalizedRawId
  const [pathPart] = splitQuery(virtualValue)
  const packagePath = normalizeNodeModulesPath(pathPart)

  if (packagePath) {
    return {
      rawId: normalizedRawId,
      stableId: packagePath.stableId,
      scope: 'package',
    }
  }

  if (pathPart.startsWith('virtual:')) {
    return {
      rawId: normalizedRawId,
      stableId: pathPart,
      scope: 'virtual',
    }
  }

  if (isAbsolutePath(pathPart)) {
    const appRelativePath = makeRelativeIfInside(rootDir, pathPart)
    if (appRelativePath) {
      return {
        rawId: normalizedRawId,
        stableId: appRelativePath,
        scope: 'app',
      }
    }
  }

  const cleanedPath = pathPart.replace(/^\.\//, '')

  return {
    rawId: normalizedRawId,
    stableId: cleanedPath,
    scope: 'other',
  }
}

function normalizeOriginalFileName(value: string, rootDir: string) {
  return normalizeModuleReference(value, rootDir).stableId
}

function normalizeNodeModulesPath(value: string) {
  const normalizedValue = toPosixPath(value)
  const marker = '/node_modules/'
  const lastMarkerIndex = normalizedValue.lastIndexOf(marker)

  if (lastMarkerIndex === -1) {
    return null
  }

  let suffix = normalizedValue.slice(lastMarkerIndex + marker.length)
  if (suffix.startsWith('.pnpm/')) {
    const nestedMarker = '/node_modules/'
    const nestedIndex = suffix.indexOf(nestedMarker)
    if (nestedIndex !== -1) {
      suffix = suffix.slice(nestedIndex + nestedMarker.length)
    }
  }

  const segments = suffix.split('/').filter(Boolean)
  if (segments.length === 0) {
    return null
  }

  const packageName = segments[0].startsWith('@') ? segments.slice(0, 2).join('/') : segments[0]
  const packageDepth = packageName.startsWith('@') ? 2 : 1
  const packagePath = segments.slice(packageDepth).join('/')

  return {
    stableId: packagePath ? `pkg:${packageName}/${packagePath}` : `pkg:${packageName}`,
  }
}

function packageNameFromStableId(stableId: string) {
  if (!stableId.startsWith('pkg:')) {
    return null
  }

  const withoutPrefix = stableId.slice(4)
  const segments = withoutPrefix.split('/')
  if (withoutPrefix.startsWith('@')) {
    return segments.slice(0, 2).join('/')
  }

  return segments[0]
}

function toPosixPath(value: string) {
  return value.replaceAll('\\', '/')
}

function splitQuery(value: string) {
  const queryIndex = value.indexOf('?')

  if (queryIndex === -1) {
    return [value, ''] as const
  }

  return [value.slice(0, queryIndex), value.slice(queryIndex + 1)] as const
}

function makeRelativeIfInside(basePath: string, candidatePath: string) {
  const normalizedBase = stripTrailingSlash(toPosixPath(basePath))
  const normalizedCandidate = toPosixPath(candidatePath)

  if (
    normalizedCandidate === normalizedBase ||
    normalizedCandidate.startsWith(`${normalizedBase}/`)
  ) {
    return normalizedCandidate.slice(normalizedBase.length).replace(/^\//, '')
  }

  return null
}

function getFileKind(fileName: string) {
  const extension = getFileExtension(fileName).toLowerCase()

  if (extension === '.css') {
    return 'css'
  }

  if (extension === '.js' || extension === '.mjs' || extension === '.cjs') {
    return 'js'
  }

  if (extension === '.html') {
    return 'html'
  }

  return extension.slice(1) || 'unknown'
}

function stripHashFromFileName(fileName: string) {
  const extension = getFileExtension(fileName)
  const baseName = getBaseName(fileName, extension)
  return baseName.replace(/-[A-Za-z0-9_-]{6,}$/u, '')
}

function fileLabel(fileName: string) {
  return `${stripHashFromFileName(fileName)}${getFileExtension(fileName)}`
}

function isAbsolutePath(value: string) {
  return value.startsWith('/') || /^[A-Za-z]:\//.test(value)
}

function stripTrailingSlash(value: string) {
  return value.replace(/\/$/, '')
}

function getFileExtension(fileName: string) {
  const baseName = getBaseName(fileName)
  const extensionIndex = baseName.lastIndexOf('.')
  return extensionIndex === -1 ? '' : baseName.slice(extensionIndex)
}

function getBaseName(fileName: string, extension?: string) {
  const normalizedFileName = toPosixPath(fileName)
  const baseName = normalizedFileName.slice(normalizedFileName.lastIndexOf('/') + 1)

  if (!extension || !baseName.endsWith(extension)) {
    return baseName
  }

  return baseName.slice(0, -extension.length)
}

function sortUnique<T>(values: Iterable<T>) {
  return [...new Set(values)].sort((left, right) => String(left).localeCompare(String(right)))
}

function compareByStableJson(left: unknown, right: unknown) {
  return stableStringify(left).localeCompare(stableStringify(right))
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value)
  }

  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(',')}]`
  }

  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`)
    .join(',')}}`
}

async function readStoredJson<TSchema extends v.BaseSchema<unknown, unknown, v.BaseIssue<unknown>>>(
  bucket: R2Bucket,
  key: string,
  dataSchema: TSchema,
  missingCode: string,
  invalidCode: string,
): Promise<v.InferOutput<TSchema>> {
  const storedObject = await bucket.get(key)

  if (!storedObject) {
    throw new TerminalNormalizeError(missingCode, `Could not load ${key} from object storage.`)
  }

  const storedText = await storedObject.text()
  let parsedValue: unknown

  try {
    parsedValue = JSON.parse(storedText)
  } catch {
    throw new TerminalNormalizeError(invalidCode, `${key} did not contain valid JSON.`)
  }

  const result = v.safeParse(dataSchema, parsedValue)
  if (!result.success) {
    throw new TerminalNormalizeError(
      invalidCode,
      `${key} failed schema validation: ${formatIssues(result.issues)}`,
    )
  }

  return result.output
}

async function markScenarioRunFailed(
  env: AppBindings,
  scenarioRunId: string,
  failureCode: string,
  failureMessage: string,
) {
  const timestamp = new Date().toISOString()

  await getDb(env)
    .update(schema.scenarioRuns)
    .set({
      status: 'failed',
      failureCode,
      failureMessage,
      updatedAt: timestamp,
    })
    .where(eq(schema.scenarioRuns.id, scenarioRunId))
}

function formatIssues(issues: readonly { message: string }[]) {
  return issues.map((issue) => issue.message).join('; ')
}

async function selectOne<T>(query: Promise<T[]>) {
  const [row] = await query
  return row ?? null
}

class TerminalNormalizeError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly persistFailure = true,
  ) {
    super(message)
    this.name = 'TerminalNormalizeError'
  }
}
