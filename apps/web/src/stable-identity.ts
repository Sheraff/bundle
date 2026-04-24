export type RelationConfidence = "exact" | "strong" | "low"

export interface StableIdentityModuleReference {
  stableId: string
}

export interface StableIdentityModule {
  stableId: string
  renderedLength: number
}

export interface StableIdentitySizes {
  raw: number
  gzip: number
  brotli: number
}

export interface StableIdentityChunk {
  fileName: string
  fileLabel: string
  isEntry: boolean
  isDynamicEntry: boolean
  facadeModule: StableIdentityModuleReference | null
  manifestSourceKeys: string[]
  ownerRoots: string[]
  imports: string[]
  dynamicImports: string[]
  moduleIds: string[]
  totalRenderedLength: number
  modules: StableIdentityModule[]
  sizes: StableIdentitySizes
}

export interface StableIdentityAsset {
  fileName: string
  fileLabel: string
  kind: string
  sourceKeys: string[]
  importerKeys: string[]
  importerFiles: string[]
  ownerRoots: string[]
  sizes: StableIdentitySizes
}

export interface StableIdentityEnvironment {
  chunks: StableIdentityChunk[]
  assets: StableIdentityAsset[]
}

export interface SameRelation {
  relation: "same"
  from: string
  to: string
  confidence: RelationConfidence
  evidence: string[]
}

export interface SplitRelation {
  relation: "split"
  from: string
  to: string[]
  confidence: RelationConfidence
  evidence: string[]
}

export interface MergeRelation {
  relation: "merge"
  from: string[]
  to: string
  confidence: RelationConfidence
  evidence: string[]
}

export interface AmbiguousRelation {
  relation: "ambiguous"
  from: string
  to: string[]
  confidence: "low"
  evidence: string[]
}

export interface AddedRelation {
  relation: "added"
  to: string
}

export interface RemovedRelation {
  relation: "removed"
  from: string
}

export interface RootMatchCollection {
  same: SameRelation[]
  added: AddedRelation[]
  removed: RemovedRelation[]
}

export interface SharedChunkMatchCollection extends RootMatchCollection {
  split: SplitRelation[]
  merge: MergeRelation[]
  ambiguous: AmbiguousRelation[]
}

export interface AssetMatchCollection extends RootMatchCollection {
  split: SplitRelation[]
  merge: MergeRelation[]
}

export interface ModuleSummary {
  commonCount: number
  fromCount: number
  toCount: number
  byteRecallFrom: number
}

export interface StableIdentityMatchResult {
  entries: RootMatchCollection
  dynamicEntries: RootMatchCollection
  sharedChunks: SharedChunkMatchCollection
  css: AssetMatchCollection
  assets: AssetMatchCollection
  modules: ModuleSummary
  summary: {
    moduleByteRecallFrom: number
    sharedChunkMatches: {
      matchedFromCount: number
    }
  }
}

interface AnnotatedChunk extends StableIdentityChunk {
  moduleWeights: Record<string, number>
}

interface EnvironmentAnalysis {
  chunks: AnnotatedChunk[]
  assets: StableIdentityAsset[]
  entries: AnnotatedChunk[]
  dynamicEntries: AnnotatedChunk[]
  sharedChunks: AnnotatedChunk[]
  cssAssets: StableIdentityAsset[]
  staticAssets: StableIdentityAsset[]
  chunkByFile: Map<string, AnnotatedChunk>
}

interface SharedChunkCandidate {
  from: string
  fromCoverage: number
  ownerScore: number
  score: number
  to: string
  toCoverage: number
}

interface SharedChunkMatchState {
  ambiguous: AmbiguousRelation[]
  ambiguousFrom: Set<string>
  ambiguousTo: Set<string>
  matchedFrom: Set<string>
  matchedTo: Set<string>
  merge: MergeRelation[]
  same: SameRelation[]
  split: SplitRelation[]
}

interface SharedChunkMatcherContext {
  byFrom: Map<string, SharedChunkCandidate[]>
  byTo: Map<string, SharedChunkCandidate[]>
  fromByFile: Map<string, AnnotatedChunk>
  fromChunks: AnnotatedChunk[]
  minimumLineageCoverage: number
  state: SharedChunkMatchState
  toByFile: Map<string, AnnotatedChunk>
  toChunks: AnnotatedChunk[]
}

export function matchEnvironmentPair(
  fromEnvironment: StableIdentityEnvironment,
  toEnvironment: StableIdentityEnvironment,
): StableIdentityMatchResult {
  const fromAnalysis = analyzeEnvironment(fromEnvironment)
  const toAnalysis = analyzeEnvironment(toEnvironment)

  const entries = matchRootChunks(fromAnalysis.entries, toAnalysis.entries)
  const dynamicEntries = matchRootChunks(fromAnalysis.dynamicEntries, toAnalysis.dynamicEntries)
  const sharedChunks = matchSharedChunks(fromAnalysis.sharedChunks, toAnalysis.sharedChunks)
  const chunkLineage = buildChunkLineage(entries, dynamicEntries, sharedChunks)
  const css = matchAssets(fromAnalysis.cssAssets, toAnalysis.cssAssets, chunkLineage)
  const assets = matchAssets(fromAnalysis.staticAssets, toAnalysis.staticAssets, chunkLineage)
  const modules = summarizeModules(fromAnalysis, toAnalysis)

  return {
    entries,
    dynamicEntries,
    sharedChunks,
    css,
    assets,
    modules,
    summary: {
      moduleByteRecallFrom: modules.byteRecallFrom,
      sharedChunkMatches: summarizeSharedChunks(sharedChunks),
    },
  }
}

function analyzeEnvironment(environment: StableIdentityEnvironment): EnvironmentAnalysis {
  const chunks = environment.chunks.map((chunk) => ({
    ...chunk,
    moduleWeights: Object.fromEntries(
      chunk.modules.map((moduleEntry) => [moduleEntry.stableId, moduleEntry.renderedLength]),
    ),
  }))
  const chunkByFile = new Map(chunks.map((chunk) => [chunk.fileName, chunk] as const))

  return {
    chunks,
    assets: environment.assets,
    entries: chunks.filter((chunk) => chunk.isEntry),
    dynamicEntries: chunks.filter((chunk) => chunk.isDynamicEntry),
    sharedChunks: chunks.filter((chunk) => !chunk.isEntry && !chunk.isDynamicEntry),
    cssAssets: environment.assets.filter((asset) => asset.kind === "css"),
    staticAssets: environment.assets.filter((asset) => asset.kind !== "css"),
    chunkByFile,
  }
}

function setIntersectionSize<T>(left: Set<T>, right: Set<T>) {
  let size = 0

  for (const value of left) {
    if (right.has(value)) {
      size += 1
    }
  }

  return size
}

function jaccard(leftValues: string[], rightValues: string[]) {
  const left = new Set(leftValues)
  const right = new Set(rightValues)
  const intersection = setIntersectionSize(left, right)
  const union = new Set([...left, ...right]).size
  return union === 0 ? 0 : intersection / union
}

function weightedIntersection(
  fromWeights: Record<string, number>,
  toWeights: Record<string, number>,
) {
  let total = 0

  for (const [stableId, fromSize] of Object.entries(fromWeights)) {
    const toSize = toWeights[stableId]
    if (toSize) {
      total += Math.min(fromSize, toSize)
    }
  }

  return total
}

function sizeRatio(left: number, right: number) {
  const maximum = Math.max(left, right, 1)
  return Math.min(left, right) / maximum
}

function weightedCoverage(
  sourceWeights: Record<string, number>,
  targetWeightsList: Array<Record<string, number>>,
) {
  let total = 0
  let covered = 0

  for (const [stableId, sourceSize] of Object.entries(sourceWeights)) {
    total += sourceSize
    let matchedSize = 0

    for (const targetWeights of targetWeightsList) {
      matchedSize = Math.max(matchedSize, targetWeights[stableId] ?? 0)
    }

    covered += Math.min(sourceSize, matchedSize)
  }

  return total === 0 ? 0 : covered / total
}

function getPrimaryIdentity(
  chunk: Pick<StableIdentityChunk, "manifestSourceKeys" | "facadeModule">,
) {
  return chunk.manifestSourceKeys[0] ?? chunk.facadeModule?.stableId ?? null
}

function matchRootChunks(
  fromChunks: AnnotatedChunk[],
  toChunks: AnnotatedChunk[],
): RootMatchCollection {
  const same: SameRelation[] = []
  const added: AddedRelation[] = []
  const removed: RemovedRelation[] = []

  const toByIdentity = new Map<string, AnnotatedChunk[]>()
  for (const chunk of toChunks) {
    const identity = getPrimaryIdentity(chunk)
    if (!identity) {
      continue
    }

    const candidates = toByIdentity.get(identity) ?? []
    candidates.push(chunk)
    toByIdentity.set(identity, candidates)
  }

  const matchedTo = new Set<string>()

  for (const fromChunk of fromChunks) {
    const identity = getPrimaryIdentity(fromChunk)
    const candidates = identity ? (toByIdentity.get(identity) ?? []) : []

    if (candidates.length === 1) {
      const toChunk = candidates[0]
      matchedTo.add(toChunk.fileName)
      same.push({
        relation: "same",
        from: fromChunk.fileName,
        to: toChunk.fileName,
        confidence: "exact",
        evidence: sortUnique(
          compactStrings([
            identity ? `identity:${identity}` : null,
            fromChunk.facadeModule?.stableId &&
            fromChunk.facadeModule.stableId === toChunk.facadeModule?.stableId
              ? `facade:${fromChunk.facadeModule.stableId}`
              : null,
          ]),
        ),
      })
      continue
    }

    removed.push({ relation: "removed", from: fromChunk.fileName })
  }

  for (const toChunk of toChunks) {
    if (!matchedTo.has(toChunk.fileName)) {
      added.push({ relation: "added", to: toChunk.fileName })
    }
  }

  return { same, added, removed }
}

function scoreSharedChunkCandidate(fromChunk: AnnotatedChunk, toChunk: AnnotatedChunk) {
  const overlap = weightedIntersection(fromChunk.moduleWeights, toChunk.moduleWeights)
  if (overlap === 0) {
    return null
  }

  const ownerScore = jaccard(fromChunk.ownerRoots, toChunk.ownerRoots)
  if (ownerScore === 0) {
    return null
  }

  const fromCoverage = overlap / Math.max(fromChunk.totalRenderedLength, 1)
  const toCoverage = overlap / Math.max(toChunk.totalRenderedLength, 1)
  const moduleScore =
    overlap / Math.max(fromChunk.totalRenderedLength, toChunk.totalRenderedLength, 1)

  return {
    from: fromChunk.fileName,
    to: toChunk.fileName,
    score: moduleScore * 0.8 + ownerScore * 0.2,
    ownerScore,
    fromCoverage,
    toCoverage,
  }
}

function classifyConfidence(candidate: {
  score: number
  fromCoverage: number
  toCoverage: number
}): RelationConfidence {
  if (candidate.score >= 0.9 && candidate.fromCoverage >= 0.95 && candidate.toCoverage >= 0.95) {
    return "exact"
  }

  if (candidate.score >= 0.75 && candidate.fromCoverage >= 0.7 && candidate.toCoverage >= 0.7) {
    return "strong"
  }

  return "low"
}

function scoreSharedChunkFallback(fromChunk: AnnotatedChunk, toChunk: AnnotatedChunk) {
  const ownerScore = jaccard(fromChunk.ownerRoots, toChunk.ownerRoots)
  const sameLabel = fromChunk.fileLabel === toChunk.fileLabel
  const similarSize = sizeRatio(fromChunk.totalRenderedLength, toChunk.totalRenderedLength)
  const similarModuleCount = sizeRatio(fromChunk.moduleIds.length, toChunk.moduleIds.length) >= 0.5

  if (!sameLabel || ownerScore < 0.5 || similarSize < 0.8 || !similarModuleCount) {
    return null
  }

  return {
    score: ownerScore * 0.55 + similarSize * 0.45,
    evidence: [
      `ownerScore:${ownerScore.toFixed(3)}`,
      `sizeRatio:${similarSize.toFixed(3)}`,
      `label:${fromChunk.fileLabel}`,
    ],
  }
}

function collectSharedChunkCandidates(
  fromChunks: AnnotatedChunk[],
  toChunks: AnnotatedChunk[],
): SharedChunkCandidate[] {
  const candidates: SharedChunkCandidate[] = []

  for (const fromChunk of fromChunks) {
    for (const toChunk of toChunks) {
      const candidate = scoreSharedChunkCandidate(fromChunk, toChunk)
      if (candidate) {
        candidates.push(candidate)
      }
    }
  }

  return candidates
}

function indexSharedChunkCandidates(candidates: SharedChunkCandidate[]) {
  const byFrom = new Map<string, SharedChunkCandidate[]>()
  const byTo = new Map<string, SharedChunkCandidate[]>()

  for (const candidate of candidates) {
    const fromCandidates = byFrom.get(candidate.from) ?? []
    fromCandidates.push(candidate)
    byFrom.set(candidate.from, fromCandidates)

    const toCandidates = byTo.get(candidate.to) ?? []
    toCandidates.push(candidate)
    byTo.set(candidate.to, toCandidates)
  }

  return { byFrom, byTo }
}

function createSharedChunkMatcherContext(
  fromChunks: AnnotatedChunk[],
  toChunks: AnnotatedChunk[],
): SharedChunkMatcherContext {
  const candidates = collectSharedChunkCandidates(fromChunks, toChunks)
  const { byFrom, byTo } = indexSharedChunkCandidates(candidates)

  return {
    byFrom,
    byTo,
    fromByFile: new Map(fromChunks.map((chunk) => [chunk.fileName, chunk] as const)),
    fromChunks,
    minimumLineageCoverage: 0.08,
    state: {
      ambiguous: [],
      ambiguousFrom: new Set<string>(),
      ambiguousTo: new Set<string>(),
      matchedFrom: new Set<string>(),
      matchedTo: new Set<string>(),
      merge: [],
      same: [],
      split: [],
    },
    toByFile: new Map(toChunks.map((chunk) => [chunk.fileName, chunk] as const)),
    toChunks,
  }
}

function matchSharedChunkSplits(context: SharedChunkMatcherContext) {
  const { byFrom, minimumLineageCoverage, state, toByFile } = context

  for (const fromChunk of context.fromChunks) {
    const ranked = (byFrom.get(fromChunk.fileName) ?? [])
      .filter((candidate) => candidate.fromCoverage >= minimumLineageCoverage)
      .sort((left, right) => right.fromCoverage - left.fromCoverage)

    if (ranked.length < 2) {
      continue
    }

    const selected: SharedChunkCandidate[] = []
    let coverage = 0

    for (const candidate of ranked) {
      if (state.matchedTo.has(candidate.to)) {
        continue
      }

      selected.push(candidate)
      const targetWeights = selected.map((entry) => toByFile.get(entry.to)?.moduleWeights ?? {})
      coverage = weightedCoverage(fromChunk.moduleWeights, targetWeights)

      if (coverage >= 0.95) {
        break
      }
    }

    if (selected.length >= 2 && coverage >= 0.95) {
      state.matchedFrom.add(fromChunk.fileName)
      for (const candidate of selected) {
        state.matchedTo.add(candidate.to)
      }

      state.split.push({
        relation: "split",
        from: fromChunk.fileName,
        to: selected.map((entry) => entry.to).sort((left, right) => left.localeCompare(right)),
        confidence: coverage >= 0.99 ? "strong" : "low",
        evidence: [`fromCoverage:${coverage.toFixed(3)}`],
      })
    }
  }
}

function matchSharedChunkMerges(context: SharedChunkMatcherContext) {
  const { byTo, fromByFile, minimumLineageCoverage, state } = context

  for (const toChunk of context.toChunks) {
    if (state.matchedTo.has(toChunk.fileName)) {
      continue
    }

    const ranked = (byTo.get(toChunk.fileName) ?? [])
      .filter((candidate) => candidate.toCoverage >= minimumLineageCoverage)
      .sort((left, right) => right.toCoverage - left.toCoverage)

    if (ranked.length < 2) {
      continue
    }

    const selected: SharedChunkCandidate[] = []
    let coverage = 0

    for (const candidate of ranked) {
      if (state.matchedFrom.has(candidate.from)) {
        continue
      }

      selected.push(candidate)
      const sourceWeights = selected.map(
        (entry) => fromByFile.get(entry.from)?.moduleWeights ?? {},
      )
      coverage = weightedCoverage(toChunk.moduleWeights, sourceWeights)

      if (coverage >= 0.95) {
        break
      }
    }

    if (selected.length >= 2 && coverage >= 0.95) {
      state.matchedTo.add(toChunk.fileName)
      for (const candidate of selected) {
        state.matchedFrom.add(candidate.from)
      }

      state.merge.push({
        relation: "merge",
        from: selected.map((entry) => entry.from).sort((left, right) => left.localeCompare(right)),
        to: toChunk.fileName,
        confidence: coverage >= 0.99 ? "strong" : "low",
        evidence: [`toCoverage:${coverage.toFixed(3)}`],
      })
    }
  }
}

function matchSharedChunkMutualBestSame(context: SharedChunkMatcherContext) {
  const { byFrom, byTo, state } = context

  for (const fromChunk of context.fromChunks) {
    if (state.matchedFrom.has(fromChunk.fileName)) {
      continue
    }

    const ranked = (byFrom.get(fromChunk.fileName) ?? [])
      .slice()
      .sort((left, right) => right.score - left.score)

    if (ranked.length === 0) {
      continue
    }

    const best = ranked[0]
    const toRanked = (byTo.get(best.to) ?? []).slice().sort((left, right) => right.score - left.score)
    const secondBest = ranked[1]
    const mutualBest = toRanked[0]?.from === fromChunk.fileName
    const clearlyBest = !secondBest || best.score - secondBest.score >= 0.15

    if (mutualBest && clearlyBest && best.score >= 0.75) {
      state.matchedFrom.add(best.from)
      state.matchedTo.add(best.to)
      state.same.push({
        relation: "same",
        from: best.from,
        to: best.to,
        confidence: classifyConfidence(best),
        evidence: [
          `moduleScore:${best.score.toFixed(3)}`,
          `ownerScore:${best.ownerScore.toFixed(3)}`,
          `fromCoverage:${best.fromCoverage.toFixed(3)}`,
          `toCoverage:${best.toCoverage.toFixed(3)}`,
        ],
      })
    }
  }
}

function matchSharedChunkAmbiguous(context: SharedChunkMatcherContext) {
  const { byFrom, state, toByFile } = context

  for (const fromChunk of context.fromChunks) {
    if (state.matchedFrom.has(fromChunk.fileName)) {
      continue
    }

    const ranked = (byFrom.get(fromChunk.fileName) ?? [])
      .filter((candidate) => !state.matchedTo.has(candidate.to))
      .sort((left, right) => right.score - left.score)

    if (ranked.length === 0) {
      continue
    }

    const plausible = ranked.filter(
      (candidate) => candidate.score >= 0.35 || candidate.fromCoverage >= 0.25,
    )

    if (plausible.length === 0) {
      continue
    }

    const best = plausible[0]
    const second = plausible[1] ?? null
    const selected = plausible.slice(0, 2)
    const combinedCoverage = weightedCoverage(
      fromChunk.moduleWeights,
      selected.map((candidate) => toByFile.get(candidate.to)?.moduleWeights ?? {}),
    )
    const closeRunnerUp = second ? best.score - second.score < 0.15 : false
    const lowConfidenceBest = best.score < 0.75 && best.fromCoverage >= 0.25
    const underExplained = combinedCoverage >= 0.5 && combinedCoverage < 0.95

    if (!(underExplained && (closeRunnerUp || lowConfidenceBest))) {
      continue
    }

    state.ambiguous.push({
      relation: "ambiguous",
      from: fromChunk.fileName,
      to: selected.map((candidate) => candidate.to).sort((left, right) => left.localeCompare(right)),
      confidence: "low",
      evidence: compactStrings([
        `bestScore:${best.score.toFixed(3)}`,
        `bestFromCoverage:${best.fromCoverage.toFixed(3)}`,
        second ? `runnerUpScore:${second.score.toFixed(3)}` : null,
        `combinedCoverage:${combinedCoverage.toFixed(3)}`,
      ]),
    })
    state.ambiguousFrom.add(fromChunk.fileName)
    for (const candidate of selected) {
      state.ambiguousTo.add(candidate.to)
    }
  }
}

function matchSharedChunkFallbackSame(context: SharedChunkMatcherContext) {
  const { fromChunks, state, toChunks } = context

  for (const fromChunk of fromChunks) {
    if (state.matchedFrom.has(fromChunk.fileName) || state.ambiguousFrom.has(fromChunk.fileName)) {
      continue
    }

    const fallbackCandidates = toChunks
      .filter((chunk) => !state.matchedTo.has(chunk.fileName) && !state.ambiguousTo.has(chunk.fileName))
      .map((chunk) => ({ chunk, score: scoreSharedChunkFallback(fromChunk, chunk) }))
      .filter((entry) => entry.score)
      .sort((left, right) => right.score!.score - left.score!.score)

    if (fallbackCandidates.length !== 1) {
      continue
    }

    const target = fallbackCandidates[0]
    const reverseCandidates = fromChunks
      .filter(
        (chunk) => !state.matchedFrom.has(chunk.fileName) && !state.ambiguousFrom.has(chunk.fileName),
      )
      .map((chunk) => ({ chunk, score: scoreSharedChunkFallback(chunk, target.chunk) }))
      .filter((entry) => entry.score)
      .sort((left, right) => right.score!.score - left.score!.score)

    if (
      reverseCandidates.length !== 1 ||
      reverseCandidates[0].chunk.fileName !== fromChunk.fileName
    ) {
      continue
    }

    state.matchedFrom.add(fromChunk.fileName)
    state.matchedTo.add(target.chunk.fileName)
    state.same.push({
      relation: "same",
      from: fromChunk.fileName,
      to: target.chunk.fileName,
      confidence: "low",
      evidence: target.score!.evidence,
    })
  }
}

function finalizeSharedChunkAddedRemoved(context: SharedChunkMatcherContext) {
  const added: AddedRelation[] = []
  const removed: RemovedRelation[] = []

  for (const chunk of context.fromChunks) {
    if (!context.state.matchedFrom.has(chunk.fileName) && !context.state.ambiguousFrom.has(chunk.fileName)) {
      removed.push({ relation: "removed", from: chunk.fileName })
    }
  }

  for (const chunk of context.toChunks) {
    if (!context.state.matchedTo.has(chunk.fileName) && !context.state.ambiguousTo.has(chunk.fileName)) {
      added.push({ relation: "added", to: chunk.fileName })
    }
  }

  return { added, removed }
}

function matchSharedChunks(
  fromChunks: AnnotatedChunk[],
  toChunks: AnnotatedChunk[],
): SharedChunkMatchCollection {
  const context = createSharedChunkMatcherContext(fromChunks, toChunks)

  matchSharedChunkSplits(context)
  matchSharedChunkMerges(context)
  matchSharedChunkMutualBestSame(context)
  matchSharedChunkAmbiguous(context)
  matchSharedChunkFallbackSame(context)

  const { added, removed } = finalizeSharedChunkAddedRemoved(context)

  return {
    same: context.state.same,
    split: context.state.split,
    merge: context.state.merge,
    ambiguous: context.state.ambiguous,
    added,
    removed,
  }
}

function exactAssetKeyMatches(fromAssets: StableIdentityAsset[], toAssets: StableIdentityAsset[]) {
  const toByKey = new Map<string, StableIdentityAsset[]>()

  for (const asset of toAssets) {
    for (const key of asset.sourceKeys) {
      const candidates = toByKey.get(key) ?? []
      candidates.push(asset)
      toByKey.set(key, candidates)
    }
  }

  const same: SameRelation[] = []
  const matchedFrom = new Set<string>()
  const matchedTo = new Set<string>()

  for (const asset of fromAssets) {
    const exactCandidates = sortUnique(asset.sourceKeys)
      .flatMap((key) => toByKey.get(key) ?? [])
      .filter((candidate, index, allCandidates) => allCandidates.indexOf(candidate) === index)

    if (exactCandidates.length === 1) {
      const target = exactCandidates[0]
      matchedFrom.add(asset.fileName)
      matchedTo.add(target.fileName)
      same.push({
        relation: "same",
        from: asset.fileName,
        to: target.fileName,
        confidence: "exact",
        evidence: [`source:${asset.sourceKeys.find((key) => target.sourceKeys.includes(key))}`],
      })
    }
  }

  return { same, matchedFrom, matchedTo }
}

function addLineage(map: Map<string, string[]>, key: string, values: string[]) {
  const currentValues = map.get(key) ?? []
  map.set(key, sortUnique([...currentValues, ...values]))
}

function buildChunkLineage(
  entries: RootMatchCollection,
  dynamicEntries: RootMatchCollection,
  sharedChunks: SharedChunkMatchCollection,
) {
  const fromTo = new Map<string, string[]>()
  const toFrom = new Map<string, string[]>()

  for (const relation of [...entries.same, ...dynamicEntries.same, ...sharedChunks.same]) {
    addLineage(fromTo, relation.from, [relation.to])
    addLineage(toFrom, relation.to, [relation.from])
  }

  for (const relation of sharedChunks.split) {
    addLineage(fromTo, relation.from, relation.to)
    for (const target of relation.to) {
      addLineage(toFrom, target, [relation.from])
    }
  }

  for (const relation of sharedChunks.merge) {
    for (const source of relation.from) {
      addLineage(fromTo, source, [relation.to])
    }
    addLineage(toFrom, relation.to, relation.from)
  }

  return { fromTo, toFrom }
}

function getLineageTargets(importerFiles: string[], lineageMap: Map<string, string[]>) {
  const targets = []
  for (const fileName of importerFiles) {
    targets.push(...(lineageMap.get(fileName) ?? []))
  }

  return sortUnique(targets)
}

function lineageCoverage(expectedFiles: string[], actualFiles: string[]) {
  if (expectedFiles.length === 0) {
    return 0
  }

  const expected = new Set(expectedFiles)
  const actual = new Set(actualFiles)
  return setIntersectionSize(expected, actual) / expected.size
}

function scoreAssetFallback(
  fromAsset: StableIdentityAsset,
  toAsset: StableIdentityAsset,
  chunkLineage: ReturnType<typeof buildChunkLineage>,
) {
  const ownerScore = jaccard(fromAsset.ownerRoots, toAsset.ownerRoots)
  const importerKeyScore = jaccard(fromAsset.importerKeys, toAsset.importerKeys)
  const sourceKeyScore = jaccard(fromAsset.sourceKeys, toAsset.sourceKeys)
  const sameLabel = fromAsset.fileLabel === toAsset.fileLabel
  const sameKind = fromAsset.kind === toAsset.kind
  const similarSize = sizeRatio(fromAsset.sizes.raw, toAsset.sizes.raw)
  const predictedTargets = getLineageTargets(fromAsset.importerFiles, chunkLineage.fromTo)
  const predictedSources = getLineageTargets(toAsset.importerFiles, chunkLineage.toFrom)
  const importerCoverage = lineageCoverage(predictedTargets, toAsset.importerFiles)
  const reverseCoverage = lineageCoverage(predictedSources, fromAsset.importerFiles)

  if (!sameKind) {
    return null
  }

  const score =
    importerCoverage * 0.45 +
    reverseCoverage * 0.25 +
    ownerScore * 0.15 +
    importerKeyScore * 0.1 +
    sourceKeyScore * 0.05 +
    (sameLabel ? 0.05 : 0)
  const enoughEvidence =
    sourceKeyScore === 1 ||
    importerCoverage >= 0.5 ||
    reverseCoverage >= 0.5 ||
    (ownerScore === 1 && importerKeyScore > 0) ||
    (ownerScore === 1 && sameLabel && similarSize >= 0.95)

  if (!enoughEvidence || score < 0.55) {
    if (!(sameLabel && similarSize >= 0.95 && ownerScore >= 0.5)) {
      return null
    }
  }

  return {
    score: Math.max(score, sameLabel && similarSize >= 0.95 && ownerScore >= 0.5 ? 0.72 : score),
    predictedTargets,
    predictedSources,
    importerCoverage,
    reverseCoverage,
    evidence: compactStrings([
      importerCoverage ? `importerCoverage:${importerCoverage.toFixed(3)}` : null,
      reverseCoverage ? `reverseCoverage:${reverseCoverage.toFixed(3)}` : null,
      `ownerScore:${ownerScore.toFixed(3)}`,
      `importerScore:${importerKeyScore.toFixed(3)}`,
      `sizeRatio:${similarSize.toFixed(3)}`,
      sourceKeyScore ? `sourceScore:${sourceKeyScore.toFixed(3)}` : null,
      sameLabel ? `label:${fromAsset.fileLabel}` : null,
    ]),
  }
}

function matchAssets(
  fromAssets: StableIdentityAsset[],
  toAssets: StableIdentityAsset[],
  chunkLineage: ReturnType<typeof buildChunkLineage>,
): AssetMatchCollection {
  const { same, matchedFrom, matchedTo } = exactAssetKeyMatches(fromAssets, toAssets)
  const split: SplitRelation[] = []
  const merge: MergeRelation[] = []

  for (const fromAsset of fromAssets) {
    if (matchedFrom.has(fromAsset.fileName)) {
      continue
    }

    const predictedTargets = getLineageTargets(fromAsset.importerFiles, chunkLineage.fromTo)
    if (predictedTargets.length < 2) {
      continue
    }

    const candidates = toAssets
      .filter((asset) => !matchedTo.has(asset.fileName) && asset.kind === fromAsset.kind)
      .map((asset) => ({ asset, score: scoreAssetFallback(fromAsset, asset, chunkLineage) }))
      .filter((entry) => entry.score)
      .sort((left, right) => right.score!.importerCoverage - left.score!.importerCoverage)

    const selected = []
    let coveredTargets: string[] = []

    for (const candidate of candidates) {
      selected.push(candidate)
      coveredTargets = sortUnique(
        selected.flatMap((entry) =>
          entry.asset.importerFiles.filter((fileName) => predictedTargets.includes(fileName)),
        ),
      )

      if (coveredTargets.length === predictedTargets.length) {
        break
      }
    }

    if (selected.length >= 2 && coveredTargets.length === predictedTargets.length) {
      matchedFrom.add(fromAsset.fileName)
      for (const candidate of selected) {
        matchedTo.add(candidate.asset.fileName)
      }

      split.push({
        relation: "split",
        from: fromAsset.fileName,
        to: selected
          .map((entry) => entry.asset.fileName)
          .sort((left, right) => left.localeCompare(right)),
        confidence: "strong",
        evidence: ["importerCoverage:1.000"],
      })
    }
  }

  for (const toAsset of toAssets) {
    if (matchedTo.has(toAsset.fileName)) {
      continue
    }

    const predictedSources = getLineageTargets(toAsset.importerFiles, chunkLineage.toFrom)
    if (predictedSources.length < 2) {
      continue
    }

    const candidates = fromAssets
      .filter((asset) => !matchedFrom.has(asset.fileName) && asset.kind === toAsset.kind)
      .map((asset) => ({ asset, score: scoreAssetFallback(asset, toAsset, chunkLineage) }))
      .filter((entry) => entry.score)
      .sort((left, right) => right.score!.reverseCoverage - left.score!.reverseCoverage)

    const selected = []
    let coveredSources: string[] = []

    for (const candidate of candidates) {
      selected.push(candidate)
      coveredSources = sortUnique(
        selected.flatMap((entry) =>
          entry.asset.importerFiles.filter((fileName) => predictedSources.includes(fileName)),
        ),
      )

      if (coveredSources.length === predictedSources.length) {
        break
      }
    }

    if (selected.length >= 2 && coveredSources.length === predictedSources.length) {
      matchedTo.add(toAsset.fileName)
      for (const candidate of selected) {
        matchedFrom.add(candidate.asset.fileName)
      }

      merge.push({
        relation: "merge",
        from: selected
          .map((entry) => entry.asset.fileName)
          .sort((left, right) => left.localeCompare(right)),
        to: toAsset.fileName,
        confidence: "strong",
        evidence: ["reverseCoverage:1.000"],
      })
    }
  }

  for (const fromAsset of fromAssets) {
    if (matchedFrom.has(fromAsset.fileName)) {
      continue
    }

    const candidates = toAssets
      .filter((asset) => !matchedTo.has(asset.fileName))
      .map((asset) => ({ asset, score: scoreAssetFallback(fromAsset, asset, chunkLineage) }))
      .filter((entry) => entry.score)
      .sort((left, right) => right.score!.score - left.score!.score)

    const best = candidates[0]
    const second = candidates[1]
    const predictedTargets = best?.score?.predictedTargets ?? []
    const predictedSources = best?.score?.predictedSources ?? []
    const multiLineage = predictedTargets.length > 1 || predictedSources.length > 1

    if (candidates.length === 1 && best && !multiLineage) {
      matchedFrom.add(fromAsset.fileName)
      matchedTo.add(best.asset.fileName)
      same.push({
        relation: "same",
        from: fromAsset.fileName,
        to: best.asset.fileName,
        confidence: "strong",
        evidence: best.score!.evidence,
      })
      continue
    }

    if (
      best &&
      !multiLineage &&
      (!second || best.score!.score - second.score!.score >= 0.2) &&
      best.score!.score >= 0.7
    ) {
      matchedFrom.add(fromAsset.fileName)
      matchedTo.add(best.asset.fileName)
      same.push({
        relation: "same",
        from: fromAsset.fileName,
        to: best.asset.fileName,
        confidence: best.score!.score >= 0.9 ? "exact" : "strong",
        evidence: best.score!.evidence,
      })
    }
  }

  const removed = fromAssets
    .filter((asset) => !matchedFrom.has(asset.fileName))
    .map<RemovedRelation>((asset) => ({ relation: "removed", from: asset.fileName }))
  const added = toAssets
    .filter((asset) => !matchedTo.has(asset.fileName))
    .map<AddedRelation>((asset) => ({ relation: "added", to: asset.fileName }))

  return { same, split, merge, removed, added }
}

function summarizeModules(
  fromAnalysis: EnvironmentAnalysis,
  toAnalysis: EnvironmentAnalysis,
): ModuleSummary {
  const fromModules = new Map<string, number>()
  const toModules = new Map<string, number>()

  for (const chunk of fromAnalysis.chunks) {
    for (const moduleEntry of chunk.modules) {
      fromModules.set(
        moduleEntry.stableId,
        Math.max(fromModules.get(moduleEntry.stableId) ?? 0, moduleEntry.renderedLength),
      )
    }
  }

  for (const chunk of toAnalysis.chunks) {
    for (const moduleEntry of chunk.modules) {
      toModules.set(
        moduleEntry.stableId,
        Math.max(toModules.get(moduleEntry.stableId) ?? 0, moduleEntry.renderedLength),
      )
    }
  }

  const commonIds = [...fromModules.keys()].filter((stableId) => toModules.has(stableId))
  const commonBytes = commonIds.reduce(
    (total, stableId) => total + Math.min(fromModules.get(stableId)!, toModules.get(stableId)!),
    0,
  )
  const fromBytes = [...fromModules.values()].reduce((total, value) => total + value, 0)

  return {
    commonCount: commonIds.length,
    fromCount: fromModules.size,
    toCount: toModules.size,
    byteRecallFrom: fromBytes === 0 ? 0 : commonBytes / fromBytes,
  }
}

function summarizeSharedChunks(sharedChunks: SharedChunkMatchCollection) {
  const matchedFrom = new Set([
    ...sharedChunks.same.map((entry) => entry.from),
    ...sharedChunks.split.map((entry) => entry.from),
    ...sharedChunks.merge.flatMap((entry) => entry.from),
  ])

  return {
    matchedFromCount: matchedFrom.size,
  }
}

function sortUnique<T>(values: Iterable<T>) {
  return [...new Set(values)].sort((left, right) => String(left).localeCompare(String(right)))
}

function compactStrings(values: Array<string | null | undefined>) {
  return values.filter((value): value is string => Boolean(value))
}
