import type { ReactNode } from "react"

import { formatBytes, formatSignedBytes } from "../lib/formatting.js"
import type {
  DetailAvailability,
  DetailDiffRow,
  SnapshotDetail,
  TreemapTimeline,
} from "../lib/public-read-models/selected-series-detail.server.js"
import type { SizeMetric } from "../lib/size-metric.js"
import { DependencyGraph, TreemapChart, TreemapTimelineScrubber, WaterfallChart } from "./charts.js"
import { StateBadge } from "./state-badge.js"

import "./selected-series-detail.css"

export type ExpertVisualizerContext = {
  baselineRef?: string | null
  currentRef?: string | null
  entrypoint?: string | null
  environment?: string | null
  lens?: string | null
  scenario?: string | null
}

export function SelectedSeriesDetailView(props: {
  context?: ExpertVisualizerContext
  detail: DetailAvailability | null
  metric: SizeMetric
  mode: "snapshot" | "compare"
  tab: string
  treemapTimeline?: TreemapTimeline | null
  budgetState?: string | null
  hasDegradedStableIdentity?: boolean
}) {
  if (!props.detail) {
    return (
      <p className="notice">
        Select a full series context (<code>scenario + env + entrypoint + lens</code>) to unlock detail tabs.
      </p>
    )
  }

  if (props.detail.status === "unavailable") {
    return (
      <ExpertVisualizerShell context={props.context} detailStatus="unavailable" metric={props.metric} mode={props.mode} tab={props.tab}>
        <p className="notice">{props.detail.message}</p>
      </ExpertVisualizerShell>
    )
  }

  const snapshot = props.detail.snapshot
  const diffs = props.detail.diffs
  let content

  if (props.tab === "treemap") {
    const timeline = props.treemapTimeline
    const showTimeline = timeline && timeline.frames.length > 1

    content = (
      <div className="series-detail">
        {showTimeline ? <TreemapTimelineScrubber key={timeline.frames.map((frame) => frame.nodesUrl).join(":")} timeline={timeline} /> : null}
        {props.mode === "compare" && diffs ? <h3>Comparison delta</h3> : null}
        {showTimeline && props.mode === "snapshot" ? null : <TreemapChart nodes={props.mode === "compare" && diffs ? diffs.treemapNodes : snapshot.treemapNodes} />}
        {props.mode === "compare" && diffs ? <DiffTable title="Changed chunks" rows={diffs.chunks} /> : <ChunkTable snapshot={snapshot} />}
      </div>
    )
  } else if (props.tab === "graph") {
    content = (
      <div className="series-detail">
        <p data-role="hint">This graph shows build-time chunk imports. Dashed edges are dynamic imports.</p>
        <DependencyGraph
          nodes={snapshot.chunks.map((chunk) => ({ id: chunk.fileName, label: chunk.label, value: metricSize(chunk, props.metric) }))}
          edges={snapshot.graphEdges}
        />
        <GraphEdgeTable snapshot={snapshot} />
      </div>
    )
  } else if (props.tab === "waterfall") {
    content = (
      <div className="series-detail">
        <p data-role="hint">This waterfall is build-time dependency depth, not browser network timing.</p>
        <WaterfallChart rows={snapshot.waterfallRows} />
        <WaterfallTable snapshot={snapshot} />
      </div>
    )
  } else if (props.tab === "assets") {
    content = (
      <div className="series-detail">
        {props.mode === "compare" && diffs ? <DiffTable title="Assets" rows={diffs.assets} /> : <AssetTable snapshot={snapshot} />}
      </div>
    )
  } else if (props.tab === "packages") {
    content = (
      <div className="series-detail">
        {props.mode === "compare" && diffs ? <DiffTable title="Packages" rows={diffs.packages} /> : <PackageTable snapshot={snapshot} />}
      </div>
    )
  } else if (props.tab === "identity") {
    content = (
      <div className="series-detail">
        <p>
          Degraded stable identity:{" "}
          <StateBadge state={props.hasDegradedStableIdentity ? "warning" : "fresh"} />
        </p>
        {props.mode === "compare" && diffs ? <DiffTable title="Modules" rows={diffs.modules} /> : <ModuleTable snapshot={snapshot} />}
      </div>
    )
  } else if (props.tab === "budget") {
    content = (
      <div className="series-detail">
        <p>
          Budget state: <StateBadge state={props.budgetState ?? "missing"} />
        </p>
        <p data-role="hint">
          Budget configuration is reserved in this pass. Rows do not imply evaluation unless the stored budget state says so.
        </p>
      </div>
    )
  } else {
    content = (
      <div className="series-detail">
        <ChunkTable snapshot={snapshot} />
        <AssetTable snapshot={snapshot} />
        {snapshot.warnings.length > 0 ? (
          <section className="section">
            <h3>Warnings</h3>
            <ul className="bulleted">{snapshot.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>
          </section>
        ) : null}
      </div>
    )
  }

  return (
    <ExpertVisualizerShell context={props.context} detailStatus="available" metric={props.metric} mode={props.mode} tab={props.tab}>
      {content}
    </ExpertVisualizerShell>
  )
}

function ExpertVisualizerShell(props: {
  children: ReactNode
  context?: ExpertVisualizerContext
  detailStatus: "available" | "unavailable"
  metric: SizeMetric
  mode: "snapshot" | "compare"
  tab: string
}) {
  return (
    <section className="expert-visualizer" aria-label="Expert visualizer" data-status={props.detailStatus}>
      <header>
        <p className="eyebrow">Expert visualizer</p>
        <h3>{expertContextTitle(props.context, props.metric)}</h3>
        <p>{expertRefLabel(props.context, props.mode)}</p>
      </header>
      <nav className="intent-rail" aria-label="Expert analysis intents">
        <span data-active={props.tab === "treemap"}>Where size lives <strong>Treemap</strong></span>
        <span data-active={props.tab === "waterfall"}>What changed <strong>Bundle waterfall</strong></span>
        <span data-active={props.tab === "graph"}>How modules connect <strong>Module graph</strong></span>
        <span data-active={props.tab === "assets" || props.tab === "packages"}>Which assets/packages changed <strong>Tables</strong></span>
      </nav>
      <AttributionBanner mode={props.mode} status={props.detailStatus} />
      {props.children}
    </section>
  )
}

function AttributionBanner(props: { mode: "snapshot" | "compare"; status: "available" | "unavailable" }) {
  const state = props.status === "unavailable" ? "unavailable" : props.mode === "compare" ? "partial attribution" : "full attribution"

  return (
    <div className="attribution-banner">
      <StateBadge state={state} />
      <p>Attribution is reported at asset, chunk, module, and package level when available. Module-level attribution only. Source-line attribution is unavailable because sourcemaps are not uploaded in V1.</p>
    </div>
  )
}

function expertContextTitle(context: ExpertVisualizerContext | undefined, metric: SizeMetric) {
  return [
    context?.scenario ?? "Selected scenario",
    context?.environment ?? "selected environment",
    context?.entrypoint ?? "selected entrypoint",
    context?.lens ?? "selected What's counted",
    metric,
  ].join(" · ")
}

function expertRefLabel(context: ExpertVisualizerContext | undefined, mode: "snapshot" | "compare") {
  const current = context?.currentRef ?? "current ref"
  const baseline = context?.baselineRef

  if (mode === "compare" && baseline) return `${baseline} -> ${current}`
  return current
}

function ChunkTable(props: { snapshot: SnapshotDetail }) {
  return (
    <section className="section">
      <h3>Chunks</h3>
      {props.snapshot.chunks.length === 0 ? (
        <p className="notice">No chunks are available.</p>
      ) : (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Chunk</th>
                <th>Raw</th>
                <th>Gzip</th>
                <th>Brotli</th>
                <th>Modules</th>
              </tr>
            </thead>
            <tbody>
              {props.snapshot.chunks.map((chunk) => (
                <tr key={chunk.fileName}>
                  <td className="mono">{chunk.label}</td>
                  <td className="num">{formatBytes(chunk.raw)}</td>
                  <td className="num">{formatBytes(chunk.gzip)}</td>
                  <td className="num">{formatBytes(chunk.brotli)}</td>
                  <td className="num">{chunk.moduleCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

function AssetTable(props: { snapshot: SnapshotDetail }) {
  return (
    <section className="section">
      <h3>Assets</h3>
      {props.snapshot.assets.length === 0 ? (
        <p className="notice">No assets are attached to this selected entrypoint closure.</p>
      ) : (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Asset</th>
                <th>Kind</th>
                <th>Raw</th>
                <th>Gzip</th>
                <th>Brotli</th>
              </tr>
            </thead>
            <tbody>
              {props.snapshot.assets.map((asset) => (
                <tr key={asset.fileName}>
                  <td className="mono">{asset.fileName}</td>
                  <td>{asset.kind}</td>
                  <td className="num">{formatBytes(asset.raw)}</td>
                  <td className="num">{formatBytes(asset.gzip)}</td>
                  <td className="num">{formatBytes(asset.brotli)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

function PackageTable(props: { snapshot: SnapshotDetail }) {
  return (
    <section className="section">
      <h3>Packages</h3>
      {props.snapshot.packages.length === 0 ? (
        <p className="notice">No package attribution is available for this snapshot.</p>
      ) : (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Package</th>
                <th>Modules</th>
                <th>Rendered</th>
              </tr>
            </thead>
            <tbody>
              {props.snapshot.packages.map((pkg) => (
                <tr key={pkg.packageName}>
                  <td className="mono">{pkg.packageName}</td>
                  <td className="num">{pkg.moduleCount}</td>
                  <td className="num">{formatBytes(pkg.renderedLength)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

function ModuleTable(props: { snapshot: SnapshotDetail }) {
  return (
    <section className="section">
      <h3>Modules</h3>
      {props.snapshot.modules.length === 0 ? (
        <p className="notice">No modules are available.</p>
      ) : (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Module</th>
                <th>Scope</th>
                <th>Rendered</th>
              </tr>
            </thead>
            <tbody>
              {props.snapshot.modules.map((module) => (
                <tr key={module.stableId}>
                  <td className="mono">{module.rawId}</td>
                  <td>{module.scope}</td>
                  <td className="num">{formatBytes(module.renderedLength)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

function GraphEdgeTable(props: { snapshot: SnapshotDetail }) {
  return props.snapshot.graphEdges.length === 0 ? (
    <p className="notice">No chunk import edges are available for this selected closure.</p>
  ) : (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            <th>From</th>
            <th>Kind</th>
            <th>To</th>
          </tr>
        </thead>
        <tbody>
          {props.snapshot.graphEdges.map((edge) => (
            <tr key={`${edge.from}:${edge.to}:${edge.kind}`}>
              <td className="mono">{edge.from}</td>
              <td>{edge.kind}</td>
              <td className="mono">{edge.to}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function WaterfallTable(props: { snapshot: SnapshotDetail }) {
  return props.snapshot.waterfallRows.length === 0 ? (
    <p className="notice">No waterfall rows are available.</p>
  ) : (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            <th>Depth</th>
            <th>Chunk</th>
            <th>Size</th>
          </tr>
        </thead>
        <tbody>
          {props.snapshot.waterfallRows.map((row) => (
            <tr key={row.id}>
              <td className="num">{row.depth}</td>
              <td className="mono">{row.label}</td>
              <td className="num">{formatBytes(row.value)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function DiffTable(props: { title: string; rows: DetailDiffRow[] }) {
  return (
    <section className="section">
      <h3>{props.title}</h3>
      {props.rows.length === 0 ? (
        <p className="notice">No comparable rows are available.</p>
      ) : (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>State</th>
                <th>Current</th>
                <th>Baseline</th>
                <th>Delta</th>
              </tr>
            </thead>
            <tbody>
              {props.rows.map((row) => (
                <tr key={`${row.kind}:${row.key}`}>
                  <td className="mono">{row.label}</td>
                  <td data-state={row.state}>{row.state}</td>
                  <td className="num">{formatBytes(row.current)}</td>
                  <td className="num">{formatBytes(row.baseline)}</td>
                  <td className="num" data-state={row.state}>{formatSignedBytes(row.delta)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

function metricSize(row: { raw: number; gzip: number; brotli: number }, metric: SizeMetric) {
  if (metric === "raw") return row.raw
  if (metric === "gzip") return row.gzip
  return row.brotli
}
