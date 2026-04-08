import fs from "node:fs/promises"
import path from "node:path"
import { matchSnapshotPair } from "./match-snapshots.mjs"
import { deriveTreemapPair } from "./treemap-pair.mjs"
import { readJson } from "./utils.mjs"

const repoRoot = path.resolve(new URL("../../..", import.meta.url).pathname)
const expectationsRoot = path.join(repoRoot, "research", "stable-identity", "expectations")

function resolveAgainstExpectations(fileName) {
  return path.join(expectationsRoot, fileName)
}

function loadActualPairs(result, collectionName) {
  const collection = result[collectionName]
  return [
    ...(collection.same ?? []),
    ...(collection.split ?? []),
    ...(collection.merge ?? []),
    ...(collection.ambiguous ?? []),
    ...(collection.added ?? []),
    ...(collection.removed ?? []),
  ]
}

function compareIds(left, right) {
  if (Array.isArray(left) && Array.isArray(right)) {
    return JSON.stringify([...left].sort()) === JSON.stringify([...right].sort())
  }

  return left === right
}

function expectationSatisfied(result, collectionName, expectation) {
  const actualPairs = loadActualPairs(result, collectionName)
  return actualPairs.some((candidate) => {
    if (candidate.relation !== expectation.kind) {
      return false
    }

    return compareIds(candidate.from, expectation.from) && compareIds(candidate.to, expectation.to)
  })
}

function contradictorySame(result, collectionName, expectation) {
  if (expectation.kind === "same") {
    return false
  }

  return (result[collectionName].same ?? []).some((candidate) => {
    if (Array.isArray(expectation.from)) {
      return expectation.from.includes(candidate.from) || expectation.from.includes(candidate.to)
    }

    return candidate.from === expectation.from || candidate.to === expectation.from
  })
}

function printCollectionSummary(name, collection) {
  const same = collection.same?.length ?? 0
  const split = collection.split?.length ?? 0
  const merge = collection.merge?.length ?? 0
  const ambiguous = collection.ambiguous?.length ?? 0
  const added = collection.added?.length ?? 0
  const removed = collection.removed?.length ?? 0
  console.log(
    `  ${name}: same=${same} split=${split} merge=${merge} ambiguous=${ambiguous} added=${added} removed=${removed}`,
  )
}

function treemapNodeMatches(candidate, expectation) {
  if (expectation.stableKey && candidate.stableKey !== expectation.stableKey) {
    return false
  }

  if (expectation.stableKeyPrefix && !candidate.stableKey.startsWith(expectation.stableKeyPrefix)) {
    return false
  }

  if (expectation.relation && candidate.relation !== expectation.relation) {
    return false
  }

  if (expectation.from && !compareIds(candidate.from, expectation.from)) {
    return false
  }

  if (expectation.to && !compareIds(candidate.to, expectation.to)) {
    return false
  }

  return true
}

function checkTreemapExpectations(treemap, expectations) {
  let failed = false

  for (const [collectionName, collectionExpectations] of Object.entries(expectations)) {
    const collection = treemap[collectionName] ?? []
    for (const expectedNode of collectionExpectations) {
      const matched = collection.some((candidate) => treemapNodeMatches(candidate, expectedNode))
      if (matched) {
        continue
      }

      failed = true
      console.error(`  FAIL treemap ${collectionName} expected ${JSON.stringify(expectedNode)}`)
    }
  }

  return !failed
}

export async function runExpectations() {
  const expectationFiles = (await fs.readdir(expectationsRoot))
    .filter((fileName) => fileName.endsWith(".json"))
    .sort((left, right) => left.localeCompare(right))

  let failed = false

  for (const fileName of expectationFiles) {
    const expectation = await readJson(path.join(expectationsRoot, fileName))
    const fromSnapshot = await readJson(resolveAgainstExpectations(expectation.from))
    const toSnapshot = await readJson(resolveAgainstExpectations(expectation.to))
    const result = matchSnapshotPair(fromSnapshot, toSnapshot)
    const treemap = expectation.treemap ? deriveTreemapPair(fromSnapshot, toSnapshot) : null

    console.log(`\n== ${expectation.id}`)
    printCollectionSummary("entries", result.entries)
    printCollectionSummary("dynamicEntries", result.dynamicEntries)
    printCollectionSummary("sharedChunks", result.sharedChunks)
    printCollectionSummary("css", result.css)
    printCollectionSummary("assets", result.assets)
    console.log(
      `  modules: common=${result.modules.commonCount}/${result.modules.fromCount} byteRecall=${result.modules.byteRecallFrom.toFixed(3)}`,
    )

    for (const [collectionName, expectations] of Object.entries(expectation.expect)) {
      for (const expectedRelation of expectations) {
        const satisfied = expectationSatisfied(result, collectionName, expectedRelation)
        const hasContradiction = contradictorySame(result, collectionName, expectedRelation)
        if (satisfied && !hasContradiction) {
          continue
        }

        failed = true
        console.error(
          `  FAIL ${collectionName} expected ${expectedRelation.kind} ${JSON.stringify(expectedRelation)}`,
        )
      }
    }

    if (treemap && !checkTreemapExpectations(treemap, expectation.treemap)) {
      failed = true
    }
  }

  if (failed) {
    process.exitCode = 1
    return false
  }

  console.log("\nStable identity expectations passed.")
  return true
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await runExpectations()
}
