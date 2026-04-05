import path from 'node:path';
import { loadAndAnalyzeSnapshot } from './analyze-snapshot.mjs';

function printGroup(title, values) {
  console.log(`\n${title}`);
  for (const value of values) {
    console.log(`- ${value}`);
  }
}

const input = process.argv[2];
if (!input) {
  console.error('Usage: node inspect-artifact.mjs <artifact-json>');
  process.exit(1);
}

const artifactPath = path.resolve(process.cwd(), input);
const analysis = await loadAndAnalyzeSnapshot(artifactPath);

console.log(`${analysis.snapshot.fixtureId}/${analysis.snapshot.versionId}`);

printGroup(
  'Entries',
  analysis.entries.map(
    (chunk) => `${chunk.fileName} -> ${chunk.manifestSourceKeys.join(', ') || chunk.facadeModule?.stableId}`,
  ),
);

printGroup(
  'Dynamic entries',
  analysis.dynamicEntries.map(
    (chunk) => `${chunk.fileName} -> ${chunk.manifestSourceKeys.join(', ') || chunk.facadeModule?.stableId}`,
  ),
);

printGroup(
  'Shared chunks',
  analysis.sharedChunks.map(
    (chunk) =>
      `${chunk.fileName} owners=[${chunk.ownerRoots.join(', ')}] modules=${chunk.moduleIds.length}`,
  ),
);

printGroup(
  'CSS assets',
  analysis.cssAssets.map(
    (asset) => `${asset.fileName} sources=[${asset.sourceKeys.join(', ')}] owners=[${asset.ownerRoots.join(', ')}]`,
  ),
);

printGroup(
  'Static assets',
  analysis.staticAssets.map(
    (asset) => `${asset.fileName} sources=[${asset.sourceKeys.join(', ')}] owners=[${asset.ownerRoots.join(', ')}]`,
  ),
);
