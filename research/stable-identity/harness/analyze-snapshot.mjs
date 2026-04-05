import path from 'node:path';
import { fileLabel, readJson, sortUnique } from './utils.mjs';

function buildManifestIndexes(snapshot) {
  const selfByFile = new Map();
  const importersByFile = new Map();

  for (const entry of snapshot.manifestEntries) {
    const selfEntries = selfByFile.get(entry.file) ?? [];
    selfEntries.push(entry);
    selfByFile.set(entry.file, selfEntries);

    for (const fileName of entry.imports) {
      const importers = importersByFile.get(fileName) ?? [];
      importers.push({ relation: 'imports', entry });
      importersByFile.set(fileName, importers);
    }

    for (const fileName of entry.dynamicImports) {
      const importers = importersByFile.get(fileName) ?? [];
      importers.push({ relation: 'dynamicImports', entry });
      importersByFile.set(fileName, importers);
    }

    for (const fileName of entry.css) {
      const importers = importersByFile.get(fileName) ?? [];
      importers.push({ relation: 'css', entry });
      importersByFile.set(fileName, importers);
    }

    for (const fileName of entry.assets) {
      const importers = importersByFile.get(fileName) ?? [];
      importers.push({ relation: 'assets', entry });
      importersByFile.set(fileName, importers);
    }
  }

  return { selfByFile, importersByFile };
}

function buildChunkIndexes(chunks) {
  const byFile = new Map();

  for (const chunk of chunks) {
    byFile.set(chunk.fileName, chunk);
  }

  return { byFile };
}

function getManifestSourceKeys(manifestEntries) {
  return sortUnique(
    manifestEntries.map((entry) => entry.src ?? entry.key).filter(Boolean),
  );
}

function getRootKey(chunk) {
  return (
    chunk.manifestSourceKeys[0] ??
    chunk.facadeModule?.stableId ??
    chunk.fileName
  );
}

function buildOwnerRoots(chunks, chunkByFile) {
  const roots = chunks.filter((chunk) => chunk.isEntry || chunk.isDynamicEntry);

  for (const chunk of chunks) {
    chunk.ownerRoots = [];
  }

  for (const root of roots) {
    const rootKey = getRootKey(root);
    const queue = [root.fileName];
    const visited = new Set();

    while (queue.length > 0) {
      const currentFile = queue.shift();
      if (visited.has(currentFile)) {
        continue;
      }

      visited.add(currentFile);
      const currentChunk = chunkByFile.get(currentFile);
      if (!currentChunk) {
        continue;
      }

      currentChunk.ownerRoots = sortUnique([...currentChunk.ownerRoots, rootKey]);
      for (const importedFile of [...currentChunk.imports, ...currentChunk.dynamicImports]) {
        if (chunkByFile.has(importedFile)) {
          queue.push(importedFile);
        }
      }
    }
  }
}

function annotateChunks(snapshot, manifestIndexes) {
  const chunks = snapshot.chunks.map((chunk) => {
    const selfEntries = manifestIndexes.selfByFile.get(chunk.fileName) ?? [];
    const manifestSourceKeys = getManifestSourceKeys(selfEntries);
    const moduleWeights = Object.fromEntries(
      chunk.modules.map((moduleEntry) => [moduleEntry.stableId, moduleEntry.renderedLength]),
    );

    return {
      ...chunk,
      fileLabel: fileLabel(chunk.fileName),
      manifestSourceKeys,
      moduleWeights,
      totalRenderedLength: chunk.modules.reduce(
        (total, moduleEntry) => total + moduleEntry.renderedLength,
        0,
      ),
    };
  });

  const chunkIndexes = buildChunkIndexes(chunks);
  buildOwnerRoots(chunks, chunkIndexes.byFile);

  return {
    chunks,
    chunkByFile: chunkIndexes.byFile,
  };
}

function annotateAssets(snapshot, manifestIndexes, chunkByFile) {
  const assetOwnerRoots = new Map();

  for (const chunk of snapshot.chunks) {
    const annotatedChunk = chunkByFile.get(chunk.fileName);
    for (const assetFile of [...chunk.importedAssets, ...chunk.importedCss]) {
      const ownerRoots = assetOwnerRoots.get(assetFile) ?? new Set();
      for (const ownerRoot of annotatedChunk?.ownerRoots ?? []) {
        ownerRoots.add(ownerRoot);
      }
      assetOwnerRoots.set(assetFile, ownerRoots);
    }
  }

  return snapshot.assets.map((asset) => {
    const selfEntries = manifestIndexes.selfByFile.get(asset.fileName) ?? [];
    const importerEntries = manifestIndexes.importersByFile.get(asset.fileName) ?? [];
    const sourceKeys = sortUnique([
      ...asset.originalFileNames,
      ...getManifestSourceKeys(selfEntries),
    ]);
    const importerKeys = sortUnique(
      importerEntries.map(({ entry }) => entry.src ?? entry.key).filter(Boolean),
    );
    const importerFiles = sortUnique(
      importerEntries.map(({ entry }) => entry.file).filter(Boolean),
    );
    const ownerRoots = sortUnique([...(assetOwnerRoots.get(asset.fileName) ?? new Set())]);

    return {
      ...asset,
      fileLabel: fileLabel(asset.fileName),
      sourceKeys,
      importerKeys,
      importerFiles,
      ownerRoots,
    };
  });
}

export function analyzeSnapshot(snapshot) {
  const manifestIndexes = buildManifestIndexes(snapshot);
  const { chunks, chunkByFile } = annotateChunks(snapshot, manifestIndexes);
  const assets = annotateAssets(snapshot, manifestIndexes, chunkByFile);

  return {
    snapshot,
    chunks,
    assets,
    entries: chunks.filter((chunk) => chunk.isEntry),
    dynamicEntries: chunks.filter((chunk) => chunk.isDynamicEntry),
    sharedChunks: chunks.filter((chunk) => !chunk.isEntry && !chunk.isDynamicEntry),
    cssAssets: assets.filter((asset) => asset.kind === 'css'),
    staticAssets: assets.filter((asset) => asset.kind !== 'css'),
    chunkByFile,
  };
}

export async function loadAndAnalyzeSnapshot(filePath) {
  const snapshot = await readJson(filePath);
  return analyzeSnapshot(snapshot);
}
