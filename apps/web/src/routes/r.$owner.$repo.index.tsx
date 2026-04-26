import {
  DEFAULT_LENS_SLUG,
  nonEmptyStringSchema,
  publicRepositoryRouteParamsSchema,
  type MiniViz,
} from "@workspace/contracts"
import { Link, createFileRoute } from "@tanstack/react-router"
import { createServerFn } from "@tanstack/react-start"
import * as v from "valibot"

import { MiniVizView } from "../components/output-row.js"
import { StateBadge } from "../components/state-badge.js"
import { getRepositoryOverviewPageData } from "../lib/public-read-models.server.js"
import { formatBytes, formatSignedBytes, shortSha } from "../lib/formatting.js"
import type { SizeMetric } from "../lib/size-metric.js"

import "./repo-shared.css"

const densitySchema = v.union([v.literal("cards"), v.literal("list")])

const repositoryOverviewSearchSchema = v.strictObject({
  branch: v.optional(nonEmptyStringSchema),
  density: v.optional(densitySchema, "cards"),
  lens: v.optional(nonEmptyStringSchema, DEFAULT_LENS_SLUG),
  metric: v.optional(nonEmptyStringSchema),
})

const getRepositoryOverview = createServerFn({ method: "GET" })
  .inputValidator(
    v.strictObject({
      params: publicRepositoryRouteParamsSchema,
      search: repositoryOverviewSearchSchema,
    }),
  )
  .handler(({ data, context }) =>
    getRepositoryOverviewPageData(context.env, {
      owner: data.params.owner,
      repo: data.params.repo,
      branch: data.search.branch,
      lens: data.search.lens,
      metric: data.search.metric,
    }),
  )

export const Route = createFileRoute("/r/$owner/$repo/")({
  validateSearch: repositoryOverviewSearchSchema,
  loaderDeps: ({ search }) => search,
  loader: ({ params, deps }) =>
    getRepositoryOverview({
      data: {
        params,
        search: deps,
      },
    }),
  component: RepositoryOverviewRouteComponent,
})

type RepositoryOverviewData = ReturnType<typeof Route.useLoaderData>
type RepositoryScenarioCatalogRow = RepositoryOverviewData["scenarioCatalog"][number]
type ScenarioOutputRow = RepositoryOverviewData["scenarioOutputRows"][number]

type ScenarioGroup = "attention" | "recent" | "uncovered" | "stale" | "healthy"

type ScenarioCard = {
  branch?: string
  group: ScenarioGroup
  key: string
  lastRun: string | null
  miniViz: MiniViz
  outputRows: ScenarioOutputRow[]
  scenarioId: string
  slug: string
  sourceKind: string
  state: string
}

function RepositoryOverviewRouteComponent() {
  const data = Route.useLoaderData()
  const search = Route.useSearch()
  const density = search.density === "list" ? "list" : "cards"
  const scenarioCards = buildScenarioCards(data)
  const groups: Array<{ empty: string; group: ScenarioGroup; title: string }> = [
    { group: "attention", title: "Needs attention", empty: "No scenarios need attention for this view." },
    { group: "recent", title: "Recently changed", empty: "No scenarios changed for the selected size." },
    { group: "uncovered", title: "Uncovered / no policy", empty: "Every current scenario has policy context." },
    { group: "stale", title: "Stale / missing", empty: "No stale or missing scenarios in this view." },
    { group: "healthy", title: "Healthy", empty: "No fully healthy scenarios yet." },
  ]

  return (
    <main className="page repo-page scenario-home">
      <header className="page-header">
        <p className="breadcrumb">
          <Link to="/">Home</Link>
          <span aria-hidden="true">/</span>
          <span>Scenarios</span>
        </p>
        <h1>
          Scenarios for <span data-owner>{data.repository.owner}</span><span data-sep aria-hidden="true">/</span>{data.repository.name}
        </h1>
        <p>Scenarios are reproducible bundle targets. Each scenario can produce outputs, and each output can be measured by one or more byte-counting modes.</p>
        <nav aria-label="Repository views" className="repo-subnav">
          <a aria-current="page">Scenarios</a>
          <Link
            to="/r/$owner/$repo/history"
            params={{ owner: data.repository.owner, repo: data.repository.name }}
            search={{ branch: data.branch ?? undefined, scenario: "all", env: "all", entrypoint: "all", lens: data.lens, metric: data.metric }}
          >
            History
          </Link>
        </nav>
      </header>

      <ScenarioViewContext data={data} density={density} />

      {scenarioCards.length === 0 ? <FirstRunScenarioState /> : (
        <>
          {groups.map((group) => (
            <ScenarioGroupSection
              key={group.group}
              cards={scenarioCards.filter((card) => card.group === group.group)}
              density={density}
              empty={group.empty}
              title={group.title}
            />
          ))}
        </>
      )}
    </main>
  )
}

function ScenarioViewContext(props: { data: RepositoryOverviewData; density: "cards" | "list" }) {
  const data = props.data

  return (
    <section className="section scenario-view-context" aria-labelledby="scenario-view-context-heading">
      <div>
        <p className="eyebrow">Scenario view</p>
        <h2 id="scenario-view-context-heading">What this page is measuring</h2>
      </div>
      <dl className="context-summary">
        <div><dt>Branch</dt><dd>{data.branch ?? "No branch yet"}</dd></div>
        <div><dt>What's counted</dt><dd>{data.lens}</dd></div>
        <div><dt>Size</dt><dd>{data.metric}</dd></div>
        <div><dt>Latest commit</dt><dd>{data.latestSummary ? shortSha(data.latestSummary.commitSha) : "none"}</dd></div>
      </dl>
      <div className="scenario-control-row">
        <ControlLinks label="Branch" values={data.branchOptions} current={data.branch} toSearch={(branch) => ({ branch })} />
        <ControlLinks label="What's counted" values={data.lensOptions} current={data.lens} toSearch={(lens) => ({ lens })} />
        <ControlLinks label="Size" values={["raw", "gzip", "brotli"]} current={data.metric} toSearch={(metric) => ({ metric })} />
        <span className="density-toggle" aria-label="Density">
          <Link from={Route.fullPath} replace resetScroll={false} to="." search={(prev) => ({ ...prev, density: "cards" })} aria-current={props.density === "cards" ? "page" : undefined}>Cards</Link>
          <Link from={Route.fullPath} replace resetScroll={false} to="." search={(prev) => ({ ...prev, density: "list" })} aria-current={props.density === "list" ? "page" : undefined}>List</Link>
        </span>
      </div>
    </section>
  )
}

function ControlLinks(props: {
  current?: string | null
  label: string
  toSearch: (value: string) => Record<string, string>
  values: string[]
}) {
  if (props.values.length === 0) return null

  return (
    <span className="scenario-control-group">
      <span>{props.label}</span>
      {props.values.map((value) => (
        <Link
          key={value}
          from={Route.fullPath}
          replace
          resetScroll={false}
          to="."
          search={(prev) => ({ ...prev, ...props.toSearch(value) })}
          aria-current={props.current === value ? "page" : undefined}
        >
          {value}
        </Link>
      ))}
    </span>
  )
}

function FirstRunScenarioState() {
  return (
    <section className="section first-run-state">
      <p className="eyebrow">First run</p>
      <h2>Set up your first tracked scenario</h2>
      <p>Scenarios are what Chunk Scope tracks. Each scenario can produce outputs, and each output can be measured using one or more byte-counting modes.</p>
      <ol className="setup-steps">
        <li><span>Detected</span> Captured Vite scenarios from uploaded artifacts.</li>
        <li><span>Selected</span> Choose tracked scenarios or add synthetic export scenarios.</li>
        <li><span>Configured</span> Confirm outputs, choose a default What's counted mode, and optionally add a policy.</li>
      </ol>
      <Link className="button-secondary" to="/r/$owner/$repo/settings" params={{ owner: Route.useLoaderData().repository.owner, repo: Route.useLoaderData().repository.name }}>Open setup</Link>
    </section>
  )
}

function ScenarioGroupSection(props: {
  cards: ScenarioCard[]
  density: "cards" | "list"
  empty: string
  title: string
}) {
  return (
    <section className="section scenario-group-section">
      <header className="section-heading-row">
        <h2>{props.title}</h2>
        <span>{props.cards.length}</span>
      </header>
      {props.cards.length === 0 ? <p className="notice">{props.empty}</p> : (
        <div className={props.density === "list" ? "scenario-card-list" : "scenario-card-grid"}>
          {props.cards.map((card) => <ScenarioCardView key={card.key} card={card} />)}
        </div>
      )}
    </section>
  )
}

function ScenarioCardView(props: { card: ScenarioCard }) {
  const data = Route.useLoaderData()
  const outputCount = unique(props.card.outputRows.map((row) => `${row.environment.key}/${row.entrypoint.key}`)).length
  const environmentCount = unique(props.card.outputRows.map((row) => row.environment.key)).length
  const lensCount = unique(props.card.outputRows.map((row) => row.lens.id)).length
  const primaryRow = props.card.outputRows[0]
  const current = primaryRow ? selectedValue(primaryRow.currentTotals, primaryRow.selectedSize) : null
  const delta = primaryRow ? selectedValue(primaryRow.deltaTotals, primaryRow.selectedSize) : null

  return (
    <article className="scenario-card">
      <header>
        <div>
          <p className="eyebrow">{props.card.sourceKind}</p>
          <h3>{props.card.slug}</h3>
        </div>
        <StateBadge state={props.card.state} />
      </header>
      <dl className="scenario-card-stats">
        <div><dt>Policy coverage</dt><dd>{policyCoverageLabel(props.card.outputRows)}</dd></div>
        <div><dt>Environments</dt><dd>{environmentCount}</dd></div>
        <div><dt>Outputs</dt><dd>{outputCount}</dd></div>
        <div><dt>What's counted</dt><dd>{lensCount}</dd></div>
        <div><dt>Last run</dt><dd>{props.card.lastRun ?? "No run yet"}</dd></div>
        <div><dt>Current</dt><dd>{current === null ? "Unavailable" : formatBytes(current)}</dd></div>
        <div><dt>Delta</dt><dd>{delta === null ? "No baseline" : formatSignedBytes(delta)}</dd></div>
      </dl>
      <MiniVizView miniViz={props.card.miniViz} />
      <div className="row-actions">
        <Link
          to="/r/$owner/$repo/scenarios/$scenario"
          params={{ owner: data.repository.owner, repo: data.repository.name, scenario: props.card.slug }}
          search={{ branch: props.card.branch, env: "all", entrypoint: "all", lens: data.lens, metric: data.metric }}
        >
          Open scenario
        </Link>
      </div>
    </article>
  )
}

function buildScenarioCards(data: RepositoryOverviewData): ScenarioCard[] {
  return data.scenarioCatalog.map((row: RepositoryScenarioCatalogRow) => {
    const outputRows = row.kind === "fresh"
      ? data.scenarioOutputRows.filter((outputRow: ScenarioOutputRow) => outputRow.scenario.id === row.scenario.scenarioId)
      : []
    const base = scenarioCardBase(row, outputRows, data.branch ?? undefined)

    return {
      ...base,
      group: scenarioGroupFor(row, outputRows),
      miniViz: primaryMiniViz(row, outputRows),
    }
  })
}

function scenarioCardBase(row: RepositoryScenarioCatalogRow, outputRows: ScenarioOutputRow[], branch?: string): Omit<ScenarioCard, "group" | "miniViz"> {
  if (row.kind === "fresh") {
    return {
      branch,
      key: `fresh:${row.scenario.scenarioId}`,
      lastRun: row.scenario.activeUploadedAt,
      outputRows,
      scenarioId: row.scenario.scenarioId,
      slug: row.scenario.scenarioSlug,
      sourceKind: row.scenario.sourceKind,
      state: row.scenario.hasNewerFailedRun ? "warning" : "fresh",
    }
  }

  if (row.kind === "status") {
    return {
      branch,
      key: `status:${row.scenario.scenarioId}`,
      lastRun: "sourceUploadedAt" in row.scenario ? row.scenario.sourceUploadedAt : row.scenario.latestFailedAt,
      outputRows,
      scenarioId: row.scenario.scenarioId,
      slug: row.scenario.scenarioSlug,
      sourceKind: row.scenario.sourceKind,
      state: row.scenario.state,
    }
  }

  return {
    branch,
    key: `known:${row.scenario.id}`,
    lastRun: null,
    outputRows,
    scenarioId: row.scenario.id,
    slug: row.scenario.slug,
    sourceKind: row.scenario.sourceKind,
    state: "known",
  }
}

function scenarioGroupFor(row: RepositoryScenarioCatalogRow, outputRows: ScenarioOutputRow[]): ScenarioGroup {
  if (row.kind === "status") return "stale"
  if (row.kind === "known") return "stale"
  if (row.scenario.hasNewerFailedRun || outputRows.some((outputRow) => outputRow.measurementState === "failed")) return "attention"
  if (outputRows.some((outputRow) => outputRow.policyState === "not_configured")) return "uncovered"
  if (outputRows.some((outputRow) => hasSelectedDelta(outputRow))) return "recent"
  return "healthy"
}

function primaryMiniViz(row: RepositoryScenarioCatalogRow, outputRows: ScenarioOutputRow[]): MiniViz {
  const primary = outputRows[0]
  if (primary) return primary.miniViz
  if (row.kind === "status") return { kind: "status-chip", state: row.scenario.state, reason: "Scenario has no current output row." }
  return { kind: "status-chip", state: "known", reason: "Awaiting first processed measurement." }
}

function hasSelectedDelta(row: ScenarioOutputRow) {
  const delta = selectedValue(row.deltaTotals, row.selectedSize)
  return delta !== null && delta !== 0
}

function selectedValue(totals: { raw: number | null; gzip: number | null; brotli: number | null } | null, size: SizeMetric) {
  return totals?.[size] ?? null
}

function policyCoverageLabel(rows: ScenarioOutputRow[]) {
  if (rows.length === 0) return "No output yet"
  return rows.every((row) => row.policyState === "not_configured") ? "No policy" : "Configured"
}

function unique(values: string[]) {
  return [...new Set(values)]
}
