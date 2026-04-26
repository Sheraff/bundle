import { keepPreviousData, useQuery } from "@tanstack/react-query"
import * as d3 from "d3"
import { useEffect, useRef, useState, type CSSProperties } from "react"

import { formatBytes, shortSha } from "../lib/formatting.js"
import {
  buildContinuityTreemapLayout,
  rectSnapshot,
  type RectSnapshot,
  type TimelineRectNode,
  type TimelineTreemapNode,
} from "../lib/treemap-timeline-layout.js"

import "./charts.css"

const chartPalette = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
  "var(--chart-6)",
  "var(--chart-7)",
  "var(--chart-8)",
  "var(--chart-9)",
  "var(--chart-10)",
] as const

function buildPalette(domain: string[]) {
  return d3.scaleOrdinal<string, string>().domain(domain).range(chartPalette as unknown as string[])
}

export type TrendChartSeries = {
  id: string
  label: string
  points: Array<{
    commitSha: string
    measuredAt: string
    value: number
  }>
}

export function TrendChart(props: { height?: number; series: TrendChartSeries[]; width?: number }) {
  const width = props.width ?? 720
  const height = props.height ?? 240
  const margin = { top: 18, right: 18, bottom: 38, left: 68 }
  const points = props.series.flatMap((series) => series.points.map((point) => ({ ...point, series })))

  if (points.length === 0) {
    return <p className="empty">No graph points are available.</p>
  }

  const orderedCommits = Array.from(
    new Map(
      [...points]
        .sort((left, right) => left.measuredAt.localeCompare(right.measuredAt))
        .map((point) => [point.commitSha, point]),
    ).values(),
  )
  const x = d3
    .scalePoint<string>()
    .domain(orderedCommits.map((point) => point.commitSha))
    .range([margin.left, width - margin.right])
    .padding(0.5)
  const maxValue = d3.max(points, (point) => point.value) ?? 0
  const y = d3
    .scaleLinear()
    .domain([0, Math.max(1, maxValue)])
    .nice()
    .range([height - margin.bottom, margin.top])
  const color = buildPalette(props.series.map((series) => series.id))
  const line = d3
    .line<TrendChartSeries["points"][number]>()
    .x((point) => x(point.commitSha) ?? margin.left)
    .y((point) => y(point.value))

  return (
    <figure>
      <svg className="trend-chart" role="img" aria-label="Bundle size trend graph" viewBox={`0 0 ${width} ${height}`}>
        <line data-role="axis" x1={margin.left} x2={width - margin.right} y1={height - margin.bottom} y2={height - margin.bottom} />
        <line data-role="axis" x1={margin.left} x2={margin.left} y1={margin.top} y2={height - margin.bottom} />
        {y.ticks(4).map((tick) => (
          <g key={tick}>
            <line data-role="grid" x1={margin.left - 4} x2={width - margin.right} y1={y(tick)} y2={y(tick)} />
            <text x={margin.left - 8} y={y(tick)} textAnchor="end" dominantBaseline="middle">
              {formatBytes(tick)}
            </text>
          </g>
        ))}
        {orderedCommits.map((point) => (
          <text key={point.commitSha} x={x(point.commitSha)} y={height - 12} textAnchor="middle">
            {shortSha(point.commitSha)}
          </text>
        ))}
        {props.series.map((series) => (
          <path
            key={series.id}
            data-role="series"
            d={line(series.points) ?? undefined}
            style={{ stroke: color(series.id) } as CSSProperties}
          />
        ))}
        {points.map((point) => (
          <circle
            key={`${point.series.id}:${point.commitSha}:${point.measuredAt}`}
            data-role="point"
            cx={x(point.commitSha)}
            cy={y(point.value)}
            r="3"
            style={{ stroke: color(point.series.id) } as CSSProperties}
          >
            <title>{`${point.series.label}: ${formatBytes(point.value)} at ${shortSha(point.commitSha)}`}</title>
          </circle>
        ))}
      </svg>
      <figcaption className="trend-legend">
        {props.series.map((series) => (
          <span key={series.id} style={{ "--swatch": color(series.id) } as CSSProperties}>
            {series.label}
          </span>
        ))}
      </figcaption>
    </figure>
  )
}

export type TreemapNode = {
  id: string
  parentId: string | null
  label: string
  kind: string
  value: number
  state?: string
  identity?: string
}

export type TreemapTimelineFrame = {
  commitSha: string
  measuredAt: string
  scenarioRunId: string
  nodesUrl: string
  totalValue: number
}

export type TreemapTimeline = {
  frames: TreemapTimelineFrame[]
  baseFrameIndex?: number
  headFrameIndex?: number
  initialFrameIndex: number
  initialNodes: TreemapNode[]
}

type TreemapFrameQueryData = { frameIndex: number; nodes: TreemapNode[] }
type ExitingTreemapNode = RectSnapshot & { id: string; kind: string; label: string; timelineState?: string; value: number }
type TimelineFrameGhostNode = ExitingTreemapNode & { state: "exiting" | "previous" }

const treemapParentHeaderHeight = 18

export function TreemapChart(props: { nodes: TreemapNode[] }) {
  const width = 720
  const height = 320
  const parentIds = new Set(props.nodes.flatMap((node) => node.parentId ? [node.parentId] : []))
  const nodes = props.nodes.filter((node) => node.value > 0 || node.parentId === null || parentIds.has(node.id))

  if (nodes.length <= 1) {
    return <p className="empty">No treemap nodes are available for the selected series.</p>
  }

  const internalIds = new Set(nodes.flatMap((node) => node.parentId ? [node.parentId] : []))
  const root = d3
    .stratify<TreemapNode>()
    .id((node) => node.id)
    .parentId((node) => node.parentId)(nodes)
    .sum((node) => node.value)
    .sort((left, right) => (right.value ?? 0) - (left.value ?? 0))
  d3
    .treemap<TreemapNode>()
    .size([width, height])
    .paddingInner(1)
    .paddingOuter(1)
    .paddingTop((node) => node.depth > 0 && node.children ? treemapParentHeaderHeight : 1)(root)
  const internalNodes = root
    .descendants()
    .filter((node) => node.depth > 0 && internalIds.has(node.id ?? "")) as Array<d3.HierarchyRectangularNode<TreemapNode>>
  const leaves = root.leaves() as Array<d3.HierarchyRectangularNode<TreemapNode>>
  const color = buildPalette([...new Set([...internalNodes, ...leaves].map((node) => node.data.kind))])

  return (
    <svg className="treemap-chart" role="img" aria-label="Bundle composition treemap" viewBox={`0 0 ${width} ${height}`}>
      {internalNodes.map((node, index) => {
        const rectWidth = Math.max(0, node.x1 - node.x0)
        const rectHeight = Math.max(0, node.y1 - node.y0)
        const labelLines = treemapLabelLines(node.data.label, rectWidth, treemapParentHeaderHeight)
        const fill = color(node.data.kind)

        return (
          <g
            key={node.id}
            data-kind="parent"
            data-state={node.data.state ?? "stable"}
            transform={`translate(${node.x0},${node.y0})`}
            style={{ color: fill } as CSSProperties}
          >
            <clipPath id={`treemap-parent-label-${index}`}>
              <rect width={rectWidth} height={Math.min(rectHeight, treemapParentHeaderHeight)} />
            </clipPath>
            <rect data-role="cell" width={rectWidth} height={rectHeight} style={{ fill } as CSSProperties} />
            {labelLines.length > 0 ? (
              <text x="5" y="14" clipPath={`url(#treemap-parent-label-${index})`} pointerEvents="none">
                {labelLines.map((line, lineIndex) => (
                  <tspan key={lineIndex} x="5" dy={lineIndex === 0 ? 0 : 13}>{line}</tspan>
                ))}
              </text>
            ) : null}
            <title>{`${node.data.label}: ${formatBytes(node.data.value)} self, ${formatBytes(node.value ?? 0)} including children`}</title>
          </g>
        )
      })}
      {leaves.map((leaf, index) => {
        const rectWidth = Math.max(0, leaf.x1 - leaf.x0)
        const rectHeight = Math.max(0, leaf.y1 - leaf.y0)
        const labelLines = treemapLabelLines(leaf.data.label, rectWidth, rectHeight)
        const fill = color(leaf.data.kind)

        return (
          <g
            key={leaf.id}
            data-kind="leaf"
            data-state={leaf.data.state ?? "stable"}
            transform={`translate(${leaf.x0},${leaf.y0})`}
            style={{ color: fill } as CSSProperties}
          >
            <clipPath id={`treemap-label-${index}`}>
              <rect width={rectWidth} height={rectHeight} />
            </clipPath>
            <rect data-role="cell" width={rectWidth} height={rectHeight} style={{ fill } as CSSProperties} />
            {labelLines.length > 0 ? (
              <text x="5" y="14" clipPath={`url(#treemap-label-${index})`} pointerEvents="none">
                {labelLines.map((line, lineIndex) => (
                  <tspan key={lineIndex} x="5" dy={lineIndex === 0 ? 0 : 13}>{line}</tspan>
                ))}
              </text>
            ) : null}
            <title>{`${leaf.data.label}: ${formatBytes(leaf.value ?? 0)}${leaf.data.state ? ` (${leaf.data.state})` : ""}`}</title>
          </g>
        )
      })}
    </svg>
  )
}

export function TreemapTimelineScrubber(props: { timeline: TreemapTimeline }) {
  const width = 720
  const height = 320
  const initialIndex = props.timeline.initialFrameIndex
  const [requestedFrameIndex, setRequestedFrameIndex] = useState(initialIndex)
  const frameIndex = clamp(requestedFrameIndex, 0, props.timeline.frames.length - 1)
  const frame = props.timeline.frames[frameIndex]
  const previousRectRef = useRef<Map<string, RectSnapshot>>(new Map())
  const previousNodeMetaRef = useRef<Map<string, { kind: string; label: string; timelineState?: string; value: number }>>(new Map())
  const [ghostNodes, setGhostNodes] = useState<TimelineFrameGhostNode[]>([])
  const svgRef = useRef<SVGSVGElement | null>(null)
  const ghostRef = useRef<SVGGElement | null>(null)

  if (props.timeline.frames.length === 0 || !frame) return null

  const frameQuery = useQuery<TreemapFrameQueryData>({
    queryKey: treemapFrameQueryKey(frame),
    queryFn: async ({ signal }) => {
      const response = await fetch(frame.nodesUrl, { signal })
      if (!response.ok) throw new Error(`Could not load treemap frame ${response.status}`)

      const payload = await response.json() as { nodes: TreemapNode[] }
      return { frameIndex, nodes: payload.nodes }
    },
    initialData: frameIndex === props.timeline.initialFrameIndex
      ? { frameIndex, nodes: props.timeline.initialNodes }
      : undefined,
    placeholderData: keepPreviousData,
    staleTime: Infinity,
  })
  const previousFrame = frameIndex > 0 ? props.timeline.frames[frameIndex - 1] : null
  const previousFrameQuery = useQuery<TreemapFrameQueryData>({
    queryKey: previousFrame ? treemapFrameQueryKey(previousFrame) : ["treemap-frame", "none"],
    queryFn: async ({ signal }) => {
      if (!previousFrame) return { frameIndex: 0, nodes: [] }

      const response = await fetch(previousFrame.nodesUrl, { signal })
      if (!response.ok) throw new Error(`Could not load treemap frame ${response.status}`)

      const payload = await response.json() as { nodes: TreemapNode[] }
      return { frameIndex: frameIndex - 1, nodes: payload.nodes }
    },
    enabled: previousFrame !== null,
    staleTime: Infinity,
  })
  const displayFrameIndex = frameQuery.data?.frameIndex ?? props.timeline.initialFrameIndex
  const displayFrame = props.timeline.frames[displayFrameIndex] ?? frame
  const displayNodes = frameQuery.data?.nodes ?? props.timeline.initialNodes
  const previousNodes = previousFrameQuery.data?.frameIndex === displayFrameIndex - 1 ? previousFrameQuery.data.nodes : []
  const maxFrameValue = Math.max(...props.timeline.frames.map((timelineFrame) => timelineFrame.totalValue), frame.totalValue, 1)
  const layout = buildContinuityTreemapLayout({
    anchorNodes: props.timeline.initialNodes,
    frameCount: props.timeline.frames.length,
    frameIndex: displayFrameIndex,
    frameNodes: displayNodes,
    height,
    maxFrameValue,
    previousNodes,
    width,
  })
  const { internalNodes, leaves } = layout
  const currentFrameValue = displayFrame.totalValue
  const previousFrameValue = displayFrameIndex > 0 ? props.timeline.frames[displayFrameIndex - 1]?.totalValue : undefined
  const frameSummary = buildTimelineFrameSummary({
    currentNodes: displayNodes,
    currentValue: currentFrameValue,
    previousNodes,
    previousValue: previousFrameValue,
  })
  const timelineChangeRows = [...internalNodes, ...leaves]
    .filter((node) => node.data.timelineState !== "stable")
    .sort((left, right) => {
      const stateCompare = left.data.timelineState.localeCompare(right.data.timelineState)
      if (stateCompare !== 0) return stateCompare

      return left.data.label.localeCompare(right.data.label)
    })
  const color = buildPalette([...new Set([...internalNodes, ...leaves].map((node) => node.data.kind))])
  const currentRects = layout.rects
  const currentNodeMeta = new Map([...internalNodes, ...leaves].map((node) => [
    node.data.transitionId,
    {
      kind: node.data.kind,
      label: node.data.label,
      timelineState: node.data.timelineState,
      value: node.data.values[displayFrameIndex] ?? 0,
    },
  ]))
  const previousRects = previousRectRef.current
  const animationKey = displayFrame.scenarioRunId

  useEffect(() => {
    const nextGhostNodes: TimelineFrameGhostNode[] = []
    for (const [id, previousRect] of previousRects) {
      const meta = previousNodeMetaRef.current.get(id)
      if (!meta) continue

      if (!currentRects.has(id)) {
        nextGhostNodes.push({ ...previousRect, id, ...meta, state: "exiting", timelineState: "removed" })
        continue
      }

      if (meta.timelineState && meta.timelineState !== "stable") {
        nextGhostNodes.push({ ...previousRect, id, ...meta, state: "previous" })
      }
    }

    setGhostNodes(nextGhostNodes)

    const svg = svgRef.current
    if (svg && previousRects.size > 0) {
      const groups = d3.select(svg).selectAll<SVGGElement, unknown>("g[data-treemap-node-id]")
      groups.each(function animateTreemapNode() {
        const group = d3.select(this)
        const previousRect = previousRects.get(this.dataset.treemapNodeId ?? "")
        if (!previousRect) {
          group
            .interrupt()
            .attr("opacity", 0)
            .transition()
            .duration(240)
            .ease(d3.easeCubicOut)
            .attr("opacity", 1)
          return
        }

        group.interrupt().attr("opacity", 1)

        const targetRect = {
          height: Number(this.dataset.height),
          width: Number(this.dataset.width),
          x: Number(this.dataset.x),
          y: Number(this.dataset.y),
        }
        const changed = previousRect.x !== targetRect.x ||
          previousRect.y !== targetRect.y ||
          previousRect.width !== targetRect.width ||
          previousRect.height !== targetRect.height
        if (!changed) {
          group.attr("transform", `translate(${targetRect.x},${targetRect.y})`)
          return
        }

        group
          .attr("transform", `translate(${previousRect.x},${previousRect.y})`)
          .transition()
          .duration(240)
          .ease(d3.easeCubicOut)
          .attr("transform", `translate(${targetRect.x},${targetRect.y})`)

        group
          .select<SVGRectElement>("rect[data-role='cell']")
          .interrupt()
          .attr("width", previousRect.width)
          .attr("height", previousRect.height)
          .transition()
          .duration(240)
          .ease(d3.easeCubicOut)
          .attr("width", targetRect.width)
          .attr("height", targetRect.height)

        group
          .select<SVGRectElement>("clipPath rect")
          .interrupt()
          .attr("width", previousRect.width)
          .attr("height", previousRect.height)
          .transition()
          .duration(240)
          .ease(d3.easeCubicOut)
          .attr("width", targetRect.width)
          .attr("height", targetRect.height)
      })
    }

    previousRectRef.current = currentRects
    previousNodeMetaRef.current = currentNodeMeta
  }, [animationKey])

  useEffect(() => {
    const group = ghostRef.current
    if (!group || ghostNodes.length === 0) return

    d3.select(group)
      .selectAll<SVGGElement, unknown>("g[data-treemap-ghost-node-id]")
      .interrupt()
      .attr("opacity", 0.42)
      .transition()
      .duration(240)
      .ease(d3.easeCubicOut)
      .attr("opacity", 0)

    const timeout = window.setTimeout(() => setGhostNodes([]), 260)
    return () => window.clearTimeout(timeout)
  }, [ghostNodes])

  return (
    <section className="timeline-scrubber" aria-label="Treemap history scrubber">
      <h3>History scrubber</h3>
      <p>
        Frame {frameIndex + 1} of {props.timeline.frames.length}: <span className="mono">{shortSha(frame.commitSha)}</span> at {frame.measuredAt}
        {props.timeline.baseFrameIndex === frameIndex ? " (base)" : ""}
        {props.timeline.headFrameIndex === frameIndex ? " (head)" : ""}
        {` (${Math.round((displayFrame.totalValue / maxFrameValue) * 100)}% of timeline max)`}
        {frameQuery.isPlaceholderData ? ` (loading; showing ${shortSha(displayFrame.commitSha)})` : ""}
      </p>
      <p>{frameSummary}</p>
      {frameQuery.isError ? <p className="text-danger">Could not load this treemap frame. The previous frame is still shown.</p> : null}
      <div data-role="controls">
        <button type="button" className="button-secondary" onClick={() => setRequestedFrameIndex(frameIndex - 1)} disabled={frameIndex === 0}>← Previous</button>
        <button type="button" className="button-secondary" onClick={() => setRequestedFrameIndex(frameIndex + 1)} disabled={frameIndex === props.timeline.frames.length - 1}>Next →</button>
      </div>
      <label>
        Commit frame
        <input
          aria-label="Treemap history frame"
          type="range"
          min="0"
          max={props.timeline.frames.length - 1}
          value={frameIndex}
          onChange={(event) => setRequestedFrameIndex(Number(event.currentTarget.value))}
        />
      </label>
      <TimelineMinimap frames={props.timeline.frames} maxFrameValue={maxFrameValue} selectedFrameIndex={frameIndex} setFrameIndex={setRequestedFrameIndex} />
      <svg ref={svgRef} className="treemap-chart" role="img" aria-label="Bundle composition treemap timeline" viewBox={`0 0 ${width} ${height}`}>
        <rect data-role="container" x="1" y="1" width={width - 2} height={height - 2} />
        <rect data-role="bounds" x={layout.bounds.x} y={layout.bounds.y} width={layout.bounds.width} height={layout.bounds.height}>
          <title>{`Current frame occupies ${Math.round((displayFrame.totalValue / maxFrameValue) * 100)}% of timeline max`}</title>
        </rect>
        {internalNodes.map((node, index) => renderTreemapRect({ color, frameIndex: displayFrameIndex, index, isParent: true, node, prefix: "timeline-parent" }))}
        {leaves.map((node, index) => renderTreemapRect({ color, frameIndex: displayFrameIndex, index, isParent: false, node, prefix: "timeline-leaf" }))}
        <g ref={ghostRef} aria-hidden="true" pointerEvents="none">
          {ghostNodes.map((node) => (
            <g key={`${node.state}:${node.id}`} data-treemap-ghost-node-id={node.id} data-kind="leaf" data-state={node.state === "exiting" ? "removed" : "previous"} transform={`translate(${node.x},${node.y})`} style={{ color: color(node.kind) } as CSSProperties}>
              <rect data-role="cell" width={node.width} height={node.height} style={{ fill: color(node.kind), fillOpacity: node.state === "exiting" ? 0.28 : 0.16 } as CSSProperties} />
              <title>{node.state === "exiting" ? `${node.label}: removed after ${formatBytes(node.value)}` : `${node.label}: previous position`}</title>
            </g>
          ))}
        </g>
      </svg>
      {timelineChangeRows.length > 0 ? (
        <div className="table-scroll">
          <table>
            <caption>Current frame continuity changes</caption>
            <thead>
              <tr>
                <th scope="col">State</th>
                <th scope="col">Item</th>
                <th scope="col">Kind</th>
                <th scope="col">Size</th>
              </tr>
            </thead>
            <tbody>
              {timelineChangeRows.map((node) => (
                <tr key={node.data.transitionId}>
                  <td>{node.data.timelineState}</td>
                  <td className="mono">{node.data.label}</td>
                  <td>{node.data.kind}</td>
                  <td className="num">{formatBytes(node.data.values[displayFrameIndex] ?? 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  )
}

function treemapFrameQueryKey(frame: TreemapTimelineFrame) {
  return ["treemap-frame", frame.nodesUrl] as const
}

function TimelineMinimap(props: {
  frames: TreemapTimelineFrame[]
  maxFrameValue: number
  selectedFrameIndex: number
  setFrameIndex: (index: number) => void
}) {
  const width = 720
  const height = 44
  const gap = 3
  const barWidth = Math.max(4, (width - gap * Math.max(0, props.frames.length - 1)) / Math.max(1, props.frames.length))

  return (
    <svg className="timeline-minimap" role="img" aria-label="Timeline size minimap" viewBox={`0 0 ${width} ${height}`}>
      {props.frames.map((frame, index) => {
        const ratio = Math.max(0.02, Math.min(1, frame.totalValue / props.maxFrameValue))
        const barHeight = ratio * (height - 10)
        const x = index * (barWidth + gap)
        const y = height - barHeight - 4
        return (
          <rect
            key={frame.scenarioRunId}
            x={x}
            y={y}
            width={barWidth}
            height={barHeight}
            data-active={index === props.selectedFrameIndex ? "true" : undefined}
            onClick={() => props.setFrameIndex(index)}
          >
            <title>{`Frame ${index + 1}: ${shortSha(frame.commitSha)}, ${formatBytes(frame.totalValue)}`}</title>
          </rect>
        )
      })}
    </svg>
  )
}

function buildTimelineFrameSummary(input: {
  currentNodes: TreemapNode[]
  currentValue: number
  previousNodes: TreemapNode[]
  previousValue?: number
}) {
  if (input.previousNodes.length === 0 || input.previousValue === undefined) {
    return `Initial frame: ${formatBytes(input.currentValue)}.`
  }

  const currentIdentities = new Set(input.currentNodes.filter((node) => node.parentId !== null).map(treemapNodeIdentity))
  const previousIdentities = new Set(input.previousNodes.filter((node) => node.parentId !== null).map(treemapNodeIdentity))
  const added = [...currentIdentities].filter((id) => !previousIdentities.has(id)).length
  const removed = [...previousIdentities].filter((id) => !currentIdentities.has(id)).length
  const moved = countMovedNodes(input.currentNodes, input.previousNodes)
  const delta = input.currentValue - input.previousValue
  const direction = delta >= 0 ? "+" : ""

  return `Frame delta: ${direction}${formatBytes(delta)} (${formatBytes(input.currentValue)} total), +${added} / -${removed} nodes, ${moved} moved.`
}

function countMovedNodes(currentNodes: TreemapNode[], previousNodes: TreemapNode[]) {
  const currentParents = parentIdentityByNodeIdentity(currentNodes)
  const previousParents = parentIdentityByNodeIdentity(previousNodes)
  let moved = 0
  for (const [identity, parent] of currentParents) {
    if (previousParents.has(identity) && previousParents.get(identity) !== parent) moved += 1
  }

  return moved
}

function parentIdentityByNodeIdentity(nodes: TreemapNode[]) {
  const byId = new Map(nodes.map((node) => [node.id, treemapNodeIdentity(node)]))
  const result = new Map<string, string | null>()
  for (const node of nodes) {
    if (node.parentId === null) continue
    result.set(treemapNodeIdentity(node), node.parentId ? byId.get(node.parentId) ?? node.parentId : null)
  }

  return result
}

function treemapNodeIdentity(node: TreemapNode) {
  return node.identity ?? node.id
}

function renderTreemapRect(props: {
  color: d3.ScaleOrdinal<string, string>
  frameIndex: number
  index: number
  isParent: boolean
  node: TimelineRectNode
  prefix: string
}) {
  const rectWidth = Math.max(0, props.node.x1 - props.node.x0)
  const rectHeight = Math.max(0, props.node.y1 - props.node.y0)
  const labelWidth = Math.max(rectWidth, props.node.data.labelWidth ?? 0)
  const labelHeight = props.isParent ? treemapParentHeaderHeight : Math.max(rectHeight, props.node.data.labelHeight ?? 0)
  const labelLines = treemapLabelLines(props.node.data.label, labelWidth, labelHeight)
  const labelVisible = rectWidth >= 28 && rectHeight >= 14
  const value = props.node.data.values[props.frameIndex] ?? 0
  const clipId = `${props.prefix}-${props.index}`
  const rect = rectSnapshot(props.node)
  const stateLabel = props.node.data.timelineState !== "stable" ? ` (${props.node.data.timelineState})` : ""
  const fill = props.color(props.node.data.kind)

  return (
    <g
      key={props.node.data.transitionId}
      data-height={rect.height}
      data-treemap-node-id={props.node.data.transitionId}
      data-width={rect.width}
      data-x={rect.x}
      data-y={rect.y}
      data-kind={props.isParent ? "parent" : "leaf"}
      data-state={props.node.data.timelineState ?? "stable"}
      transform={`translate(${props.node.x0},${props.node.y0})`}
      style={{ color: fill } as CSSProperties}
    >
      <clipPath id={clipId}>
        <rect width={rectWidth} height={props.isParent ? Math.min(rectHeight, treemapParentHeaderHeight) : rectHeight} />
      </clipPath>
      <rect
        data-role="cell"
        width={rectWidth}
        height={rectHeight}
        style={{ fill } as CSSProperties}
      />
      {labelLines.length > 0 ? (
        <text x="5" y="14" clipPath={`url(#${clipId})`} opacity={labelVisible ? 1 : 0} pointerEvents="none">
          {labelLines.map((line, lineIndex) => (
            <tspan key={lineIndex} x="5" dy={lineIndex === 0 ? 0 : 13}>{line}</tspan>
          ))}
        </text>
      ) : null}
      <title>
        {props.isParent
          ? `${props.node.data.label}: ${formatBytes(value)} self, ${formatBytes(props.node.value ?? 0)} including children${stateLabel}`
          : `${props.node.data.label}: ${formatBytes(value)}${stateLabel}`}
      </title>
    </g>
  )
}

function treemapLabelLines(label: string, width: number, height: number) {
  if (width < 34 || height < 18) return []

  const maxLines = Math.max(1, Math.min(3, Math.floor((height - 6) / 13)))
  const maxChars = Math.max(3, Math.floor((width - 8) / 6))
  const compactLabel = compactTreemapLabel(label, maxChars * maxLines)
  const words = compactLabel.split(/(?<=\/)|(?=[._-])/u).filter(Boolean)
  const lines: string[] = []

  for (const word of words.length > 0 ? words : [compactLabel]) {
    const current = lines.at(-1)
    if (!current) {
      lines.push(trimTreemapLine(word, maxChars))
    } else if (`${current}${word}`.length <= maxChars) {
      lines[lines.length - 1] = `${current}${word}`
    } else if (lines.length < maxLines) {
      lines.push(trimTreemapLine(word, maxChars))
    }
  }

  return lines.slice(0, maxLines)
}

function compactTreemapLabel(label: string, maxChars: number) {
  if (label.length <= maxChars) return label

  const pathParts = label.split("/").filter(Boolean)
  if (pathParts.length >= 2) {
    const suffix = pathParts.slice(-2).join("/")
    return suffix.length <= maxChars ? suffix : pathParts.at(-1) ?? label
  }

  return label
}

function trimTreemapLine(line: string, maxChars: number) {
  return line.length <= maxChars ? line : `${line.slice(0, Math.max(1, maxChars - 3))}...`
}

export type GraphNode = { id: string; label: string; value: number }
export type GraphEdge = { from: string; to: string; kind: string }
type SimGraphNode = GraphNode & d3.SimulationNodeDatum
type SimGraphLink = d3.SimulationLinkDatum<SimGraphNode> & { kind: string }

export function DependencyGraph(props: { edges: GraphEdge[]; nodes: GraphNode[] }) {
  const width = 720
  const height = 320

  if (props.nodes.length === 0) {
    return <p className="empty">No dependency graph nodes are available.</p>
  }

  const size = d3.scaleSqrt().domain([0, d3.max(props.nodes, (node) => node.value) ?? 1]).range([6, 20])
  const simulationNodes: SimGraphNode[] = props.nodes.map((node) => ({ ...node }))
  const simulationLinks: SimGraphLink[] = props.edges.map((edge) => ({ source: edge.from, target: edge.to, kind: edge.kind }))
  d3
    .forceSimulation(simulationNodes)
    .randomSource(d3.randomLcg(1))
    .force(
      "link",
      d3
        .forceLink<SimGraphNode, SimGraphLink>(simulationLinks)
        .id((node) => node.id)
        .distance((link) => (link.kind === "dynamic-import" ? 130 : 95)),
    )
    .force("charge", d3.forceManyBody().strength(-260))
    .force("center", d3.forceCenter(width / 2, height / 2))
    .force("collide", d3.forceCollide<SimGraphNode>().radius((node) => 14 + size(node.value)))
    .stop()
    .tick(160)
  const positions = new Map(simulationNodes.map((node) => [node.id, { x: clamp(node.x ?? width / 2, 32, width - 32), y: clamp(node.y ?? height / 2, 32, height - 32) }]))

  return (
    <svg className="dependency-graph" role="img" aria-label="Chunk dependency graph" viewBox={`0 0 ${width} ${height}`}>
      {props.edges.map((edge) => {
        const from = positions.get(edge.from)
        const to = positions.get(edge.to)
        if (!from || !to) return null
        return (
          <path
            key={`${edge.from}:${edge.to}:${edge.kind}`}
            data-edge={edge.kind}
            d={`M${from.x},${from.y} L${to.x},${to.y}`}
          >
            <title>{edge.kind}</title>
          </path>
        )
      })}
      {props.nodes.map((node) => {
        const point = positions.get(node.id)!
        return (
          <g key={node.id} transform={`translate(${point.x},${point.y})`}>
            <circle r={size(node.value)} />
            <text y={size(node.value) + 12} textAnchor="middle">
              {node.label.slice(0, 24)}
            </text>
            <title>{`${node.label}: ${formatBytes(node.value)}`}</title>
          </g>
        )
      })}
    </svg>
  )
}

export function WaterfallChart(props: { rows: Array<{ id: string; label: string; depth: number; value: number }> }) {
  const width = 720
  const rowHeight = 28
  const height = Math.max(80, props.rows.length * rowHeight + 30)
  const maxValue = d3.max(props.rows, (row) => row.value) ?? 1
  const x = d3.scaleLinear().domain([0, maxValue]).nice().range([0, width - 220])
  const y = d3.scaleBand().domain(props.rows.map((row) => row.id)).range([20, height - 10]).padding(0.16)

  if (props.rows.length === 0) {
    return <p className="empty">No build-time waterfall rows are available.</p>
  }

  return (
    <svg className="waterfall-chart" role="img" aria-label="Build-time dependency waterfall" viewBox={`0 0 ${width} ${height}`}>
      {props.rows.map((row) => {
        const yPosition = y(row.id) ?? 20
        return (
          <g key={row.id} transform={`translate(0,${yPosition})`}>
            <text data-role="label" x={row.depth * 18} y="14">
              {row.label.slice(0, 42)}
            </text>
            <rect data-role="bar" x="220" y="2" width={x(row.value)} height={Math.min(rowHeight - 8, y.bandwidth())} />
            <text x={230 + x(row.value)} y="14">
              {formatBytes(row.value)}
            </text>
          </g>
        )
      })}
    </svg>
  )
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}
