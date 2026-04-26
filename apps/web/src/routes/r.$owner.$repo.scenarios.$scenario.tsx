import {
  DEFAULT_LENS_SLUG,
  nonEmptyStringSchema,
  publicScenarioRouteParamsSchema,
} from "@workspace/contracts"
import { Link, createFileRoute } from "@tanstack/react-router"
import { createServerFn } from "@tanstack/react-start"
import * as v from "valibot"

import { TrendChart, type TrendChartSeries } from "../components/charts.js"
import { OutputRowCard } from "../components/output-row.js"
import { SelectedSeriesDetailView } from "../components/selected-series-detail.js"
import { StateBadge } from "../components/state-badge.js"
import { TabSelector } from "../components/url-controls.js"
import { getScenarioPageData } from "../lib/public-read-models.server.js"
import { shortSha } from "../lib/formatting.js"
import { describeStatusScenarioDetail } from "../lib/public-route-presentation.js"

import "./repo-shared.css"

const scenarioTabs = ["history", "treemap", "graph", "waterfall", "assets", "packages", "budget"] as const

const scenarioPageSearchSchema = v.strictObject({
  branch: v.optional(nonEmptyStringSchema),
  env: v.optional(nonEmptyStringSchema, "all"),
  entrypoint: v.optional(nonEmptyStringSchema, "all"),
  lens: v.optional(nonEmptyStringSchema, DEFAULT_LENS_SLUG),
  tab: v.optional(nonEmptyStringSchema),
  metric: v.optional(nonEmptyStringSchema),
})

const getScenarioPage = createServerFn({ method: "GET" })
  .inputValidator(
    v.strictObject({
      params: publicScenarioRouteParamsSchema,
      search: scenarioPageSearchSchema,
    }),
  )
  .handler(({ data, context }) =>
    getScenarioPageData(context.env, {
      owner: data.params.owner,
      repo: data.params.repo,
      scenario: data.params.scenario,
      branch: data.search.branch,
      env: data.search.env,
      entrypoint: data.search.entrypoint,
      lens: data.search.lens,
      tab: data.search.tab,
      metric: data.search.metric,
    }),
  )

export const Route = createFileRoute("/r/$owner/$repo/scenarios/$scenario")({
  validateSearch: scenarioPageSearchSchema,
  loaderDeps: ({ search }) => search,
  loader: ({ params, deps }) => getScenarioPage({ data: { params, search: deps } }),
  component: ScenarioPageRouteComponent,
})

type ScenarioPageData = ReturnType<typeof Route.useLoaderData>
type ScenarioLatestOutputRow = ScenarioPageData["latestOutputRows"][number]
type ScenarioHistoryOutputRow = ScenarioPageData["historyOutputRows"][number]

function ScenarioPageRouteComponent() {
  const data = Route.useLoaderData()
  const tab = scenarioTabs.includes(data.tab as (typeof scenarioTabs)[number])
    ? (data.tab as (typeof scenarioTabs)[number])
    : "history"

  return (
    <main className="page repo-page scenario-page">
      <header className="page-header">
        <p className="breadcrumb">
          <Link to="/">Home</Link>
          <span aria-hidden="true">/</span>
          <Link to="/r/$owner/$repo" from={Route.fullPath} search={{ branch: data.branch ?? undefined, lens: data.lens, metric: data.metric }}>
            {data.repository.owner}/{data.repository.name}
          </Link>
          <span aria-hidden="true">/</span>
          <span>Scenario</span>
        </p>
        <h1>{data.scenario.slug}</h1>
        <p>A scenario is one reproducible bundle target. Its outputs show each environment / entrypoint measured for the selected byte-counting mode.</p>
      </header>

      <ScenarioSummary data={data} />
      <ScenarioContextControls data={data} />
      <RecommendedNextAction data={data} />
      <CurrentOutputs data={data} />
      <HistoryModule data={data} />
      <PoliciesContext data={data} />
      <ExpertEvidence data={data} tab={tab} />
    </main>
  )
}

function ScenarioSummary(props: { data: ScenarioPageData }) {
  const data = props.data

  return (
    <section className="section">
      <h2>Scenario summary</h2>
      <dl className="repo-health">
        <div><dt>Source</dt><dd>{data.scenario.sourceKind}</dd></div>
        <div><dt>Branch</dt><dd>{data.branch ?? "none"}</dd></div>
        <div><dt>Outputs</dt><dd>{data.latestOutputRows.length}</dd></div>
        <div><dt>What's counted</dt><dd>{data.lens}</dd></div>
        <div><dt>Size</dt><dd>{data.metric}</dd></div>
        <div><dt>Status</dt><dd><StateBadge state={scenarioStatus(data)} /></dd></div>
      </dl>
      {data.latestFreshScenario ? (
        <p className="notice">Latest run {shortSha(data.latestFreshScenario.activeCommitSha)} uploaded at {data.latestFreshScenario.activeUploadedAt}.</p>
      ) : data.latestStatusScenario ? (
        <p className="notice">{describeStatusScenarioDetail(data.latestStatusScenario)}</p>
      ) : (
        <p className="notice">No branch summary is available for this scenario yet.</p>
      )}
    </section>
  )
}

function ScenarioContextControls(props: { data: ScenarioPageData }) {
  const data = props.data

  return (
    <section className="section scenario-view-context" aria-labelledby="scenario-context-heading">
      <div>
        <p className="eyebrow">Measurement context</p>
        <h2 id="scenario-context-heading">Choose output interpretation</h2>
      </div>
      <p>Changing these controls changes how output rows are interpreted. Environment and entrypoint remain visible on each row.</p>
      <div className="scenario-control-row">
        <ControlLinks label="Branch" values={data.branchOptions} current={data.branch} toSearch={(branch) => ({ branch })} />
        <ControlLinks label="What's counted" values={data.lensOptions} current={data.lens} toSearch={(lens) => ({ lens })} />
        <ControlLinks label="Size" values={["raw", "gzip", "brotli"]} current={data.metric} toSearch={(metric) => ({ metric })} />
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
        <Link key={value} from={Route.fullPath} replace resetScroll={false} to="." search={(prev) => ({ ...prev, ...props.toSearch(value) })} aria-current={props.current === value ? "page" : undefined}>
          {value}
        </Link>
      ))}
    </span>
  )
}

function RecommendedNextAction(props: { data: ScenarioPageData }) {
  const data = props.data
  const action = nextAction(data)

  return (
    <section className="section recommended-action">
      <p className="eyebrow">Recommended next action</p>
      <h2>{action.title}</h2>
      <p>{action.description}</p>
      {action.href ? <Link className="button-secondary" from={Route.fullPath} to={action.href.to} search={action.href.search}>{action.label}</Link> : null}
    </section>
  )
}

function CurrentOutputs(props: { data: ScenarioPageData }) {
  const data = props.data

  return (
    <section className="section">
      <h2>Current outputs</h2>
      {data.latestOutputRows.length === 0 ? (
        <p className="notice">No outputs have been measured for this scenario on the selected branch yet.</p>
      ) : (
        <div className="output-row-grid">
          {data.latestOutputRows.map((row: ScenarioLatestOutputRow) => <ScenarioOutputCard key={row.rowId} data={data} row={row} />)}
        </div>
      )}
    </section>
  )
}

function ScenarioOutputCard(props: { data: ScenarioPageData; row: ScenarioLatestOutputRow }) {
  const row = props.row

  return (
    <OutputRowCard
      row={row}
      primaryAction={(
        <Link from={Route.fullPath} to="/r/$owner/$repo/scenarios/$scenario" search={scenarioSearch(props.data, { env: row.environment.key, entrypoint: row.entrypoint.key, lens: row.lens.id, tab: "treemap" })}>
          Inspect evidence
        </Link>
      )}
    >
      <div className="row-actions">
        <Link from={Route.fullPath} to="/r/$owner/$repo/scenarios/$scenario" search={scenarioSearch(props.data, { env: row.environment.key, entrypoint: row.entrypoint.key, lens: row.lens.id, tab: "treemap" })}>Treemap</Link>
        <Link from={Route.fullPath} to="/r/$owner/$repo/scenarios/$scenario" search={scenarioSearch(props.data, { env: row.environment.key, entrypoint: row.entrypoint.key, lens: row.lens.id, tab: "graph" })}>Graph</Link>
        <Link from={Route.fullPath} to="/r/$owner/$repo/scenarios/$scenario" search={scenarioSearch(props.data, { env: row.environment.key, entrypoint: row.entrypoint.key, lens: row.lens.id, tab: "waterfall" })}>Waterfall</Link>
      </div>
    </OutputRowCard>
  )
}

function HistoryModule(props: { data: ScenarioPageData }) {
  const data = props.data
  const visibleRows = data.historyOutputRows.slice(0, 6)

  return (
    <section className="section">
      <p className="eyebrow">History mode</p>
      <h2>Output evolution over time</h2>
      <p className="notice">Fixed to scenario {data.scenario.slug}, {data.lens}, and {data.metric}. Missing points remain gaps instead of zeroes.</p>
      <dl className="context-summary">
        <div><dt>Branch</dt><dd>{data.branch ?? "none"}</dd></div>
        <div><dt>Outputs</dt><dd>{data.historyOutputRows.length}</dd></div>
        <div><dt>Visible lines</dt><dd>{visibleRows.length}</dd></div>
        <div><dt>Point state</dt><dd>measured</dd></div>
      </dl>
      <HistoryStateLegend />
      {data.historyOutputRows.length === 0 ? (
        <p className="notice">No history points match this scenario context yet.</p>
      ) : (
        <div className="viz-block">
          <div data-role="chart">
            <TrendChart series={buildHistoryChartSeries(visibleRows)} />
          </div>
          {data.historyOutputRows.length > visibleRows.length ? (
            <p className="notice">Showing the first {visibleRows.length} output lines to keep the chart readable. Narrow the output selection for more detail.</p>
          ) : null}
          <div className="output-row-grid compact">
            {data.historyOutputRows.map((row: ScenarioHistoryOutputRow) => <OutputRowCard key={row.rowId} row={row} />)}
          </div>
        </div>
      )}
    </section>
  )
}

function HistoryStateLegend() {
  return (
    <details className="history-state-legend">
      <summary>History states</summary>
      <dl className="context-summary compact">
        <div><dt>measured</dt><dd>real uploaded size point</dd></div>
        <div><dt>missing run</dt><dd>gap, never zero</dd></div>
        <div><dt>failed run</dt><dd>status marker, not a size point</dd></div>
        <div><dt>unsupported lens</dt><dd>not charted for this lens</dd></div>
        <div><dt>missing size</dt><dd>gap for selected size</dd></div>
        <div><dt>stale point</dt><dd>older point retained for context</dd></div>
        <div><dt>incompatible schema</dt><dd>excluded from the line</dd></div>
      </dl>
    </details>
  )
}

function PoliciesContext(props: { data: ScenarioPageData }) {
  const states = unique(props.data.latestOutputRows.map((row: ScenarioLatestOutputRow) => row.policyState))

  return (
    <section className="section">
      <h2>Policies context</h2>
      {states.length === 0 ? (
        <p className="notice">No policy can be evaluated until outputs exist.</p>
      ) : (
        <p>Current output policy states: {states.map((state) => <StateBadge key={state} state={state} />)}</p>
      )}
      <p className="notice">Scenario-scoped policy evaluation is active when repository policies match this output context.</p>
    </section>
  )
}

function ExpertEvidence(props: { data: ScenarioPageData; tab: (typeof scenarioTabs)[number] }) {
  const data = props.data

  return (
    <section className="section">
      <h2>Expert evidence</h2>
      <p className="notice">Open evidence from an output row to inspect treemap, graph, waterfall, assets, packages, and budget context.</p>
      <TabSelector
        tabs={scenarioTabs.map((nextTab) => (
          <Link key={nextTab} from={Route.fullPath} replace resetScroll={false} to="." search={(prev) => ({ ...prev, tab: nextTab })}>
            {nextTab}
          </Link>
        ))}
      />
      <SelectedSeriesDetailView
        context={{
          baselineRef: data.selectedSeries?.series.selectedBaseCommitSha,
          currentRef: data.selectedSeries?.series.selectedHeadCommitSha ?? data.selectedHistoryPoint?.commitSha ?? data.latestFreshScenario?.activeCommitSha,
          entrypoint: data.selectedSeries?.series.entrypoint ?? data.selectedHistorySeries?.entrypoint ?? data.entrypoint,
          environment: data.selectedSeries?.series.environment ?? data.selectedHistorySeries?.environment ?? data.env,
          lens: data.lens,
          scenario: data.scenario.slug,
        }}
        detail={props.tab === "history" ? null : data.selectedDetail}
        metric={data.metric}
        mode="snapshot"
        tab={props.tab}
        treemapTimeline={data.selectedTreemapTimeline}
        budgetState={data.selectedSeries?.series.budgetState}
        hasDegradedStableIdentity={data.selectedSeries?.series.hasDegradedStableIdentity}
      />
    </section>
  )
}

function buildHistoryChartSeries(rows: ScenarioHistoryOutputRow[]): TrendChartSeries[] {
  return rows.map((row) => ({
    id: row.seriesId ?? row.rowId,
    label: `${row.environment.label} / ${row.entrypoint.label}`,
    points: row.points,
  }))
}

function scenarioSearch(
  data: ScenarioPageData,
  updates: Partial<Record<"branch" | "env" | "entrypoint" | "lens" | "tab" | "metric", string>>,
) {
  return {
    branch: updates.branch ?? data.branch ?? undefined,
    env: updates.env ?? data.env,
    entrypoint: updates.entrypoint ?? data.entrypoint,
    lens: updates.lens ?? data.lens,
    tab: updates.tab ?? data.tab,
    metric: updates.metric ?? data.metric,
  }
}

function scenarioStatus(data: ScenarioPageData) {
  if (data.latestFreshScenario?.hasNewerFailedRun) return "warning"
  if (data.latestFreshScenario) return "fresh"
  if (data.latestStatusScenario) return data.latestStatusScenario.state
  return "missing"
}

function nextAction(data: ScenarioPageData): { description: string; href: { search: ReturnType<typeof scenarioSearch>; to: "." } | null; label: string; title: string } {
  const firstOutput = data.latestOutputRows[0]

  if (!firstOutput) {
    return {
      description: "Run the first measurement for this scenario so outputs can be confirmed.",
      href: null,
      label: "Run measurement",
      title: "Measure this scenario",
    }
  }

  if (data.latestOutputRows.some((row: ScenarioLatestOutputRow) => row.measurementState === "missing_baseline")) {
    return {
      description: "This scenario has current bytes but no baseline yet. Another run on the tracked branch will make deltas meaningful.",
      href: { to: ".", search: scenarioSearch(data, { env: firstOutput.environment.key, entrypoint: firstOutput.entrypoint.key, lens: firstOutput.lens.id, tab: "treemap" }) },
      label: "Inspect current evidence",
      title: "Collect a baseline next",
    }
  }

  if (data.latestOutputRows.every((row: ScenarioLatestOutputRow) => row.policyState === "not_configured")) {
    return {
      description: "Outputs are measured. Add policy context later to distinguish acceptable changes from regressions.",
      href: { to: ".", search: scenarioSearch(data, { env: firstOutput.environment.key, entrypoint: firstOutput.entrypoint.key, lens: firstOutput.lens.id, tab: "treemap" }) },
      label: "Inspect evidence",
      title: "Review bytes before adding policy",
    }
  }

  return {
    description: "Outputs have measurements and policy context. Review trend and evidence before changing this scenario.",
    href: { to: ".", search: scenarioSearch(data, { env: firstOutput.environment.key, entrypoint: firstOutput.entrypoint.key, lens: firstOutput.lens.id, tab: "treemap" }) },
    label: "Inspect evidence",
    title: "Review current evidence",
  }
}

function unique(values: string[]) {
  return [...new Set(values)]
}
