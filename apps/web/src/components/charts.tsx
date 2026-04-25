import * as d3 from "d3"

import { formatBytes, shortSha } from "../lib/formatting.js"

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
    return <p>No graph points are available.</p>
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
  const color = d3.scaleOrdinal(d3.schemeTableau10).domain(props.series.map((series) => series.id))
  const line = d3
    .line<TrendChartSeries["points"][number]>()
    .x((point) => x(point.commitSha) ?? margin.left)
    .y((point) => y(point.value))

  return (
    <figure>
      <svg role="img" aria-label="Bundle size trend graph" viewBox={`0 0 ${width} ${height}`} width="100%">
        <line x1={margin.left} x2={width - margin.right} y1={height - margin.bottom} y2={height - margin.bottom} stroke="currentColor" />
        <line x1={margin.left} x2={margin.left} y1={margin.top} y2={height - margin.bottom} stroke="currentColor" />
        {y.ticks(4).map((tick) => (
          <g key={tick}>
            <line x1={margin.left - 4} x2={width - margin.right} y1={y(tick)} y2={y(tick)} stroke="currentColor" strokeOpacity={0.15} />
            <text x={margin.left - 8} y={y(tick)} textAnchor="end" dominantBaseline="middle" fontSize="11">
              {formatBytes(tick)}
            </text>
          </g>
        ))}
        {orderedCommits.map((point) => (
          <text key={point.commitSha} x={x(point.commitSha)} y={height - 12} textAnchor="middle" fontSize="10">
            {shortSha(point.commitSha)}
          </text>
        ))}
        {props.series.map((series) => (
          <path key={series.id} d={line(series.points) ?? undefined} fill="none" stroke={color(series.id)} strokeWidth="2" />
        ))}
        {points.map((point) => (
          <circle key={`${point.series.id}:${point.commitSha}:${point.measuredAt}`} cx={x(point.commitSha)} cy={y(point.value)} r="3">
            <title>{`${point.series.label}: ${formatBytes(point.value)} at ${shortSha(point.commitSha)}`}</title>
          </circle>
        ))}
      </svg>
      <figcaption>
        {props.series.map((series) => (
          <span key={series.id} style={{ marginRight: "1rem" }}>
            <svg aria-hidden="true" width="12" height="12"><rect width="12" height="12" fill={color(series.id)} /></svg> {series.label}
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
}

export function TreemapChart(props: { nodes: TreemapNode[] }) {
  const width = 720
  const height = 320
  const parentIds = new Set(props.nodes.flatMap((node) => node.parentId ? [node.parentId] : []))
  const nodes = props.nodes.filter((node) => node.value > 0 || node.parentId === null || parentIds.has(node.id))

  if (nodes.length <= 1) {
    return <p>No treemap nodes are available for the selected series.</p>
  }

  const internalIds = new Set(nodes.flatMap((node) => node.parentId ? [node.parentId] : []))
  const root = d3
    .stratify<TreemapNode>()
    .id((node) => node.id)
    .parentId((node) => node.parentId)(nodes)
    .sum((node) => node.value)
    .sort((left, right) => (right.value ?? 0) - (left.value ?? 0))
  d3.treemap<TreemapNode>().size([width, height]).paddingInner(1).paddingOuter(1)(root)
  const internalNodes = root
    .descendants()
    .filter((node) => node.depth > 0 && internalIds.has(node.id ?? "")) as Array<d3.HierarchyRectangularNode<TreemapNode>>
  const leaves = root.leaves() as Array<d3.HierarchyRectangularNode<TreemapNode>>
  const color = d3.scaleOrdinal(d3.schemeTableau10).domain([...new Set([...internalNodes, ...leaves].map((node) => node.data.kind))])

  return (
    <svg role="img" aria-label="Bundle composition treemap" viewBox={`0 0 ${width} ${height}`} width="100%">
      {internalNodes.map((node, index) => {
        const rectWidth = Math.max(0, node.x1 - node.x0)
        const rectHeight = Math.max(0, node.y1 - node.y0)
        const labelLines = treemapLabelLines(node.data.label, rectWidth, rectHeight)

        return (
          <g key={node.id} transform={`translate(${node.x0},${node.y0})`}>
            <clipPath id={`treemap-parent-label-${index}`}>
              <rect width={rectWidth} height={rectHeight} />
            </clipPath>
            <rect width={rectWidth} height={rectHeight} fill={color(node.data.kind)} fillOpacity="0.22" />
            {labelLines.length > 0 ? (
              <text x="5" y="14" fontSize="11" fontWeight="600" clipPath={`url(#treemap-parent-label-${index})`} pointerEvents="none">
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

        return (
          <g key={leaf.id} transform={`translate(${leaf.x0},${leaf.y0})`}>
            <clipPath id={`treemap-label-${index}`}>
              <rect width={rectWidth} height={rectHeight} />
            </clipPath>
            <rect width={rectWidth} height={rectHeight} fill={color(leaf.data.kind)} fillOpacity={leaf.data.state === "removed" ? 0.35 : 0.75} />
            {labelLines.length > 0 ? (
              <text x="5" y="14" fontSize="11" fontWeight="600" clipPath={`url(#treemap-label-${index})`} pointerEvents="none">
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
    return <p>No dependency graph nodes are available.</p>
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
    <svg role="img" aria-label="Chunk dependency graph" viewBox={`0 0 ${width} ${height}`} width="100%">
      {props.edges.map((edge) => {
        const from = positions.get(edge.from)
        const to = positions.get(edge.to)
        if (!from || !to) return null
        return (
          <path key={`${edge.from}:${edge.to}:${edge.kind}`} d={`M${from.x},${from.y} L${to.x},${to.y}`} fill="none" stroke="currentColor" strokeOpacity={edge.kind === "dynamic-import" ? 0.4 : 0.8} strokeDasharray={edge.kind === "dynamic-import" ? "4 3" : undefined}>
            <title>{edge.kind}</title>
          </path>
        )
      })}
      {props.nodes.map((node) => {
        const point = positions.get(node.id)!
        return (
          <g key={node.id} transform={`translate(${point.x},${point.y})`}>
            <circle r={size(node.value)} fill="white" stroke="currentColor" />
            <text y={size(node.value) + 12} textAnchor="middle" fontSize="10">
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
    return <p>No build-time waterfall rows are available.</p>
  }

  return (
    <svg role="img" aria-label="Build-time dependency waterfall" viewBox={`0 0 ${width} ${height}`} width="100%">
      {props.rows.map((row) => {
        const yPosition = y(row.id) ?? 20
        return (
          <g key={row.id} transform={`translate(0,${yPosition})`}>
            <text x={row.depth * 18} y="14" fontSize="11">
              {row.label.slice(0, 42)}
            </text>
            <rect x="220" y="2" width={x(row.value)} height={Math.min(rowHeight - 8, y.bandwidth())} fill="currentColor" fillOpacity="0.65" />
            <text x={230 + x(row.value)} y="14" fontSize="11">
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
