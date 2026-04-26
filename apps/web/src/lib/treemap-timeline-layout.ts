import * as d3 from "d3"

export type TimelineLayoutNode = {
  id: string
  parentId: string | null
  label: string
  kind: string
  value: number
  state?: string
  identity?: string
}

export type TimelineNodeState = "stable" | "added" | "removed" | "split" | "merged" | "moved"

export type TimelineTreemapNode = TimelineLayoutNode & {
  identity: string
  labelHeight?: number
  labelWidth?: number
  parentIdentity: string | null
  timelineState: TimelineNodeState
  transitionId: string
  values: number[]
}

export type TimelineRectNode = d3.HierarchyRectangularNode<TimelineTreemapNode>

export type RectSnapshot = { height: number; width: number; x: number; y: number }

const parentHeaderHeight = 18

export type TimelineTreemapLayout = {
  bounds: RectSnapshot
  internalNodes: TimelineRectNode[]
  leaves: TimelineRectNode[]
  maxFrameValue: number
  parentIds: Set<string>
  rects: Map<string, RectSnapshot>
}

export function buildContinuityTreemapLayout(input: {
  anchorNodes: TimelineLayoutNode[]
  frameCount: number
  frameIndex: number
  frameNodes: TimelineLayoutNode[]
  height: number
  maxFrameValue?: number
  previousNodes?: TimelineLayoutNode[]
  width: number
}): TimelineTreemapLayout {
  const parentIds = new Set(input.frameNodes.flatMap((node) => node.parentId ? [node.parentId] : []))
  const currentNodes = input.frameNodes.filter((node) => node.value > 0 || node.parentId === null || parentIds.has(node.id))
  const anchorOrder = buildOrder(input.anchorNodes)
  const previousOrder = buildOrder(input.previousNodes ?? [])
  const classifications = classifyTimelineNodes(currentNodes, input.previousNodes ?? [])
  const transitionIds = buildTransitionIds(currentNodes, input.previousNodes ?? [], input.anchorNodes)
  const maxFrameValue = Math.max(1, input.maxFrameValue ?? totalRootValue(currentNodes))
  const currentById = new Map(currentNodes.map((node) => [node.id, node]))
  const canonicalNodes = buildCanonicalNodes({
    anchorNodes: input.anchorNodes,
    currentNodes,
    previousNodes: input.previousNodes ?? [],
  })
  const nodes = canonicalNodes.map((node) => {
    const identity = stableNodeIdentity(node)
    const values = Array.from({ length: input.frameCount }, () => 0)
    values[input.frameIndex] = currentById.get(node.id)?.value ?? 0

    return {
      ...node,
      identity,
      parentIdentity: node.parentId ? stableNodeIdentityById(currentNodes, node.parentId) : null,
      timelineState: classifications.get(identity) ?? (currentById.has(node.id) ? "stable" : "removed"),
      transitionId: transitionIds.get(node.id) ?? node.id,
      values,
    }
  }).sort((left, right) => compareByContinuity(left, right, input.frameIndex, anchorOrder, previousOrder))

  const root = d3
    .stratify<TimelineTreemapNode>()
    .id((node) => node.id)
    .parentId((node) => node.parentId)(nodes)
    .sort((left, right) => compareByContinuity(left.data, right.data, input.frameIndex, anchorOrder, previousOrder))

  const currentTotal = totalRootValue(currentNodes)
  const scale = Math.sqrt(Math.min(1, currentTotal / maxFrameValue))
  const offsetX = (1 - scale) / 2 * input.width
  const offsetY = (1 - scale) / 2 * input.height
  const anchorValues = new Map(input.anchorNodes.map((node) => [node.id, node.value]))
  const treemap = d3
    .treemap<TimelineTreemapNode>()
    .tile(d3.treemapResquarify)
    .size([input.width * scale, input.height * scale])
    .paddingInner(1)
    .paddingOuter(1)
    .paddingTop((node) => node.depth > 0 && node.children ? parentHeaderHeight : 1)

  // Seed resquarify with the anchor values, then compute the current frame on the same hierarchy.
  treemap(root.sum((node) => anchorValues.get(node.id) ?? 0).sort((left, right) => compareByContinuity(left.data, right.data, input.frameIndex, anchorOrder, previousOrder)))
  const anchorRects = new Map<string, RectSnapshot>()
  for (const node of (root as TimelineRectNode).descendants()) {
    anchorRects.set(node.data.identity, rectSnapshot(node))
  }
  treemap(root.sum((node) => node.values[input.frameIndex] ?? 0).sort((left, right) => compareByContinuity(left.data, right.data, input.frameIndex, anchorOrder, previousOrder)))
  const rectangularRoot = root as TimelineRectNode
  rectangularRoot.each((node) => {
    node.x0 += offsetX
    node.x1 += offsetX
    node.y0 += offsetY
    node.y1 += offsetY
    const anchorRect = anchorRects.get(node.data.identity)
    if (anchorRect) {
      node.data.labelWidth = Math.max(0, anchorRect.width)
      node.data.labelHeight = Math.max(0, anchorRect.height)
    }
  })

  const internalNodes = rectangularRoot.descendants().filter((node) => node.depth > 0 && parentIds.has(node.id ?? ""))
  const leaves = rectangularRoot.leaves().filter((node) => (node.data.values[input.frameIndex] ?? 0) > 0)
  const rects = new Map<string, RectSnapshot>()
  for (const node of [...internalNodes, ...leaves]) {
    rects.set(node.data.transitionId, rectSnapshot(node))
  }

  return { bounds: layoutBounds([...internalNodes, ...leaves]), internalNodes, leaves, maxFrameValue, parentIds, rects }
}

function layoutBounds(nodes: TimelineRectNode[]): RectSnapshot {
  if (nodes.length === 0) return { height: 0, width: 0, x: 0, y: 0 }

  const x0 = Math.min(...nodes.map((node) => node.x0))
  const y0 = Math.min(...nodes.map((node) => node.y0))
  const x1 = Math.max(...nodes.map((node) => node.x1))
  const y1 = Math.max(...nodes.map((node) => node.y1))
  return { height: Math.max(0, y1 - y0), width: Math.max(0, x1 - x0), x: x0, y: y0 }
}

function buildCanonicalNodes(input: {
  anchorNodes: TimelineLayoutNode[]
  currentNodes: TimelineLayoutNode[]
  previousNodes: TimelineLayoutNode[]
}) {
  const byId = new Map<string, TimelineLayoutNode>()
  for (const node of [...input.anchorNodes, ...input.previousNodes, ...input.currentNodes]) {
    byId.set(node.id, node)
  }

  const currentById = new Map(input.currentNodes.map((node) => [node.id, node]))
  const previousById = new Map(input.previousNodes.map((node) => [node.id, node]))
  const anchorById = new Map(input.anchorNodes.map((node) => [node.id, node]))
  return [...byId.keys()].map((id) => currentById.get(id) ?? previousById.get(id) ?? anchorById.get(id)!)
}

export function classifyTimelineNodes(currentNodes: TimelineLayoutNode[], previousNodes: TimelineLayoutNode[]) {
  if (previousNodes.length === 0) {
    return new Map(currentNodes.map((node) => [stableNodeIdentity(node), "stable" as const]))
  }

  const currentByIdentity = groupByIdentity(currentNodes)
  const previousByIdentity = groupByIdentity(previousNodes)
  const currentParentByModule = moduleParentIdentities(currentNodes)
  const previousParentByModule = moduleParentIdentities(previousNodes)
  const previousToCurrentParents = new Map<string, Set<string>>()
  const currentToPreviousParents = new Map<string, Set<string>>()

  for (const [moduleIdentity, currentParent] of currentParentByModule) {
    const previousParent = previousParentByModule.get(moduleIdentity)
    if (!previousParent || !currentParent) continue

    mapSet(previousToCurrentParents, previousParent).add(currentParent)
    mapSet(currentToPreviousParents, currentParent).add(previousParent)
  }

  const states = new Map<string, TimelineNodeState>()

  for (const node of currentNodes) {
    const identity = stableNodeIdentity(node)
    if (!previousByIdentity.has(identity)) {
      states.set(identity, "added")
      continue
    }

    const currentParent = node.parentId ? stableNodeIdentityById(currentNodes, node.parentId) : null
    const previousParent = previousNodes.find((previousNode) => stableNodeIdentity(previousNode) === identity)?.parentId
    const previousParentIdentity = previousParent ? stableNodeIdentityById(previousNodes, previousParent) : null

    states.set(identity, currentParent !== previousParentIdentity ? "moved" : "stable")
  }

  for (const node of currentNodes.filter((node) => node.kind === "chunk")) {
    const identity = stableNodeIdentity(node)
    const previousParents = currentToPreviousParents.get(identity)
    if (previousParents && previousParents.size > 1) {
      states.set(identity, "merged")
      continue
    }

    const splitFromPrevious = [...(previousParents ?? [])].some((previousParent) => (previousToCurrentParents.get(previousParent)?.size ?? 0) > 1)
    if (splitFromPrevious) states.set(identity, "split")
  }

  for (const identity of previousByIdentity.keys()) {
    if (!currentByIdentity.has(identity)) states.set(identity, "removed")
  }

  return states
}

export function rectSnapshot(node: TimelineRectNode): RectSnapshot {
  return {
    height: Math.max(0, node.y1 - node.y0),
    width: Math.max(0, node.x1 - node.x0),
    x: node.x0,
    y: node.y0,
  }
}

export function stableNodeIdentity(node: TimelineLayoutNode) {
  return node.identity ?? node.id
}

function compareByContinuity(
  left: TimelineTreemapNode,
  right: TimelineTreemapNode,
  frameIndex: number,
  anchorOrder: Map<string, string>,
  previousOrder: Map<string, string>,
) {
  const leftAnchor = anchorOrder.get(left.identity)
  const rightAnchor = anchorOrder.get(right.identity)
  if (leftAnchor && rightAnchor) return leftAnchor.localeCompare(rightAnchor)
  if (leftAnchor) return -1
  if (rightAnchor) return 1

  const leftPrevious = previousOrder.get(left.identity)
  const rightPrevious = previousOrder.get(right.identity)
  if (leftPrevious && rightPrevious) return leftPrevious.localeCompare(rightPrevious)
  if (leftPrevious) return -1
  if (rightPrevious) return 1

  const parentCompare = (left.parentIdentity ?? "").localeCompare(right.parentIdentity ?? "")
  if (parentCompare !== 0) return parentCompare

  const kindCompare = left.kind.localeCompare(right.kind)
  if (kindCompare !== 0) return kindCompare

  const identityCompare = left.identity.localeCompare(right.identity)
  if (identityCompare !== 0) return identityCompare

  const valueCompare = (right.values[frameIndex] ?? 0) - (left.values[frameIndex] ?? 0)
  if (valueCompare !== 0) return valueCompare

  return left.id.localeCompare(right.id)
}

function buildOrder(nodes: TimelineLayoutNode[]) {
  const children = new Map<string, TimelineLayoutNode[]>()
  for (const node of nodes) {
    childrenFor(children, node.parentId ?? "").push(node)
  }

  for (const siblings of children.values()) {
    siblings.sort((left, right) => {
      const kindCompare = left.kind.localeCompare(right.kind)
      if (kindCompare !== 0) return kindCompare

      const identityCompare = stableNodeIdentity(left).localeCompare(stableNodeIdentity(right))
      if (identityCompare !== 0) return identityCompare

      return left.id.localeCompare(right.id)
    })
  }

  const order = new Map<string, string>()
  const visit = (parentId: string, prefix: string) => {
    const siblings = children.get(parentId) ?? []
    siblings.forEach((node, index) => {
      const key = `${prefix}${index.toString().padStart(5, "0")}`
      order.set(stableNodeIdentity(node), key)
      visit(node.id, `${key}.`)
    })
  }

  visit("", "")
  return order
}

function totalRootValue(nodes: TimelineLayoutNode[]) {
  const root = nodes.find((node) => node.parentId === null)
  if (!root) return nodes.reduce((total, node) => total + Math.max(0, node.value), 0)

  return nodes
    .filter((node) => node.parentId === root.id)
    .reduce((total, node) => total + Math.max(0, node.value), 0)
}

function buildTransitionIds(currentNodes: TimelineLayoutNode[], previousNodes: TimelineLayoutNode[], anchorNodes: TimelineLayoutNode[]) {
  const currentCounts = identityCounts(currentNodes)
  const previousCounts = identityCounts(previousNodes)
  const anchorCounts = identityCounts(anchorNodes)

  return new Map(currentNodes.map((node) => {
    const identity = stableNodeIdentity(node)
    const isUniqueIdentity = (currentCounts.get(identity) ?? 0) <= 1 &&
      (previousCounts.get(identity) ?? 0) <= 1 &&
      (anchorCounts.get(identity) ?? 0) <= 1
    return [node.id, isUniqueIdentity ? identity : node.id]
  }))
}

function identityCounts(nodes: TimelineLayoutNode[]) {
  const counts = new Map<string, number>()
  for (const node of nodes) counts.set(stableNodeIdentity(node), (counts.get(stableNodeIdentity(node)) ?? 0) + 1)
  return counts
}

function moduleParentIdentities(nodes: TimelineLayoutNode[]) {
  const parentById = new Map(nodes.map((node) => [node.id, stableNodeIdentity(node)]))
  const result = new Map<string, string>()
  for (const node of nodes) {
    if (!node.id.startsWith("module:") || !node.parentId) continue
    result.set(stableNodeIdentity(node), parentById.get(node.parentId) ?? node.parentId)
  }

  return result
}

function groupByIdentity(nodes: TimelineLayoutNode[]) {
  return new Set(nodes.map(stableNodeIdentity))
}

function stableNodeIdentityById(nodes: TimelineLayoutNode[], id: string) {
  return stableNodeIdentity(nodes.find((node) => node.id === id) ?? { id, parentId: null, label: id, kind: "unknown", value: 0 })
}

function childrenFor(children: Map<string, TimelineLayoutNode[]>, parentId: string) {
  const existing = children.get(parentId)
  if (existing) return existing

  const next: TimelineLayoutNode[] = []
  children.set(parentId, next)
  return next
}

function mapSet<K, V>(map: Map<K, Set<V>>, key: K) {
  const existing = map.get(key)
  if (existing) return existing

  const next = new Set<V>()
  map.set(key, next)
  return next
}
