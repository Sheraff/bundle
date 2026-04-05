import path from 'node:path';
import { readJson } from './utils.mjs';
import { deriveTreemapPair } from './treemap-pair.mjs';

function printGroup(title, values) {
  console.log(`\n${title}`);
  for (const value of values) {
    console.log(`- ${value}`);
  }
}

const fromInput = process.argv[2];
const toInput = process.argv[3];

if (!fromInput || !toInput) {
  console.error('Usage: node inspect-treemap.mjs <from-artifact> <to-artifact>');
  process.exit(1);
}

const fromSnapshot = await readJson(path.resolve(process.cwd(), fromInput));
const toSnapshot = await readJson(path.resolve(process.cwd(), toInput));
const treemap = deriveTreemapPair(fromSnapshot, toSnapshot);

console.log(`${fromSnapshot.fixtureId}/${fromSnapshot.versionId} -> ${toSnapshot.versionId}`);

printGroup(
  'Shared chunk logical nodes',
  treemap.sharedChunks.map(
    (node) => `${node.stableKey} ${node.relation} from=[${node.from.join(', ')}] to=[${node.to.join(', ')}]`,
  ),
);

printGroup(
  'CSS logical nodes',
  treemap.css.map(
    (node) => `${node.stableKey} ${node.relation} from=[${node.from.join(', ')}] to=[${node.to.join(', ')}]`,
  ),
);

printGroup(
  'Asset logical nodes',
  treemap.assets.map(
    (node) => `${node.stableKey} ${node.relation} from=[${node.from.join(', ')}] to=[${node.to.join(', ')}]`,
  ),
);

printGroup(
  'Package keys',
  treemap.packages
    .filter((node) => node.fromSize > 0 || node.toSize > 0)
    .map((node) => `${node.stableKey} from=${node.fromSize} to=${node.toSize}`),
);
