import { describe, expect, it } from "vitest"

import { buildContinuityTreemapLayout, classifyTimelineNodes, type TimelineLayoutNode } from "../src/lib/treemap-timeline-layout.js"

describe("treemap timeline continuity layout", () => {
  it("is independent of frame node fetch order", () => {
    const anchor = [
      node("root", null, "root", 0, "root"),
      node("chunk:a", "root", "chunk", 120, "chunk:a"),
      node("module:chunk:a:/src/a.ts", "chunk:a", "app", 80, "module:/src/a.ts"),
      node("module:chunk:a:/src/b.ts", "chunk:a", "app", 40, "module:/src/b.ts"),
      node("chunk:b", "root", "chunk", 60, "chunk:b"),
      node("module:chunk:b:/src/c.ts", "chunk:b", "app", 60, "module:/src/c.ts"),
    ]
    const shuffled = [anchor[3]!, anchor[1]!, anchor[5]!, anchor[0]!, anchor[2]!, anchor[4]!]

    const first = rectsById(buildContinuityTreemapLayout({ anchorNodes: anchor, frameCount: 2, frameIndex: 1, frameNodes: anchor, height: 200, width: 400 }))
    const second = rectsById(buildContinuityTreemapLayout({ anchorNodes: anchor, frameCount: 2, frameIndex: 1, frameNodes: shuffled, height: 200, width: 400 }))

    expect(second).toEqual(first)
  })

  it("preserves current hierarchy when a module moves between chunks", () => {
    const previous = [
      node("root", null, "root", 0, "root"),
      node("chunk:a", "root", "chunk", 100, "chunk:a"),
      node("module:chunk:a:/src/shared.ts", "chunk:a", "app", 60, "module:/src/shared.ts"),
      node("chunk:b", "root", "chunk", 50, "chunk:b"),
    ]
    const current = [
      node("root", null, "root", 0, "root"),
      node("chunk:a", "root", "chunk", 40, "chunk:a"),
      node("chunk:b", "root", "chunk", 110, "chunk:b"),
      node("module:chunk:b:/src/shared.ts", "chunk:b", "app", 60, "module:/src/shared.ts"),
    ]

    const layout = buildContinuityTreemapLayout({ anchorNodes: current, frameCount: 2, frameIndex: 1, frameNodes: current, height: 200, previousNodes: previous, width: 400 })
    const movedModule = layout.leaves.find((leaf) => leaf.data.identity === "module:/src/shared.ts")

    expect(movedModule?.data.parentId).toBe("chunk:b")
    expect(movedModule?.data.parentIdentity).toBe("chunk:b")
    expect(movedModule?.data.timelineState).toBe("moved")
  })

  it("keeps current byte values as the layout weight and omits removed geometry", () => {
    const previous = [
      node("root", null, "root", 0, "root"),
      node("chunk:a", "root", "chunk", 100, "chunk:a"),
      node("chunk:removed", "root", "chunk", 80, "chunk:removed"),
    ]
    const current = [
      node("root", null, "root", 0, "root"),
      node("chunk:a", "root", "chunk", 100, "chunk:a"),
      node("chunk:b", "root", "chunk", 50, "chunk:b"),
    ]

    const layout = buildContinuityTreemapLayout({ anchorNodes: current, frameCount: 2, frameIndex: 1, frameNodes: current, height: 120, previousNodes: previous, width: 360 })
    const a = layout.leaves.find((leaf) => leaf.data.identity === "chunk:a")!
    const b = layout.leaves.find((leaf) => leaf.data.identity === "chunk:b")!
    const areaRatio = area(a) / area(b)

    expect(layout.leaves.some((leaf) => leaf.data.identity === "chunk:removed")).toBe(false)
    expect(a.data.values[1]).toBe(100)
    expect(b.data.values[1]).toBe(50)
    expect(areaRatio).toBeGreaterThan(1.75)
    expect(areaRatio).toBeLessThan(2.25)
    expectNoLeafOverlap(layout)
  })

  it("scales smaller frames from the center while preserving treemap validity", () => {
    const anchor = [
      node("root", null, "root", 0, "root"),
      node("chunk:a", "root", "chunk", 120, "chunk:a"),
      node("chunk:b", "root", "chunk", 80, "chunk:b"),
    ]
    const current = [
      node("root", null, "root", 0, "root"),
      node("chunk:a", "root", "chunk", 60, "chunk:a"),
      node("chunk:b", "root", "chunk", 80, "chunk:b"),
    ]

    const anchorLayout = buildContinuityTreemapLayout({ anchorNodes: anchor, frameCount: 2, frameIndex: 1, frameNodes: anchor, height: 240, maxFrameValue: 300, width: 480 })
    const currentLayout = buildContinuityTreemapLayout({ anchorNodes: anchor, frameCount: 2, frameIndex: 1, frameNodes: current, height: 240, maxFrameValue: 300, previousNodes: anchor, width: 480 })
    const anchorA = anchorLayout.leaves.find((leaf) => leaf.data.identity === "chunk:a")!
    const currentA = currentLayout.leaves.find((leaf) => leaf.data.identity === "chunk:a")!
    const currentBounds = bounds(currentLayout.leaves)

    expect(currentBounds.x0).toBeGreaterThan(0)
    expect(currentBounds.y0).toBeGreaterThan(0)
    expect(currentBounds.x1).toBeLessThan(480)
    expect(currentBounds.y1).toBeLessThan(240)
    expect(currentA.x0).toBeGreaterThan(anchorA.x0)
    expect(currentA.y0).toBeGreaterThan(anchorA.y0)
    expect(area(currentA)).toBeLessThan(area(anchorA))
    expectNoLeafOverlap(currentLayout)
  })

  it("uses maximum timeline size as capacity instead of filling the viewport every frame", () => {
    const anchor = [
      node("root", null, "root", 0, "root"),
      node("chunk:a", "root", "chunk", 100, "chunk:a"),
      node("chunk:b", "root", "chunk", 100, "chunk:b"),
    ]
    const current = [
      node("root", null, "root", 0, "root"),
      node("chunk:a", "root", "chunk", 50, "chunk:a"),
      node("chunk:b", "root", "chunk", 50, "chunk:b"),
    ]

    const layout = buildContinuityTreemapLayout({ anchorNodes: anchor, frameCount: 2, frameIndex: 1, frameNodes: current, height: 200, maxFrameValue: 400, previousNodes: anchor, width: 400 })
    const occupiedArea = layout.leaves.reduce((total, leaf) => total + area(leaf), 0)

    expect(occupiedArea).toBeLessThan(400 * 200 * 0.5)
    expectNoLeafOverlap(layout)
  })

  it("does not overlap when stable chunks grow beyond anchor values", () => {
    const anchor = [
      node("root", null, "root", 0, "root"),
      node("chunk:a", "root", "chunk", 80, "chunk:a"),
      node("chunk:b", "root", "chunk", 120, "chunk:b"),
      node("chunk:c", "root", "chunk", 60, "chunk:c"),
    ]
    const current = [
      node("root", null, "root", 0, "root"),
      node("chunk:a", "root", "chunk", 180, "chunk:a"),
      node("chunk:b", "root", "chunk", 90, "chunk:b"),
      node("chunk:c", "root", "chunk", 130, "chunk:c"),
    ]

    const layout = buildContinuityTreemapLayout({ anchorNodes: anchor, frameCount: 2, frameIndex: 1, frameNodes: current, height: 240, maxFrameValue: 400, previousNodes: anchor, width: 480 })

    expectNoLeafOverlap(layout)
  })

  it("keeps anchor row orientation for stable siblings while values change", () => {
    const anchor = [
      node("root", null, "root", 0, "root"),
      node("chunk:index", "root", "chunk", 1000, "chunk:index"),
      node("module:index:analytics", "chunk:index", "app", 400, "module:analytics"),
      node("module:index:main", "chunk:index", "app", 120, "module:main"),
      node("module:index:modulepreload", "chunk:index", "vite", 360, "module:modulepreload"),
    ]
    const current = [
      node("root", null, "root", 0, "root"),
      node("chunk:index", "root", "chunk", 1000, "chunk:index"),
      node("module:index:analytics", "chunk:index", "app", 180, "module:analytics"),
      node("module:index:main", "chunk:index", "app", 130, "module:main"),
      node("module:index:modulepreload", "chunk:index", "vite", 300, "module:modulepreload"),
    ]

    const anchorLayout = buildContinuityTreemapLayout({ anchorNodes: anchor, frameCount: 2, frameIndex: 1, frameNodes: anchor, height: 320, maxFrameValue: 1000, width: 720 })
    const currentLayout = buildContinuityTreemapLayout({ anchorNodes: anchor, frameCount: 2, frameIndex: 1, frameNodes: current, height: 320, maxFrameValue: 1000, previousNodes: anchor, width: 720 })
    const anchorAnalytics = leafByIdentity(anchorLayout, "module:analytics")
    const anchorMain = leafByIdentity(anchorLayout, "module:main")
    const anchorModulepreload = leafByIdentity(anchorLayout, "module:modulepreload")
    const currentAnalytics = leafByIdentity(currentLayout, "module:analytics")
    const currentMain = leafByIdentity(currentLayout, "module:main")
    const currentModulepreload = leafByIdentity(currentLayout, "module:modulepreload")

    expect(anchorModulepreload.x0).toBeGreaterThan(anchorAnalytics.x0)
    expect(anchorModulepreload.x0).toBeGreaterThan(anchorMain.x0)
    expect(currentModulepreload.x0).toBeGreaterThan(currentAnalytics.x0)
    expect(currentModulepreload.x0).toBeGreaterThan(currentMain.x0)
    expectNoLeafOverlap(currentLayout)
  })

  it("classifies chunk split and merge relationships relative to the previous frame", () => {
    const splitPrevious = [
      node("root", null, "root", 0, "root"),
      node("chunk:a", "root", "chunk", 100, "chunk:a"),
      node("module:chunk:a:/src/a.ts", "chunk:a", "app", 50, "module:/src/a.ts"),
      node("module:chunk:a:/src/b.ts", "chunk:a", "app", 50, "module:/src/b.ts"),
    ]
    const splitCurrent = [
      node("root", null, "root", 0, "root"),
      node("chunk:b", "root", "chunk", 50, "chunk:b"),
      node("module:chunk:b:/src/a.ts", "chunk:b", "app", 50, "module:/src/a.ts"),
      node("chunk:c", "root", "chunk", 50, "chunk:c"),
      node("module:chunk:c:/src/b.ts", "chunk:c", "app", 50, "module:/src/b.ts"),
    ]
    const mergePrevious = [
      node("root", null, "root", 0, "root"),
      node("chunk:a", "root", "chunk", 50, "chunk:a"),
      node("module:chunk:a:/src/a.ts", "chunk:a", "app", 50, "module:/src/a.ts"),
      node("chunk:b", "root", "chunk", 50, "chunk:b"),
      node("module:chunk:b:/src/b.ts", "chunk:b", "app", 50, "module:/src/b.ts"),
    ]
    const mergeCurrent = [
      node("root", null, "root", 0, "root"),
      node("chunk:c", "root", "chunk", 100, "chunk:c"),
      node("module:chunk:c:/src/a.ts", "chunk:c", "app", 50, "module:/src/a.ts"),
      node("module:chunk:c:/src/b.ts", "chunk:c", "app", 50, "module:/src/b.ts"),
    ]

    expect(classifyTimelineNodes(splitCurrent, splitPrevious).get("chunk:b")).toBe("split")
    expect(classifyTimelineNodes(splitCurrent, splitPrevious).get("chunk:c")).toBe("split")
    expect(classifyTimelineNodes(mergeCurrent, mergePrevious).get("chunk:c")).toBe("merged")
  })
})

function node(id: string, parentId: string | null, kind: string, value: number, identity: string): TimelineLayoutNode {
  return { id, parentId, label: id, kind, value, identity }
}

function rectsById(layout: ReturnType<typeof buildContinuityTreemapLayout>) {
  return Object.fromEntries([...layout.rects].map(([id, rect]) => [id, roundRect(rect)]))
}

function roundRect(rect: { height: number; width: number; x: number; y: number }) {
  return {
    height: Number(rect.height.toFixed(4)),
    width: Number(rect.width.toFixed(4)),
    x: Number(rect.x.toFixed(4)),
    y: Number(rect.y.toFixed(4)),
  }
}

function area(node: { x0: number; x1: number; y0: number; y1: number }) {
  return Math.max(0, node.x1 - node.x0) * Math.max(0, node.y1 - node.y0)
}

function bounds(nodes: Array<{ x0: number; x1: number; y0: number; y1: number }>) {
  return {
    x0: Math.min(...nodes.map((node) => node.x0)),
    x1: Math.max(...nodes.map((node) => node.x1)),
    y0: Math.min(...nodes.map((node) => node.y0)),
    y1: Math.max(...nodes.map((node) => node.y1)),
  }
}

function leafByIdentity(layout: ReturnType<typeof buildContinuityTreemapLayout>, identity: string) {
  return layout.leaves.find((leaf) => leaf.data.identity === identity)!
}

function expectNoLeafOverlap(layout: ReturnType<typeof buildContinuityTreemapLayout>) {
  for (let leftIndex = 0; leftIndex < layout.leaves.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < layout.leaves.length; rightIndex += 1) {
      const left = layout.leaves[leftIndex]!
      const right = layout.leaves[rightIndex]!
      const overlapWidth = Math.min(left.x1, right.x1) - Math.max(left.x0, right.x0)
      const overlapHeight = Math.min(left.y1, right.y1) - Math.max(left.y0, right.y0)
      expect(Math.max(0, overlapWidth) * Math.max(0, overlapHeight)).toBeLessThan(0.0001)
    }
  }
}
