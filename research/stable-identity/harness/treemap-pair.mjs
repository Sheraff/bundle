import { createHash } from "node:crypto"
import { analyzeSnapshot } from "./analyze-snapshot.mjs"
import { matchSnapshotPair } from "./match-snapshots.mjs"
import { sortUnique } from "./utils.mjs"

function fingerprint(values) {
  return createHash("sha1").update(values.join("\u0000")).digest("hex").slice(0, 12)
}

function firstStableSourceKey(asset) {
  return asset?.sourceKeys?.find((key) => !key.startsWith("_")) ?? null
}

function fileArray(value) {
  if (!value) {
    return []
  }

  return Array.isArray(value) ? value : [value]
}

function getChunk(analysis, fileName) {
  return analysis.chunkByFile.get(fileName) ?? null
}

function getAsset(analysis, fileName, kind) {
  const collection = kind === "css" ? analysis.cssAssets : analysis.staticAssets
  return collection.find((asset) => asset.fileName === fileName) ?? null
}

function buildSharedKey(relation, fromChunks, toChunks) {
  const anchorChunks = fromChunks.length > 0 ? fromChunks : toChunks
  const ownerRoots = sortUnique(anchorChunks.flatMap((chunk) => chunk?.ownerRoots ?? []))
  const moduleIds = sortUnique(anchorChunks.flatMap((chunk) => chunk?.moduleIds ?? []))
  const identity = fingerprint([...ownerRoots, ...moduleIds])
  return `shared-lineage:${identity}`
}

function buildCssKey(relation, fromAssets, toAssets) {
  const exactSource = firstStableSourceKey(fromAssets[0]) ?? firstStableSourceKey(toAssets[0])
  if (exactSource) {
    return `css:${exactSource}`
  }

  const anchorAssets = fromAssets.length > 0 ? fromAssets : toAssets
  const ownerRoots = sortUnique(anchorAssets.flatMap((asset) => asset?.ownerRoots ?? []))
  const importerFiles = sortUnique(anchorAssets.flatMap((asset) => asset?.importerFiles ?? []))
  return `css-lineage:${fingerprint([...ownerRoots, ...importerFiles, relation])}`
}

function buildAssetKey(fromAssets, toAssets) {
  const exactSource = firstStableSourceKey(fromAssets[0]) ?? firstStableSourceKey(toAssets[0])
  if (exactSource) {
    return `asset:${exactSource}`
  }

  const anchorAssets = fromAssets.length > 0 ? fromAssets : toAssets
  const ownerRoots = sortUnique(anchorAssets.flatMap((asset) => asset?.ownerRoots ?? []))
  const importerFiles = sortUnique(anchorAssets.flatMap((asset) => asset?.importerFiles ?? []))
  const labels = sortUnique(anchorAssets.map((asset) => asset?.fileLabel).filter(Boolean))
  return `asset-lineage:${fingerprint([...ownerRoots, ...importerFiles, ...labels])}`
}

function buildEntryKey(chunk) {
  const identity = chunk.manifestSourceKeys[0] ?? chunk.facadeModule?.stableId ?? chunk.fileName
  return `${chunk.isEntry ? "entry" : "dynamic-entry"}:${identity}`
}

function packageNameFromStableId(stableId) {
  if (!stableId.startsWith("pkg:")) {
    return null
  }

  const withoutPrefix = stableId.slice(4)
  const segments = withoutPrefix.split("/")
  if (withoutPrefix.startsWith("@")) {
    return segments.slice(0, 2).join("/")
  }

  return segments[0]
}

function collectModules(analysis) {
  const modules = new Map()

  for (const chunk of analysis.chunks) {
    for (const moduleEntry of chunk.modules) {
      const current = modules.get(moduleEntry.stableId) ?? {
        stableId: moduleEntry.stableId,
        scope: moduleEntry.scope,
        size: 0,
      }
      current.size += moduleEntry.renderedLength
      modules.set(moduleEntry.stableId, current)
    }
  }

  return modules
}

function collectPackages(modules) {
  const packages = new Map()

  for (const moduleEntry of modules.values()) {
    const packageName = packageNameFromStableId(moduleEntry.stableId)
    if (!packageName) {
      continue
    }

    const current = packages.get(packageName) ?? {
      packageName,
      size: 0,
    }
    current.size += moduleEntry.size
    packages.set(packageName, current)
  }

  return packages
}

function createRelationNodes(collectionName, relationCollection, fromAnalysis, toAnalysis) {
  const relationEntries = [
    ...(relationCollection.same ?? []),
    ...(relationCollection.split ?? []),
    ...(relationCollection.merge ?? []),
    ...(relationCollection.ambiguous ?? []),
    ...(relationCollection.added ?? []),
    ...(relationCollection.removed ?? []),
  ]

  return relationEntries.map((relationEntry) => {
    const fromRefs = fileArray(relationEntry.from)
    const toRefs = fileArray(relationEntry.to)
    const fromObjects = fromRefs
      .map((fileName) =>
        collectionName === "sharedChunks"
          ? getChunk(fromAnalysis, fileName)
          : getAsset(fromAnalysis, fileName, collectionName === "css" ? "css" : "asset"),
      )
      .filter(Boolean)
    const toObjects = toRefs
      .map((fileName) =>
        collectionName === "sharedChunks"
          ? getChunk(toAnalysis, fileName)
          : getAsset(toAnalysis, fileName, collectionName === "css" ? "css" : "asset"),
      )
      .filter(Boolean)

    let stableKey
    if (collectionName === "sharedChunks") {
      stableKey = buildSharedKey(relationEntry.relation, fromObjects, toObjects)
    } else if (collectionName === "css") {
      stableKey = buildCssKey(relationEntry.relation, fromObjects, toObjects)
    } else {
      stableKey = buildAssetKey(fromObjects, toObjects)
    }

    return {
      kind: collectionName,
      relation: relationEntry.relation,
      stableKey,
      from: fromRefs,
      to: toRefs,
      fromSize: fromObjects.reduce((total, entry) => total + (entry.sizes?.raw ?? 0), 0),
      toSize: toObjects.reduce((total, entry) => total + (entry.sizes?.raw ?? 0), 0),
    }
  })
}

function createEntryNodes(analysis) {
  return [...analysis.entries, ...analysis.dynamicEntries].map((chunk) => ({
    kind: chunk.isEntry ? "entry" : "dynamicEntry",
    stableKey: buildEntryKey(chunk),
    fileName: chunk.fileName,
    size: chunk.sizes.raw,
  }))
}

function createModuleNodes(fromAnalysis, toAnalysis) {
  const fromModules = collectModules(fromAnalysis)
  const toModules = collectModules(toAnalysis)
  const allIds = sortUnique([...fromModules.keys(), ...toModules.keys()])

  return allIds.map((stableId) => ({
    kind: "module",
    stableKey: `module:${stableId}`,
    fromSize: fromModules.get(stableId)?.size ?? 0,
    toSize: toModules.get(stableId)?.size ?? 0,
  }))
}

function createPackageNodes(fromAnalysis, toAnalysis) {
  const fromPackages = collectPackages(collectModules(fromAnalysis))
  const toPackages = collectPackages(collectModules(toAnalysis))
  const allPackages = sortUnique([...fromPackages.keys(), ...toPackages.keys()])

  return allPackages.map((packageName) => ({
    kind: "package",
    stableKey: `package:${packageName}`,
    fromSize: fromPackages.get(packageName)?.size ?? 0,
    toSize: toPackages.get(packageName)?.size ?? 0,
  }))
}

export function deriveTreemapPair(fromSnapshot, toSnapshot) {
  const fromAnalysis = analyzeSnapshot(fromSnapshot)
  const toAnalysis = analyzeSnapshot(toSnapshot)
  const match = matchSnapshotPair(fromSnapshot, toSnapshot)

  return {
    match,
    entries: {
      from: createEntryNodes(fromAnalysis),
      to: createEntryNodes(toAnalysis),
    },
    sharedChunks: createRelationNodes("sharedChunks", match.sharedChunks, fromAnalysis, toAnalysis),
    css: createRelationNodes("css", match.css, fromAnalysis, toAnalysis),
    assets: createRelationNodes("assets", match.assets, fromAnalysis, toAnalysis),
    modules: createModuleNodes(fromAnalysis, toAnalysis),
    packages: createPackageNodes(fromAnalysis, toAnalysis),
  }
}
