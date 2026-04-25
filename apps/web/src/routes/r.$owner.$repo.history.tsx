import { DEFAULT_LENS_SLUG, nonEmptyStringSchema, publicRepositoryRouteParamsSchema } from "@workspace/contracts"
import { Link, createFileRoute } from "@tanstack/react-router"
import { createServerFn } from "@tanstack/react-start"
import * as v from "valibot"

import { TrendChart, type TrendChartSeries } from "../components/charts.js"
import { LinkSelector, MetricSelector } from "../components/url-controls.js"
import { formatBytes, shortSha } from "../lib/formatting.js"
import { getRepositoryHistoryPageData } from "../lib/public-read-models.server.js"
import { metricPointValue, type SizeMetric } from "../lib/size-metric.js"

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
    <main>
      <header>
        <p>
          <Link to="/r/$owner/$repo" from={Route.fullPath} search={{ branch: data.branch ?? undefined, lens: data.lens, metric: data.metric }}>
            {data.repository.owner}/{data.repository.name}
          </Link>
        </p>
        <h1>Repository History</h1>
        <p>Inspect branch evolution across scenarios and launch pairwise comparisons.</p>
      </header>

      <section>
        <h2>Filters</h2>
        <LinkSelector label="Branch" current={data.branch} options={data.branchOptions} searchFor={(branch) => filterSearch(data, { branch })} />
        <LinkSelector label="Scenario" current={data.scenario} options={["all", ...data.scenarioOptions]} searchFor={(scenario) => filterSearch(data, { scenario })} />
        <LinkSelector label="Environment" current={data.env} options={["all", ...data.environmentOptions]} searchFor={(env) => filterSearch(data, { env, entrypoint: "all" })} />
        <LinkSelector label="Entrypoint" current={data.entrypoint} options={["all", ...data.entrypointOptions]} searchFor={(entrypoint) => filterSearch(data, { entrypoint })} />
        <LinkSelector label="Lens" current={data.lens} options={data.lensOptions} searchFor={(lens) => filterSearch(data, { lens })} />
        <MetricSelector current={data.metric} searchFor={(metric) => filterSearch(data, { metric })} />
      </section>

      <CompareLauncher data={data} />

      <section>
        <h2>Branch Evolution</h2>
        {data.history.length === 0 ? (
          <p>No history rows match the selected filters. Try broadening scenario, environment, or entrypoint.</p>
        ) : (
          <>
            <TrendChart series={buildHistoryChartSeries(data.history, data.metric)} />
            {data.history.map((series) => <HistoryTable key={series.seriesId} series={series} />)}
          </>
        )}
      </section>
    </main>
  )
}

function CompareLauncher(props: { data: HistoryData }) {
  const options: HistoryCommitOption[] = props.data.commitOptions

  return (
    <section>
      <h2>Compare Builder</h2>
      {options.length < 2 ? (
        <p>At least two known commit groups are needed to launch a comparison.</p>
      ) : (
        <form action={`/r/${props.data.repository.owner}/${props.data.repository.name}/compare`} method="get">
          <label>
            Base
            <select name="base" defaultValue={quoteSearchString(options[1]?.commitSha ?? options[0]?.commitSha ?? "")}>
              {options.map((option) => <option key={`base:${option.commitSha}`} value={quoteSearchString(option.commitSha)}>{optionLabel(option)}</option>)}
            </select>
          </label>
          <label>
            Head
            <select name="head" defaultValue={quoteSearchString(options[0]?.commitSha ?? "")}>
              {options.map((option) => <option key={`head:${option.commitSha}`} value={quoteSearchString(option.commitSha)}>{optionLabel(option)}</option>)}
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

function HistoryTable(props: { series: HistorySeries }) {
  return (
    <article>
      <h3>{props.series.scenarioSlug} / {props.series.environment} / {props.series.entrypoint} / {props.series.lens}</h3>
      <table>
        <thead><tr><th>Commit</th><th>Measured At</th><th>Raw</th><th>Gzip</th><th>Brotli</th></tr></thead>
        <tbody>{props.series.points.map((point) => <tr key={`${props.series.seriesId}:${point.commitSha}:${point.measuredAt}`}><td>{shortSha(point.commitSha)}</td><td>{point.measuredAt}</td><td>{formatBytes(point.totalRawBytes)}</td><td>{formatBytes(point.totalGzipBytes)}</td><td>{formatBytes(point.totalBrotliBytes)}</td></tr>)}</tbody>
      </table>
    </article>
  )
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

function filterSearch(data: HistoryData, updates: Partial<Record<"branch" | "scenario" | "env" | "entrypoint" | "lens" | "metric", string>>) {
  return {
    branch: updates.branch ?? data.branch ?? undefined,
    scenario: updates.scenario ?? data.scenario,
    env: updates.env ?? data.env,
    entrypoint: updates.entrypoint ?? data.entrypoint,
    lens: updates.lens ?? data.lens,
    metric: updates.metric ?? data.metric,
  }
}

function optionLabel(option: HistoryData["commitOptions"][number]) {
  const pr = option.prNumber ? ` PR #${option.prNumber}` : ""
  return `${shortSha(option.commitSha)} on ${option.branch}${pr} (${option.latestUploadAt})`
}

function quoteSearchString(value: string) {
  return JSON.stringify(value)
}
