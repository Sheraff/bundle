import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';

const repoRoot = path.resolve(new URL('../../..', import.meta.url).pathname);
const appsRoot = path.join(repoRoot, 'research', 'stable-identity', 'apps');

async function listFixtureApps() {
  const fixtures = [];
  const fixtureDirs = await fs.readdir(appsRoot, { withFileTypes: true });
  for (const fixtureDir of fixtureDirs) {
    if (!fixtureDir.isDirectory()) {
      continue;
    }

    const fixturePath = path.join(appsRoot, fixtureDir.name);
    const versionDirs = await fs.readdir(fixturePath, { withFileTypes: true });
    for (const versionDir of versionDirs) {
      if (!versionDir.isDirectory()) {
        continue;
      }

      const versionPath = path.join(fixturePath, versionDir.name);
      try {
        await fs.access(path.join(versionPath, 'package.json'));
        fixtures.push({
          fixtureId: fixtureDir.name,
          versionId: versionDir.name,
          path: versionPath,
        });
      } catch {
        // ignore
      }
    }
  }

  return fixtures.sort((left, right) => left.path.localeCompare(right.path));
}

function runBuild(cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn('pnpm', ['run', 'build'], {
      cwd,
      stdio: 'inherit',
      env: process.env,
    });

    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`Build failed in ${cwd} with exit code ${code}`));
    });
    child.on('error', reject);
  });
}

export async function buildFixtures() {
  const fixtures = await listFixtureApps();

  for (const fixture of fixtures) {
    console.log(`\n== Building ${fixture.fixtureId}/${fixture.versionId}`);
    await runBuild(fixture.path);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await buildFixtures();
}
