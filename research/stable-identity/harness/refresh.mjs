import { buildFixtures } from './build-fixtures.mjs';
import { runExpectations } from './run-expectations.mjs';

await buildFixtures();
const ok = await runExpectations();

if (!ok) {
  process.exitCode = 1;
}
