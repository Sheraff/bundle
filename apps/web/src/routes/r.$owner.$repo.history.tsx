import { DEFAULT_LENS_SLUG, nonEmptyStringSchema, publicRepositoryRouteParamsSchema } from "@workspace/contracts"
import { Link, createFileRoute } from "@tanstack/react-router"
import { createServerFn } from "@tanstack/react-start"
import * as v from "valibot"

import { TrendChart, type TrendChartSeries } from "../components/charts.js"
import { LinkSelector, MetricSelector } from "../components/url-controls.js"
import { formatBytes, shortSha } from "../lib/formatting.js"
import { getRepositoryHistoryPageData } from "../lib/public-read-models.server.js"
import { metricPointValue, type SizeMetric } from "../lib/size-metric.js"

import "./repo-shared.css"
import "../components/compare-form.css"

const repositoryHistorySearchSchema = v.strictObject({
  branch: v.optional(nonEmptyStringSchema),
  scenario: v.optional(nonEmptyStringSchema, "all"),
  env: v.optional(nonEmptyStringSchema, "all"),
  entrypoint: v.optional(nonEmptyStringSchema, "all"),
  lens: v.optional(nonEmptyStringSchema, DEFAULT_LENS_SLUG),
  metric: v.optional(nonEmptyStringSchema),
})

const getRepositoryHistory = createServerFn({ method: "GET" })
  .inputValidator(
    v.strictObject({
      params: publicRepositoryRouteParamsSchema,
      search: repositoryHistorySearchSchema,
    }),
  )
  .handler(({ data, context }) =>
    getRepositoryHistoryPageData(context.env, {
      owner: data.params.owner,
      repo: data.params.repo,
      branch: data.search.branch,
      scenario: data.search.scenario,
      env: data.search.env,
      entrypoint: data.search.entrypoint,
      lens: data.search.lens,
      metric: data.search.metric,
    }),
  )

export const Route = createFileRoute("/r/$owner/$repo/history")({
  validateSearch: repositoryHistorySearchSchema,
  loaderDeps: ({ search }) => search,
  loader: ({ params, deps }) => getRepositoryHistory({ data: { params, search: deps } }),
  component: RepositoryHistoryRouteComponent,
})

type HistoryCommitOption = {
  branch: string
  commitGroupId: string
  commitSha: string
  latestUploadAt: string
  prNumber: number | null
}
type HistorySeries = {
  seriesId: string
  scenarioSlug?: string
  environment: string
  entrypoint: string
  entrypointKind: string
  lens: string
  points: Array<{
    commitSha: string
    measuredAt: string
    totalRawBytes: number
    totalGzipBytes: number
    totalBrotliBytes: number
  }>
}
type HistoryData = ReturnType<typeof Route.useLoaderData> & {
  commitOptions: HistoryCommitOption[]
  history: HistorySeries[]
}

function RepositoryHistoryRouteComponent() {
  const data = Route.useLoaderData()

  return (
    <main className="page repo-page">
      <header className="page-header">
        <p className="breadcrumb">
          <Link to="/">Home</Link>
          <span aria-hidden="true">/</span>
          <Link
            to="/r/$owner/$repo"
            from={Route.fullPath}
            search={{ branch: data.branch ?? undefined, lens: data.lens, metric: data.metric }}
          >
            {data.repository.owner}/{data.repository.name}
          </Link>
        </p>
        <h1>
          <span data-owner>{data.repository.owner}</span>
          <span data-sep aria-hidden="true">/</span>
          {data.repository.name}
        </h1>
        <p>History mode shows how scenarios and outputs evolved over time without mixing What's-counted lenses or sizes.</p>
        <nav aria-label="Repository views" className="repo-subnav">
          <Link
            to="/r/$owner/$repo"
            params={{ owner: data.repository.owner, repo: data.repository.name }}
            search={{ branch: data.branch ?? undefined, lens: data.lens, metric: data.metric }}
          >
            Overview
          </Link>
          <a aria-current="page">History</a>
        </nav>
      </header>

      <HistoryModeSummary data={data} />
      <HistoryMarkers data={data} />
      <HistoryControls data={data} />

      <CompareLauncher data={data} />

      <ScenarioRollups data={data} />

      <section className="section">
        <h2>Branch evolution</h2>
        <p className="notice">Line charts are fixed to {data.lens} and {data.metric}. Missing points are gaps, not zeroes.</p>
        {data.history.length === 0 ? (
          <p className="notice">No history rows match the selected filters. Try broadening scenario, environment, or entrypoint.</p>
        ) : (
          <div className="viz-block">
            <div data-role="chart">
              <TrendChart series={buildHistoryChartSeries(visibleHistorySeries(data.history), data.metric)} />
            </div>
            {data.history.length > visibleHistorySeries(data.history).length ? (
              <p className="notice">Showing the first {visibleHistorySeries(data.history).length} lines to keep the chart readable. Narrow the output selection for more detail.</p>
            ) : null}
            {data.history.map((series) => <HistoryTable key={series.seriesId} data={data} series={series} />)}
          </div>
        )}
      </section>
    </main>
  )
}

function HistoryModeSummary(props: { data: HistoryData }) {
  const data = props.data
  const pointCount = data.history.reduce((sum: number, series: HistorySeries) => sum + series.points.length, 0)

  return (
    <section className="section history-mode-summary">
      <p className="eyebrow">History mode</p>
      <h2>Scenario rollups for {data.branch ?? "no branch"}</h2>
      <dl className="repo-health">
        <div><dt>Scenarios</dt><dd>{unique(data.history.map((series: HistorySeries) => series.scenarioSlug ?? "unknown")).length}</dd></div>
        <div><dt>Outputs</dt><dd>{data.history.length}</dd></div>
        <div><dt>Measured points</dt><dd>{pointCount}</dd></div>
        <div><dt>What's counted</dt><dd>{data.lens}</dd></div>
        <div><dt>Size</dt><dd>{data.metric}</dd></div>
      </dl>
    </section>
  )
}

function HistoryMarkers(props: { data: HistoryData }) {
  const data = props.data

  return (
    <section className="section">
      <h2>Branch markers</h2>
      {data.branchOptions.length === 0 ? (
        <p className="notice">No branch markers are available yet.</p>
      ) : (
        <div className="scenario-control-row">
          {data.branchOptions.map((branch: string) => (
            <Link key={branch} from={Route.fullPath} replace resetScroll={false} to="." search={(prev) => ({ ...prev, branch })} aria-current={data.branch === branch ? "page" : undefined}>
              {branch}
            </Link>
          ))}
        </div>
      )}
      <p className="notice">Tag and release markers will appear here once release data exists.</p>
    </section>
  )
}

function HistoryControls(props: { data: HistoryData }) {
  const data = props.data

  return (
    <section className="section">
      <h2>Timeline controls</h2>
      <p>History keeps one What's-counted lens and one size visible at a time. Output selection can narrow the rollups without changing the meaning of the chart.</p>
      <div className="filters-bar">
        <LinkSelector
          label="Scenario"
          options={["all", ...data.scenarioOptions].map((scenario: string) => (
            <Link key={scenario} from={Route.fullPath} replace resetScroll={false} to="." search={(prev) => ({ ...prev, scenario })}>
              {scenario}
            </Link>
          ))}
        />
        <LinkSelector
          label="Environment"
          options={["all", ...data.environmentOptions].map((env: string) => (
            <Link key={env} from={Route.fullPath} replace resetScroll={false} to="." search={(prev) => ({ ...prev, env })}>
              {env}
            </Link>
          ))}
        />
        <LinkSelector
          label="Entrypoint"
          options={["all", ...data.entrypointOptions].map((entrypoint: string) => (
            <Link key={entrypoint} from={Route.fullPath} replace resetScroll={false} to="." search={(prev) => ({ ...prev, entrypoint })}>
              {entrypoint}
            </Link>
          ))}
        />
        <LinkSelector
          label="What's counted"
          options={data.lensOptions.map((lens: string) => (
            <Link key={lens} from={Route.fullPath} replace resetScroll={false} to="." search={(prev) => ({ ...prev, lens })}>
              {lens}
            </Link>
          ))}
        />
        <MetricSelector
          raw={<Link from={Route.fullPath} replace resetScroll={false} to="." search={(prev) => ({ ...prev, metric: "raw" })}>raw</Link>}
          gzip={<Link from={Route.fullPath} replace resetScroll={false} to="." search={(prev) => ({ ...prev, metric: "gzip" })}>gzip</Link>}
          brotli={<Link from={Route.fullPath} replace resetScroll={false} to="." search={(prev) => ({ ...prev, metric: "brotli" })}>brotli</Link>}
        />
      </div>
    </section>
  )
}

function ScenarioRollups(props: { data: HistoryData }) {
  const groups = groupHistoryByScenario(props.data.history)

  return (
    <section className="section">
      <h2>Scenario rollups</h2>
      {groups.length === 0 ? (
        <p className="notice">No scenario rollups are available for this history context.</p>
      ) : (
        <div className="card-grid">
          {groups.map((group) => (
            <article key={group.scenarioSlug} className="card">
              <h3>{group.scenarioSlug}</h3>
              <p>{group.series.length} outputs, {group.pointCount} measured points.</p>
              <Link
                to="/r/$owner/$repo/scenarios/$scenario"
                params={{ owner: props.data.repository.owner, repo: props.data.repository.name, scenario: group.scenarioSlug }}
                search={{ branch: props.data.branch ?? undefined, lens: props.data.lens, metric: props.data.metric }}
              >
                Open scenario history
              </Link>
            </article>
          ))}
        </div>
      )}
    </section>
  )
}

function CompareLauncher(props: { data: HistoryData }) {
  const options: HistoryCommitOption[] = props.data.commitOptions

  return (
    <section className="section">
      <h2>Compare builder</h2>
      {options.length < 2 ? (
        <p className="notice">At least two known commit groups are needed to launch a comparison.</p>
      ) : (
        <form
          className="compare-form"
          action={`/r/${props.data.repository.owner}/${props.data.repository.name}/compare`}
          method="get"
        >
          <label>
            Base
            <select name="base" defaultValue={options[1]?.commitSha ?? options[0]?.commitSha ?? ""}>
              {options.map((option) => (
                <option key={`base:${option.commitSha}`} value={option.commitSha}>
                  {optionLabel(option)}
                </option>
              ))}
            </select>
          </label>
          <label>
            Head
            <select name="head" defaultValue={options[0]?.commitSha ?? ""}>
              {options.map((option) => (
                <option key={`head:${option.commitSha}`} value={option.commitSha}>
                  {optionLabel(option)}
                </option>
              ))}
            </select>
          </label>
          {props.data.scenario !== "all" ? <input type="hidden" name="scenario" value={props.data.scenario} /> : null}
          {props.data.env !== "all" ? <input type="hidden" name="env" value={props.data.env} /> : null}
          {props.data.entrypoint !== "all" ? <input type="hidden" name="entrypoint" value={props.data.entrypoint} /> : null}
          <input type="hidden" name="lens" value={props.data.lens} />
          <input type="hidden" name="metric" value={props.data.metric} />
          <button type="submit">Open compare</button>
        </form>
      )}
    </section>
  )
}

function HistoryTable(props: { data: HistoryData; series: HistorySeries }) {
  return (
    <article className="card">
      <h3>{props.series.scenarioSlug} / {props.series.environment} / {props.series.entrypoint} / {props.series.lens}</h3>
      {props.series.scenarioSlug ? (
        <Link
          to="/r/$owner/$repo/scenarios/$scenario"
          params={{ owner: props.data.repository.owner, repo: props.data.repository.name, scenario: props.series.scenarioSlug }}
          search={{ branch: props.data.branch ?? undefined, env: props.series.environment, entrypoint: props.series.entrypoint, lens: props.series.lens, metric: props.data.metric }}
        >
          Open scenario detail
        </Link>
      ) : null}
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Commit</th>
              <th>Measured at</th>
              <th>Raw</th>
              <th>Gzip</th>
              <th>Brotli</th>
            </tr>
          </thead>
          <tbody>
            {props.series.points.map((point) => (
              <tr key={`${props.series.seriesId}:${point.commitSha}:${point.measuredAt}`}>
                <td className="mono">{shortSha(point.commitSha)}</td>
                <td className="num">{point.measuredAt}</td>
                <td className="num">{formatBytes(point.totalRawBytes)}</td>
                <td className="num">{formatBytes(point.totalGzipBytes)}</td>
                <td className="num">{formatBytes(point.totalBrotliBytes)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </article>
  )
}

function visibleHistorySeries(seriesRows: HistorySeries[]) {
  return seriesRows.slice(0, 6)
}

function groupHistoryByScenario(seriesRows: HistorySeries[]) {
  const groups = new Map<string, { pointCount: number; scenarioSlug: string; series: HistorySeries[] }>()

  for (const series of seriesRows) {
    const scenarioSlug = series.scenarioSlug ?? "unknown"
    const existing = groups.get(scenarioSlug)

    if (existing) {
      existing.series.push(series)
      existing.pointCount += series.points.length
    } else {
      groups.set(scenarioSlug, { pointCount: series.points.length, scenarioSlug, series: [series] })
    }
  }

  return [...groups.values()].sort((left, right) => left.scenarioSlug.localeCompare(right.scenarioSlug))
}

function unique(values: string[]) {
  return [...new Set(values)]
}

function buildHistoryChartSeries(seriesRows: HistorySeries[], metric: SizeMetric): TrendChartSeries[] {
  return seriesRows.map((series) => ({
    id: series.seriesId,
    label: `${series.scenarioSlug} / ${series.environment} / ${series.entrypoint}`,
    points: [...series.points]
      .sort((left, right) => left.measuredAt.localeCompare(right.measuredAt))
      .map((point) => ({ commitSha: point.commitSha, measuredAt: point.measuredAt, value: metricPointValue(point, metric) })),
  }))
}

function optionLabel(option: HistoryData["commitOptions"][number]) {
  const pr = option.prNumber ? ` PR #${option.prNumber}` : ""
  return `${shortSha(option.commitSha)} on ${option.branch}${pr} (${option.latestUploadAt})`
}
