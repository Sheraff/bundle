import type { MiniViz } from "@workspace/contracts"
import type { ReactNode } from "react"

import { formatBytes, formatSignedBytes } from "../lib/formatting.js"
import type { OutputRow, SizeTotals } from "../lib/public-read-models.server.js"
import type { SizeMetric } from "../lib/size-metric.js"
import { StateBadge } from "./state-badge.js"

import "./output-row.css"

export function MiniVizView(props: { miniViz: MiniViz }) {
  const miniViz = props.miniViz

  if (miniViz.kind === "delta-bar") {
    const max = Math.max(miniViz.current, miniViz.baseline, 1)
    const currentWidth = `${Math.max(3, (miniViz.current / max) * 100)}%`
    const baselineWidth = `${Math.max(3, (miniViz.baseline / max) * 100)}%`
    const thresholdLeft = miniViz.threshold ? `${Math.min(100, (miniViz.threshold / max) * 100)}%` : null

    return (
      <div className="mini-viz" data-kind="delta-bar" aria-label="Delta bar">
        <div className="mini-viz-bars">
          <span data-role="baseline" style={{ width: baselineWidth }} />
          <span data-role="current" style={{ width: currentWidth }} />
          {thresholdLeft ? <span data-role="threshold" title={miniViz.policySource} style={{ left: thresholdLeft }} /> : null}
        </div>
        <span className="mini-viz-caption">{formatSignedBytes(miniViz.delta)}</span>
      </div>
    )
  }

  if (miniViz.kind === "sparkline") {
    const values = miniViz.points.map((point) => point.value)
    const min = Math.min(...values)
    const max = Math.max(...values)
    const range = Math.max(1, max - min)
    const lastIndex = Math.max(1, miniViz.points.length - 1)
    const points = miniViz.points
      .map((point, index) => {
        const x = (index / lastIndex) * 100
        const y = 28 - ((point.value - min) / range) * 24
        return `${x},${y}`
      })
      .join(" ")

    return (
      <div className="mini-viz" data-kind="sparkline" aria-label="Recent size sparkline">
        <svg viewBox="0 0 100 32" role="img" aria-label="Recent size sparkline">
          <polyline points={points} />
        </svg>
        <span className="mini-viz-caption">{formatBytes(values.at(-1) ?? 0)}</span>
      </div>
    )
  }

  if (miniViz.kind === "state-strip") {
    return (
      <div className="mini-viz" data-kind="state-strip" aria-label="Recent states">
        {miniViz.states.map((state, index) => <span key={`${state}:${index}`} data-state={state} title={state} />)}
      </div>
    )
  }

  if (miniViz.kind === "status-chip") {
    return (
      <div className="mini-viz" data-kind="status-chip">
        <StateBadge state={miniViz.state} />
        <span className="mini-viz-caption">{miniViz.reason}</span>
      </div>
    )
  }

  return <p className="mini-viz mini-viz-empty">{miniViz.reason}</p>
}

export function OutputRowCard(props: {
  children?: ReactNode
  primaryAction?: ReactNode
  row: OutputRow
}) {
  const row = props.row
  const current = selectedValue(row.currentTotals, row.selectedSize)
  const baseline = selectedValue(row.baselineTotals, row.selectedSize)
  const delta = selectedValue(row.deltaTotals, row.selectedSize)

  return (
    <article className="output-row-card">
      <header>
        <div>
          <p className="eyebrow">Output</p>
          <h3>{row.environment.label} / {row.entrypoint.label}</h3>
        </div>
        <div className="output-row-badges">
          <StateBadge state={row.comparisonState} />
          <StateBadge state={row.measurementState} />
        </div>
      </header>
      <dl className="output-row-metrics">
        <div>
          <dt>Current</dt>
          <dd>{formatMaybeBytes(current)}</dd>
        </div>
        <div>
          <dt>Delta</dt>
          <dd>{delta === null ? "No baseline" : formatSignedBytes(delta)}</dd>
        </div>
        <div>
          <dt>Policy state</dt>
          <dd><StateBadge state={row.policyState} /></dd>
        </div>
      </dl>
      <MiniVizView miniViz={row.miniViz} />
      {props.primaryAction ? <div className="output-row-primary-action">{props.primaryAction}</div> : null}
      <details>
        <summary>Measurement details</summary>
        <dl className="output-row-details">
          <div><dt>What's counted</dt><dd>{row.lens.label}</dd></div>
          <div><dt>Size</dt><dd>{row.selectedSize}</dd></div>
          <div><dt>Baseline</dt><dd>{formatMaybeBytes(baseline)}</dd></div>
          <div><dt>Entrypoint kind</dt><dd>{row.entrypointKind}</dd></div>
          <div><dt>Evidence</dt><dd>{row.evidenceAvailability.state}</dd></div>
          <div><dt>Compatibility</dt><dd>{row.compatibility}</dd></div>
        </dl>
        {row.evidenceAvailability.unavailableReason ? <p className="notice">{row.evidenceAvailability.unavailableReason}</p> : null}
        {props.children}
      </details>
    </article>
  )
}

function selectedValue(totals: SizeTotals | null, size: SizeMetric) {
  return totals?.[size] ?? null
}

function formatMaybeBytes(value: number | null) {
  return value === null ? "Unavailable" : formatBytes(value)
}
