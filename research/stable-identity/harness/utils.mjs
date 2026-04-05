import fs from 'node:fs/promises';
import path from 'node:path';
import { brotliCompressSync, gzipSync } from 'node:zlib';

export function toPosixPath(value) {
  return value.replace(/\\/g, '/');
}

export function sortUnique(values) {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

export function removeQuery(value) {
  const index = value.indexOf('?');
  return index === -1 ? value : value.slice(0, index);
}

export function splitQuery(value) {
  const index = value.indexOf('?');
  if (index === -1) {
    return [value, ''];
  }

  return [value.slice(0, index), value.slice(index + 1)];
}

export function makeRelativeIfInside(basePath, candidatePath) {
  const normalizedBase = toPosixPath(path.resolve(basePath));
  const normalizedCandidate = toPosixPath(path.resolve(candidatePath));

  if (
    normalizedCandidate === normalizedBase ||
    normalizedCandidate.startsWith(`${normalizedBase}/`)
  ) {
    return toPosixPath(path.relative(normalizedBase, normalizedCandidate));
  }

  return null;
}

function normalizeNodeModulesPath(value) {
  const normalized = toPosixPath(value);
  const marker = '/node_modules/';
  const lastIndex = normalized.lastIndexOf(marker);

  if (lastIndex === -1) {
    return null;
  }

  let suffix = normalized.slice(lastIndex + marker.length);
  if (suffix.startsWith('.pnpm/')) {
    const nestedMarker = '/node_modules/';
    const nestedIndex = suffix.indexOf(nestedMarker);
    if (nestedIndex !== -1) {
      suffix = suffix.slice(nestedIndex + nestedMarker.length);
    }
  }

  const segments = suffix.split('/').filter(Boolean);
  if (segments.length === 0) {
    return null;
  }

  const packageName = segments[0].startsWith('@')
    ? segments.slice(0, 2).join('/')
    : segments[0];
  const packageDepth = packageName.startsWith('@') ? 2 : 1;
  const packagePath = segments.slice(packageDepth).join('/');

  return {
    rawId: packagePath
      ? `node_modules/${packageName}/${packagePath}`
      : `node_modules/${packageName}`,
    stableId: packagePath ? `pkg:${packageName}/${packagePath}` : `pkg:${packageName}`,
    scope: 'package',
  };
}

export function normalizeModuleId(value, options) {
  const appRoot = options.appRoot;
  const normalizedValue = toPosixPath(String(value));
  const virtualValue = normalizedValue.startsWith('\0')
    ? `virtual:${normalizedValue.slice(1)}`
    : normalizedValue;
  const [pathPart, query] = splitQuery(virtualValue);
  const normalizedPath = removeQuery(pathPart);
  const packagePath = normalizeNodeModulesPath(normalizedPath);

  if (packagePath) {
    return {
      rawId: query ? `${packagePath.rawId}?${query}` : packagePath.rawId,
      stableId: packagePath.stableId,
      scope: packagePath.scope,
    };
  }

  if (normalizedPath.startsWith('virtual:')) {
    return {
      rawId: query ? `${normalizedPath}?${query}` : normalizedPath,
      stableId: normalizedPath,
      scope: 'virtual',
    };
  }

  if (path.isAbsolute(normalizedPath)) {
    const appRelative = makeRelativeIfInside(appRoot, normalizedPath);
    if (appRelative) {
      return {
        rawId: query ? `${appRelative}?${query}` : appRelative,
        stableId: appRelative,
        scope: 'app',
      };
    }
  }

  const cleanedPath = normalizedPath.replace(/^\.\//, '');
  return {
    rawId: query ? `${cleanedPath}?${query}` : cleanedPath,
    stableId: cleanedPath,
    scope: 'other',
  };
}

export function normalizeOriginalFileName(value, options) {
  return normalizeModuleId(value, options).stableId;
}

export function getFileKind(fileName) {
  const extension = path.extname(fileName).toLowerCase();

  if (extension === '.css') {
    return 'css';
  }

  if (extension === '.js' || extension === '.mjs' || extension === '.cjs') {
    return 'js';
  }

  if (extension === '.html') {
    return 'html';
  }

  return extension.slice(1) || 'unknown';
}

export function stripHashFromFileName(fileName) {
  const extension = path.extname(fileName);
  const baseName = path.basename(fileName, extension);
  return baseName.replace(/-[A-Za-z0-9_-]{6,}$/u, '');
}

export function fileLabel(fileName) {
  return `${stripHashFromFileName(fileName)}${path.extname(fileName)}`;
}

export async function readJson(filePath) {
  const contents = await fs.readFile(filePath, 'utf8');
  return JSON.parse(contents);
}

export async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

export async function measureFile(filePath) {
  const buffer = await fs.readFile(filePath);
  return {
    raw: buffer.byteLength,
    gzip: gzipSync(buffer).byteLength,
    brotli: brotliCompressSync(buffer).byteLength,
  };
}
