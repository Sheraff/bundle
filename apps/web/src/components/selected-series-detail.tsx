import { formatBytes, formatSignedBytes } from "../lib/formatting.js"
import type {
  DetailAvailability,
  DetailDiffRow,
  SnapshotDetail,
} from "../lib/public-read-models/selected-series-detail.server.js"
import type { SizeMetric } from "../lib/size-metric.js"
import { DependencyGraph, TreemapChart, WaterfallChart } from "./charts.js"

export function SelectedSeriesDetailView(props: {
  detail: DetailAvailability | null
  metric: SizeMetric
  mode: "snapshot" | "compare"
  tab: string
  budgetState?: string | null
  hasDegradedStableIdentity?: boolean
}) {
  if (!props.detail) {
    return <p>Select a full series context (`scenario + env + entrypoint + lens`) to unlock detail tabs.</p>
  }

  if (props.detail.status === "unavailable") {
    return <p>{props.detail.message}</p>
  }

  const snapshot = props.detail.snapshot
  const diffs = props.detail.diffs

  if (props.tab === "treemap") {
    return (
      <>
        <TreemapChart nodes={props.mode === "compare" && diffs ? diffs.treemapNodes : snapshot.treemapNodes} />
        {props.mode === "compare" && diffs ? <DiffTable title="Changed chunks" rows={diffs.chunks} /> : <ChunkTable snapshot={snapshot} />}
      </>
    )
  }

  if (props.tab === "graph") {
    return (
      <>
        <p>This graph shows build-time chunk imports. Dashed edges are dynamic imports.</p>
        <DependencyGraph
          nodes={snapshot.chunks.map((chunk) => ({ id: chunk.fileName, label: chunk.label, value: metricSize(chunk, props.metric) }))}
          edges={snapshot.graphEdges}
        />
        <GraphEdgeTable snapshot={snapshot} />
      </>
    )
  }

  if (props.tab === "waterfall") {
    return (
      <>
        <p>This waterfall is build-time dependency depth, not browser network timing.</p>
        <WaterfallChart rows={snapshot.waterfallRows} />
        <WaterfallTable snapshot={snapshot} />
      </>
    )
  }

  if (props.tab === "assets") {
    return props.mode === "compare" && diffs ? <DiffTable title="Assets" rows={diffs.assets} /> : <AssetTable snapshot={snapshot} />
  }

  if (props.tab === "packages") {
    return props.mode === "compare" && diffs ? <DiffTable title="Packages" rows={diffs.packages} /> : <PackageTable snapshot={snapshot} />
  }

  if (props.tab === "identity") {
    return (
      <>
        <p>Degraded stable identity: {props.hasDegradedStableIdentity ? "yes" : "no"}</p>
        {props.mode === "compare" && diffs ? <DiffTable title="Modules" rows={diffs.modules} /> : <ModuleTable snapshot={snapshot} />}
      </>
    )
  }

  if (props.tab === "budget") {
    return (
      <>
        <p>Budget state: {props.budgetState ?? "not-configured"}</p>
        <p>Budget configuration is reserved in this pass. Rows do not imply evaluation unless the stored budget state says so.</p>
      </>
    )
  }

  return (
    <>
      <ChunkTable snapshot={snapshot} />
      <AssetTable snapshot={snapshot} />
      {snapshot.warnings.length > 0 ? (
        <section>
          <h3>Warnings</h3>
          <ul>{snapshot.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>
        </section>
      ) : null}
    </>
  )
}

function ChunkTable(props: { snapshot: SnapshotDetail }) {
  return (
    <section>
      <h3>Chunks</h3>
      {props.snapshot.chunks.length === 0 ? <p>No chunks are available.</p> : (
        <table>
          <thead><tr><th>Chunk</th><th>Raw</th><th>Gzip</th><th>Brotli</th><th>Modules</th></tr></thead>
          <tbody>{props.snapshot.chunks.map((chunk) => <tr key={chunk.fileName}><td>{chunk.label}</td><td>{formatBytes(chunk.raw)}</td><td>{formatBytes(chunk.gzip)}</td><td>{formatBytes(chunk.brotli)}</td><td>{chunk.moduleCount}</td></tr>)}</tbody>
        </table>
      )}
    </section>
  )
}

function AssetTable(props: { snapshot: SnapshotDetail }) {
  return (
    <section>
      <h3>Assets</h3>
      {props.snapshot.assets.length === 0 ? <p>No assets are attached to this selected entrypoint closure.</p> : (
        <table>
          <thead><tr><th>Asset</th><th>Kind</th><th>Raw</th><th>Gzip</th><th>Brotli</th></tr></thead>
          <tbody>{props.snapshot.assets.map((asset) => <tr key={asset.fileName}><td>{asset.fileName}</td><td>{asset.kind}</td><td>{formatBytes(asset.raw)}</td><td>{formatBytes(asset.gzip)}</td><td>{formatBytes(asset.brotli)}</td></tr>)}</tbody>
        </table>
      )}
    </section>
  )
}

function PackageTable(props: { snapshot: SnapshotDetail }) {
  return (
    <section>
      <h3>Packages</h3>
      {props.snapshot.packages.length === 0 ? <p>No package attribution is available for this snapshot.</p> : (
        <table>
          <thead><tr><th>Package</th><th>Modules</th><th>Rendered</th></tr></thead>
          <tbody>{props.snapshot.packages.map((pkg) => <tr key={pkg.packageName}><td>{pkg.packageName}</td><td>{pkg.moduleCount}</td><td>{formatBytes(pkg.renderedLength)}</td></tr>)}</tbody>
        </table>
      )}
    </section>
  )
}

function ModuleTable(props: { snapshot: SnapshotDetail }) {
  return (
    <section>
      <h3>Modules</h3>
      {props.snapshot.modules.length === 0 ? <p>No modules are available.</p> : (
        <table>
          <thead><tr><th>Module</th><th>Scope</th><th>Rendered</th></tr></thead>
          <tbody>{props.snapshot.modules.map((module) => <tr key={module.stableId}><td>{module.rawId}</td><td>{module.scope}</td><td>{formatBytes(module.renderedLength)}</td></tr>)}</tbody>
        </table>
      )}
    </section>
  )
}

function GraphEdgeTable(props: { snapshot: SnapshotDetail }) {
  return props.snapshot.graphEdges.length === 0 ? <p>No chunk import edges are available for this selected closure.</p> : (
    <table>
      <thead><tr><th>From</th><th>Kind</th><th>To</th></tr></thead>
      <tbody>{props.snapshot.graphEdges.map((edge) => <tr key={`${edge.from}:${edge.to}:${edge.kind}`}><td>{edge.from}</td><td>{edge.kind}</td><td>{edge.to}</td></tr>)}</tbody>
    </table>
  )
}

function WaterfallTable(props: { snapshot: SnapshotDetail }) {
  return props.snapshot.waterfallRows.length === 0 ? <p>No waterfall rows are available.</p> : (
    <table>
      <thead><tr><th>Depth</th><th>Chunk</th><th>Size</th></tr></thead>
      <tbody>{props.snapshot.waterfallRows.map((row) => <tr key={row.id}><td>{row.depth}</td><td>{row.label}</td><td>{formatBytes(row.value)}</td></tr>)}</tbody>
    </table>
  )
}

function DiffTable(props: { title: string; rows: DetailDiffRow[] }) {
  return (
    <section>
      <h3>{props.title}</h3>
      {props.rows.length === 0 ? <p>No comparable rows are available.</p> : (
        <table>
          <thead><tr><th>Name</th><th>State</th><th>Current</th><th>Baseline</th><th>Delta</th></tr></thead>
          <tbody>{props.rows.map((row) => <tr key={`${row.kind}:${row.key}`}><td>{row.label}</td><td>{row.state}</td><td>{formatBytes(row.current)}</td><td>{formatBytes(row.baseline)}</td><td>{formatSignedBytes(row.delta)}</td></tr>)}</tbody>
        </table>
      )}
    </section>
  )
}

function metricSize(row: { raw: number; gzip: number; brotli: number }, metric: SizeMetric) {
  if (metric === "raw") return row.raw
  if (metric === "gzip") return row.gzip
  return row.brotli
}
