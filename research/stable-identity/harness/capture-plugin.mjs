import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  getFileKind,
  measureFile,
  normalizeModuleId,
  normalizeOriginalFileName,
  readJson,
  sortUnique,
  writeJson,
} from './utils.mjs';

function resolveFilePath(value, appRoot) {
  if (value instanceof URL) {
    return fileURLToPath(value);
  }

  return path.resolve(appRoot, value);
}

function resolveArtifactFile(optionValue, environmentName) {
  if (typeof optionValue === 'function') {
    return optionValue(environmentName);
  }

  if (
    optionValue &&
    typeof optionValue === 'object' &&
    !(optionValue instanceof URL)
  ) {
    return optionValue[environmentName] ?? optionValue.default;
  }

  return optionValue;
}

function serializeManifest(manifest) {
  return Object.entries(manifest)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => ({
      key,
      src: entry.src ?? null,
      name: entry.name ?? null,
      file: entry.file,
      isEntry: Boolean(entry.isEntry),
      isDynamicEntry: Boolean(entry.isDynamicEntry),
      imports: sortUnique(entry.imports ?? []),
      dynamicImports: sortUnique(entry.dynamicImports ?? []),
      css: sortUnique(entry.css ?? []),
      assets: sortUnique(entry.assets ?? []),
    }));
}

export function stableIdentityCapturePlugin(options) {
  let resolvedConfig;
  let viteVersion = null;
  const stateByEnvironment = new Map();

  return {
    name: 'stable-identity-capture',
    apply: 'build',

    configResolved(config) {
      resolvedConfig = config;
    },

    buildStart() {
      viteVersion = this.meta.viteVersion ?? null;
      const environmentName = this.environment?.name ?? options.environmentName ?? 'default';
      if (!stateByEnvironment.has(environmentName)) {
        stateByEnvironment.set(environmentName, {
          serializedBundle: null,
        });
      }
    },

    generateBundle(_, bundle) {
      const environmentName = this.environment?.name ?? options.environmentName ?? 'default';
      const appRoot = resolvedConfig.root;
      const normalizationOptions = { appRoot };
      const environmentState = stateByEnvironment.get(environmentName) ?? {
        serializedBundle: null,
      };

      environmentState.serializedBundle = {
        chunks: [],
        assets: [],
      };
      stateByEnvironment.set(environmentName, environmentState);

      for (const fileName of Object.keys(bundle).sort((left, right) => left.localeCompare(right))) {
        const output = bundle[fileName];
        if (output.type === 'chunk') {
          const modules = Object.entries(output.modules)
            .map(([moduleId, info]) => {
              const normalizedId = normalizeModuleId(moduleId, normalizationOptions);
              return {
                rawId: normalizedId.rawId,
                stableId: normalizedId.stableId,
                scope: normalizedId.scope,
                renderedLength: info.renderedLength,
                originalLength: info.originalLength,
                renderedExports: sortUnique(info.renderedExports ?? []),
                removedExports: sortUnique(info.removedExports ?? []),
              };
            })
            .sort((left, right) => left.stableId.localeCompare(right.stableId));

          const facadeModule = output.facadeModuleId
            ? normalizeModuleId(output.facadeModuleId, normalizationOptions)
            : null;

          environmentState.serializedBundle.chunks.push({
            fileName,
            kind: 'chunk',
            name: output.name,
            isEntry: output.isEntry,
            isDynamicEntry: output.isDynamicEntry,
            facadeModule,
            imports: sortUnique(output.imports),
            dynamicImports: sortUnique(output.dynamicImports),
            implicitlyLoadedBefore: sortUnique(output.implicitlyLoadedBefore ?? []),
            importedCss: sortUnique([...(output.viteMetadata?.importedCss ?? [])]),
            importedAssets: sortUnique([...(output.viteMetadata?.importedAssets ?? [])]),
            modules,
            moduleIds: sortUnique(modules.map((moduleEntry) => moduleEntry.stableId)),
          });
          continue;
        }

        const originalFileNames = sortUnique(
          (output.originalFileNames ?? []).map((originalFileName) =>
            normalizeOriginalFileName(originalFileName, normalizationOptions),
          ),
        );

        environmentState.serializedBundle.assets.push({
          fileName,
          kind: getFileKind(fileName),
          names: sortUnique(output.names ?? []),
          originalFileNames,
          needsCodeReference: output.needsCodeReference,
          sourceLength:
            typeof output.source === 'string'
              ? Buffer.byteLength(output.source)
              : output.source.byteLength,
        });
      }
    },

    async closeBundle() {
      const environmentName = this.environment?.name ?? options.environmentName ?? 'default';
      const environmentState = stateByEnvironment.get(environmentName);
      const serializedBundle = environmentState?.serializedBundle;

      if (!serializedBundle || !resolvedConfig) {
        return;
      }

      const appRoot = resolvedConfig.root;
      const environmentBuildConfig = this.environment?.config?.build ?? resolvedConfig.build;
      const outDir = path.resolve(appRoot, environmentBuildConfig.outDir);
      const artifactTarget = resolveArtifactFile(options.artifactFile, environmentName);
      if (!artifactTarget) {
        return;
      }

      const artifactFile = resolveFilePath(artifactTarget, appRoot);
      const manifestFile = path.join(outDir, '.vite', 'manifest.json');

      let manifestEntries = [];
      let warnings = [];

      try {
        const manifest = await readJson(manifestFile);
        manifestEntries = serializeManifest(manifest);
      } catch (error) {
        warnings.push({
          type: 'missing-manifest',
          message: `Could not read ${manifestFile}`,
        });
      }

      const chunks = await Promise.all(
        serializedBundle.chunks.map(async (chunk) => ({
          ...chunk,
          sizes: await measureFile(path.join(outDir, chunk.fileName)),
        })),
      );

      const assets = await Promise.all(
        serializedBundle.assets.map(async (asset) => ({
          ...asset,
          sizes: await measureFile(path.join(outDir, asset.fileName)),
        })),
      );

      const snapshot = {
        artifactVersion: 1,
        fixtureId: options.fixtureId,
        versionId: options.versionId,
        scenarioId: options.scenarioId,
        environmentName,
        generatedAt: new Date().toISOString(),
        build: {
          bundler: 'vite',
          bundlerVersion: viteVersion,
          outDir: environmentBuildConfig.outDir,
        },
        warnings,
        manifestEntries,
        chunks,
        assets,
      };

      await writeJson(artifactFile, snapshot);
    },
  };
}
