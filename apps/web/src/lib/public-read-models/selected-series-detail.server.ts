import { normalizedSnapshotV1Schema, type NormalizedEnvironmentSnapshotV1 } from "@workspace/contracts"
import { and, desc, eq } from "drizzle-orm"
import * as v from "valibot"

import { getDb, schema } from "../../db/index.js"
import { selectOne } from "../../db/select-one.js"
import type { AppBindings } from "../../env.js"
import { formatIssues } from "../../shared/format-issues.js"
import { metricValue, type SizeMetric } from "../size-metric.js"

export type DetailAvailability =
  | { status: "unavailable"; message: string }
  | { status: "available"; snapshot: SnapshotDetail; baseSnapshot?: SnapshotDetail | null; diffs?: DiffDetail }

export type SnapshotDetail = {
  assets: DetailAsset[]
  chunks: DetailChunk[]
  modules: DetailModule[]
  packages: DetailPackage[]
  graphEdges: DetailGraphEdge[]
  treemapNodes: DetailTreemapNode[]
  waterfallRows: DetailWaterfallRow[]
  warnings: string[]
}

export type DetailAsset = {
  fileName: string
  kind: string
  raw: number
  gzip: number
  brotli: number
  owners: string[]
}

export type DetailChunk = {
  fileName: string
  label: string
  isEntry: boolean
  isDynamicEntry: boolean
  raw: number
  gzip: number
  brotli: number
  moduleCount: number
}

export type DetailModule = {
  stableId: string
  rawId: string
  scope: string
  renderedLength: number
}

export type DetailPackage = {
  packageName: string
  moduleCount: number
  renderedLength: number
}

export type DetailGraphEdge = {
  from: string
  to: string
  kind: string
}

export type DetailTreemapNode = {
  id: string
  parentId: string | null
  label: string
  kind: string
  value: number
  state?: string
}

export type DetailWaterfallRow = {
  id: string
  label: string
  depth: number
  value: number
}

export type DiffDetail = {
  assets: DetailDiffRow[]
  chunks: DetailDiffRow[]
  modules: DetailDiffRow[]
  packages: DetailDiffRow[]
  treemapNodes: DetailTreemapNode[]
}

export type TreemapTimeline = {
  frames: TreemapTimelineFrame[]
  baseFrameIndex?: number
  headFrameIndex?: number
  initialFrameIndex: number
  initialNodes: DetailTreemapNode[]
}

export type TreemapTimelineFrame = {
  commitSha: string
  measuredAt: string
  scenarioRunId: string
  nodesUrl: string
}

export type DetailDiffRow = {
  key: string
  label: string
  kind: string
  state: "added" | "removed" | "grown" | "shrunk" | "same"
  current: number
  baseline: number
  delta: number
}

export async function loadSnapshotDetailForScenarioRun(
  env: AppBindings,
  input: {
    scenarioRunId: string
    environment: string
    entrypoint: string
    metric: SizeMetric
  },
): Promise<DetailAvailability> {
  const snapshot = await loadScenarioRunSnapshot(env, input.scenarioRunId)

  if (!snapshot.status) {
    return { status: "unavailable", message: snapshot.message }
  }

  return {
    status: "available",
    snapshot: buildSnapshotDetail(snapshot.snapshot, input.environment, input.entrypoint, input.metric),
  }
}

export async function loadComparisonDetail(
  env: AppBindings,
  input: {
    comparisonId: string
    environment: string
    entrypoint: string
    metric: SizeMetric
  },
): Promise<DetailAvailability> {
  const comparison = await selectOne(
    getDb(env)
      .select({
        baseScenarioRunId: schema.comparisons.baseScenarioRunId,
        headScenarioRunId: schema.comparisons.headScenarioRunId,
      })
      .from(schema.comparisons)
      .where(eq(schema.comparisons.id, input.comparisonId))
      .limit(1),
  )

  if (!comparison) {
    return { status: "unavailable", message: "The selected comparison row no longer exists." }
  }

  const head = await loadScenarioRunSnapshot(env, comparison.headScenarioRunId)
  if (!head.status) return { status: "unavailable", message: head.message }

  const headSnapshot = buildSnapshotDetail(head.snapshot, input.environment, input.entrypoint, input.metric)

  if (!comparison.baseScenarioRunId) {
    return {
      status: "available",
      snapshot: headSnapshot,
      baseSnapshot: null,
      diffs: buildDiffDetail(null, headSnapshot, input.metric),
    }
  }

  const base = await loadScenarioRunSnapshot(env, comparison.baseScenarioRunId)
  if (!base.status) {
    return {
      status: "available",
      snapshot: headSnapshot,
      baseSnapshot: null,
      diffs: buildDiffDetail(null, headSnapshot, input.metric),
    }
  }

  const baseSnapshot = buildSnapshotDetail(base.snapshot, input.environment, input.entrypoint, input.metric)

  return {
    status: "available",
    snapshot: headSnapshot,
    baseSnapshot,
    diffs: buildDiffDetail(baseSnapshot, headSnapshot, input.metric),
  }
}

export async function loadTreemapTimelineForSeries(
  env: AppBindings,
  input: {
    repositoryId: string
    repositoryOwner: string
    repositoryName: string
    seriesId: string
    branch: string
    environment: string
    entrypoint: string
    metric: SizeMetric
    baseCommitSha?: string | null
    headCommitSha?: string | null
    limit?: number
  },
): Promise<TreemapTimeline | null> {
  const latestRows = await getDb(env)
    .select({
      scenarioRunId: schema.seriesPoints.scenarioRunId,
      commitSha: schema.seriesPoints.commitSha,
      measuredAt: schema.seriesPoints.measuredAt,
    })
    .from(schema.seriesPoints)
    .where(and(
      eq(schema.seriesPoints.repositoryId, input.repositoryId),
      eq(schema.seriesPoints.seriesId, input.seriesId),
      eq(schema.seriesPoints.branch, input.branch),
    ))
    .orderBy(desc(schema.seriesPoints.measuredAt))
    .limit(input.limit ?? 20)

  const rowsByRunId = new Map(latestRows.map((row) => [row.scenarioRunId, row]))
  for (const commitSha of [input.baseCommitSha, input.headCommitSha]) {
    if (!commitSha) continue
    const existing = latestRows.find((row) => row.commitSha === commitSha)
    if (existing) continue

    const point = await selectOne(getDb(env)
      .select({
        scenarioRunId: schema.seriesPoints.scenarioRunId,
        commitSha: schema.seriesPoints.commitSha,
        measuredAt: schema.seriesPoints.measuredAt,
      })
      .from(schema.seriesPoints)
      .where(and(
        eq(schema.seriesPoints.repositoryId, input.repositoryId),
        eq(schema.seriesPoints.seriesId, input.seriesId),
        eq(schema.seriesPoints.branch, input.branch),
        eq(schema.seriesPoints.commitSha, commitSha),
      ))
      .limit(1))

    if (point) rowsByRunId.set(point.scenarioRunId, point)
  }

  const rows = [...rowsByRunId.values()].sort((left, right) => left.measuredAt.localeCompare(right.measuredAt))
  const frames: TreemapTimelineFrame[] = rows.map((row) => ({
    commitSha: row.commitSha,
    measuredAt: row.measuredAt,
    scenarioRunId: row.scenarioRunId,
    nodesUrl: treemapFrameUrl({
      owner: input.repositoryOwner,
      repo: input.repositoryName,
      scenarioRunId: row.scenarioRunId,
      environment: input.environment,
      entrypoint: input.entrypoint,
      metric: input.metric,
    }),
  }))

  if (frames.length === 0) return null

  const baseFrameIndex = input.baseCommitSha ? frames.findIndex((frame) => frame.commitSha === input.baseCommitSha) : -1
  const headFrameIndex = input.headCommitSha ? frames.findIndex((frame) => frame.commitSha === input.headCommitSha) : -1
  const initialFrameIndex = headFrameIndex >= 0 ? headFrameIndex : frames.length - 1
  const initialNodes = await loadTreemapFrameForScenarioRun(env, {
    scenarioRunId: frames[initialFrameIndex]!.scenarioRunId,
    environment: input.environment,
    entrypoint: input.entrypoint,
    metric: input.metric,
  })

  return {
    frames,
    baseFrameIndex: baseFrameIndex >= 0 ? baseFrameIndex : undefined,
    headFrameIndex: headFrameIndex >= 0 ? headFrameIndex : undefined,
    initialFrameIndex,
    initialNodes,
  }
}

export async function loadTreemapFrameForScenarioRun(
  env: AppBindings,
  input: {
    scenarioRunId: string
    environment: string
    entrypoint: string
    metric: SizeMetric
  },
) {
  const snapshot = await loadScenarioRunSnapshot(env, input.scenarioRunId)
  if (!snapshot.status) return []

  return buildSnapshotDetail(snapshot.snapshot, input.environment, input.entrypoint, input.metric).treemapNodes
}

function treemapFrameUrl(input: {
  owner: string
  repo: string
  scenarioRunId: string
  environment: string
  entrypoint: string
  metric: SizeMetric
}) {
  const params = new URLSearchParams({
    owner: input.owner,
    repo: input.repo,
    scenarioRunId: input.scenarioRunId,
    env: input.environment,
    entrypoint: input.entrypoint,
    metric: input.metric,
  })

  return `/api/v1/public/treemap-frame?${params.toString()}`
}

async function loadScenarioRunSnapshot(env: AppBindings, scenarioRunId: string) {
  const scenarioRun = await selectOne(
    getDb(env)
      .select({ normalizedSnapshotR2Key: schema.scenarioRuns.normalizedSnapshotR2Key })
      .from(schema.scenarioRuns)
      .where(eq(schema.scenarioRuns.id, scenarioRunId))
      .limit(1),
  )

  if (!scenarioRun?.normalizedSnapshotR2Key) {
    return {
      status: false as const,
      message: "The selected run does not have a normalized snapshot yet.",
    }
  }

  const object = await env.CACHE_BUCKET.get(scenarioRun.normalizedSnapshotR2Key)
  if (!object) {
    return {
      status: false as const,
      message: `The normalized snapshot object ${scenarioRun.normalizedSnapshotR2Key} is missing from cache storage.`,
    }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(await object.text())
  } catch {
    return { status: false as const, message: "The normalized snapshot object contains invalid JSON." }
  }

  const result = v.safeParse(normalizedSnapshotV1Schema, parsed)
  if (!result.success) {
    return {
      status: false as const,
      message: `The normalized snapshot failed validation: ${formatIssues(result.issues)}`,
    }
  }

  return { status: true as const, snapshot: result.output }
}

function buildSnapshotDetail(
  snapshot: v.InferOutput<typeof normalizedSnapshotV1Schema>,
  environmentName: string,
  entrypointKey: string,
  metric: SizeMetric,
): SnapshotDetail {
  const environment = selectEnvironment(snapshot.environments, environmentName)
  const closureChunkNames = selectClosureChunkNames(environment, entrypointKey)
  const chunks = environment.chunks.filter((chunk) => closureChunkNames.has(chunk.fileName))
  const chunkNameSet = new Set(chunks.map((chunk) => chunk.fileName))
  const assetNames = new Set(
    environment.assetRelations
      .filter((relation) => chunkNameSet.has(relation.chunkFileName))
      .map((relation) => relation.assetFileName),
  )
  const assets = environment.assets.filter(
    (asset) => assetNames.has(asset.fileName) || asset.ownerRoots.some((owner) => closureChunkNames.has(owner)),
  )
  const modules = chunks.flatMap((chunk) => chunk.modules)
  const packages = environment.packages
  const rootId = "root"
  const treemapNodes: DetailTreemapNode[] = [
    { id: rootId, parentId: null, label: "selected series", kind: "root", value: 0 },
  ]

  for (const chunk of chunks) {
    const chunkId = `chunk:${stableChunkId(chunk)}`
    treemapNodes.push({
      id: chunkId,
      parentId: rootId,
      label: chunk.fileLabel,
      kind: "chunk",
      value: metricValue(chunk.sizes, metric),
    })

    for (const module of chunk.modules) {
      treemapNodes.push({
        id: `module:${chunkId}:${module.stableId}`,
        parentId: chunkId,
        label: module.rawId,
        kind: module.scope,
        value: module.renderedLength,
      })
    }
  }

  for (const asset of assets) {
    treemapNodes.push({
      id: `asset:${stableAssetId(asset)}`,
      parentId: rootId,
      label: asset.fileLabel,
      kind: asset.kind,
      value: metricValue(asset.sizes, metric),
    })
  }

  return {
    assets: assets.map((asset) => ({
      fileName: asset.fileName,
      kind: asset.kind,
      raw: asset.sizes.raw,
      gzip: asset.sizes.gzip,
      brotli: asset.sizes.brotli,
      owners: asset.ownerRoots,
    })),
    chunks: chunks.map((chunk) => ({
      fileName: chunk.fileName,
      label: chunk.fileLabel,
      isEntry: chunk.isEntry,
      isDynamicEntry: chunk.isDynamicEntry,
      raw: chunk.sizes.raw,
      gzip: chunk.sizes.gzip,
      brotli: chunk.sizes.brotli,
      moduleCount: chunk.modules.length,
    })),
    modules: modules.map((module) => ({
      stableId: module.stableId,
      rawId: module.rawId,
      scope: module.scope,
      renderedLength: module.renderedLength,
    })),
    packages,
    graphEdges: environment.chunkGraphEdges
      .filter((edge) => chunkNameSet.has(edge.fromChunkFileName) && chunkNameSet.has(edge.toChunkFileName))
      .map((edge) => ({ from: edge.fromChunkFileName, to: edge.toChunkFileName, kind: edge.kind })),
    treemapNodes,
    waterfallRows: buildWaterfallRows(environment, chunks, entrypointKey, metric),
    warnings: environment.warnings.map((warning) => `${warning.code}: ${warning.message}`),
  }
}

function stableChunkId(chunk: NormalizedEnvironmentSnapshotV1["chunks"][number]) {
  return chunk.manifestSourceKeys[0] ?? chunk.facadeModule?.stableId ?? chunk.fileName
}

function stableAssetId(asset: NormalizedEnvironmentSnapshotV1["assets"][number]) {
  return asset.sourceKeys[0] ?? asset.fileName
}

function selectEnvironment(environments: NormalizedEnvironmentSnapshotV1[], environmentName: string) {
  if (environmentName !== "all") {
    return environments.find((environment) => environment.name === environmentName) ?? environments[0]!
  }

  return environments[0]!
}

function selectClosureChunkNames(environment: NormalizedEnvironmentSnapshotV1, entrypointKey: string) {
  const selectedEntrypoint =
    entrypointKey !== "all"
      ? environment.entrypoints.find((entrypoint) => entrypoint.key === entrypointKey)
      : null
  const startChunk = selectedEntrypoint?.chunkFileName ?? environment.entrypoints[0]?.chunkFileName
  const names = new Set<string>()

  if (!startChunk) {
    for (const chunk of environment.chunks) names.add(chunk.fileName)
    return names
  }

  const byName = new Map(environment.chunks.map((chunk) => [chunk.fileName, chunk]))
  const queue = [startChunk]

  while (queue.length > 0) {
    const name = queue.shift()!
    if (names.has(name)) continue
    names.add(name)
    const chunk = byName.get(name)
    if (!chunk) continue
    queue.push(...chunk.imports, ...chunk.dynamicImports, ...chunk.implicitlyLoadedBefore)
  }

  return names
}

function buildWaterfallRows(
  environment: NormalizedEnvironmentSnapshotV1,
  chunks: NormalizedEnvironmentSnapshotV1["chunks"],
  entrypointKey: string,
  metric: SizeMetric,
): DetailWaterfallRow[] {
  const selectedEntrypoint =
    entrypointKey !== "all"
      ? environment.entrypoints.find((entrypoint) => entrypoint.key === entrypointKey)
      : null
  const startChunk = selectedEntrypoint?.chunkFileName ?? chunks[0]?.fileName
  if (!startChunk) return []

  const byName = new Map(chunks.map((chunk) => [chunk.fileName, chunk]))
  const rows: DetailWaterfallRow[] = []
  const queue = [{ name: startChunk, depth: 0 }]
  const seen = new Set<string>()

  while (queue.length > 0) {
    const next = queue.shift()!
    if (seen.has(next.name)) continue
    seen.add(next.name)
    const chunk = byName.get(next.name)
    if (!chunk) continue
    rows.push({
      id: chunk.fileName,
      label: chunk.fileLabel,
      depth: next.depth,
      value: metricValue(chunk.sizes, metric),
    })
    queue.push(
      ...chunk.imports.map((name) => ({ name, depth: next.depth + 1 })),
      ...chunk.dynamicImports.map((name) => ({ name, depth: next.depth + 1 })),
    )
  }

  return rows
}

function buildDiffDetail(
  base: SnapshotDetail | null,
  head: SnapshotDetail,
  metric: SizeMetric,
): DiffDetail {
  const chunks = diffRows(
    base?.chunks ?? [],
    head.chunks,
    (chunk) => chunk.fileName,
    (chunk) => chunk.label,
    () => "chunk",
    (chunk) => sizeFromMetric(chunk, metric),
  )
  const assets = diffRows(
    base?.assets ?? [],
    head.assets,
    (asset) => asset.fileName,
    (asset) => asset.fileName,
    (asset) => asset.kind,
    (asset) => sizeFromMetric(asset, metric),
  )
  const modules = diffRows(
    base?.modules ?? [],
    head.modules,
    (module) => module.stableId,
    (module) => module.rawId,
    (module) => module.scope,
    (module) => module.renderedLength,
  )
  const packages = diffRows(
    base?.packages ?? [],
    head.packages,
    (pkg) => pkg.packageName,
    (pkg) => pkg.packageName,
    () => "package",
    (pkg) => pkg.renderedLength,
  )

  return {
    assets,
    chunks,
    modules,
    packages,
    treemapNodes: diffTreemapNodes([...chunks, ...assets]),
  }
}

function diffRows<T>(
  baseRows: T[],
  headRows: T[],
  keyOf: (row: T) => string,
  labelOf: (row: T) => string,
  kindOf: (row: T) => string,
  valueOf: (row: T) => number,
) {
  const base = new Map(baseRows.map((row) => [keyOf(row), row]))
  const head = new Map(headRows.map((row) => [keyOf(row), row]))
  const keys = new Set([...base.keys(), ...head.keys()])

  return [...keys].map((key) => {
    const baseRow = base.get(key)
    const headRow = head.get(key)
    const baseline = baseRow ? valueOf(baseRow) : 0
    const current = headRow ? valueOf(headRow) : 0
    const delta = current - baseline
    const state: DetailDiffRow["state"] = !baseRow
      ? "added"
      : !headRow
        ? "removed"
        : delta > 0
          ? "grown"
          : delta < 0
            ? "shrunk"
            : "same"
    const displayRow = headRow ?? baseRow!

    return {
      key,
      label: labelOf(displayRow),
      kind: kindOf(displayRow),
      state,
      current,
      baseline,
      delta,
    }
  })
}

function diffTreemapNodes(rows: DetailDiffRow[]): DetailTreemapNode[] {
  return [
    { id: "root", parentId: null, label: "changed bytes", kind: "root", value: 0 },
    ...rows
      .filter((row) => row.state !== "same")
      .map((row) => ({
        id: `${row.kind}:${row.key}`,
        parentId: "root",
        label: row.label,
        kind: row.kind,
        value: Math.abs(row.delta),
        state: row.state,
      })),
  ]
}

function sizeFromMetric(row: { raw: number; gzip: number; brotli: number }, metric: SizeMetric) {
  if (metric === "raw") return row.raw
  if (metric === "gzip") return row.gzip
  return row.brotli
}
