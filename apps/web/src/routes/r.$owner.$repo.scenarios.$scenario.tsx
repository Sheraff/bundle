import {
  DEFAULT_LENS_SLUG,
  nonEmptyStringSchema,
  publicScenarioRouteParamsSchema,
} from "@workspace/contracts"
import { Link, createFileRoute } from "@tanstack/react-router"
import { createServerFn } from "@tanstack/react-start"
import * as v from "valibot"

import { TrendChart, type TrendChartSeries } from "../components/charts.js"
import { SelectedSeriesDetailView } from "../components/selected-series-detail.js"
import { LinkSelector, MetricSelector, TabSelector } from "../components/url-controls.js"
import { getScenarioPageData } from "../lib/public-read-models.server.js"
import { formatBytes, shortSha } from "../lib/formatting.js"
import {
  describeNeutralDelta,
  describeStatusScenarioDetail,
  formatSeriesLabel,
} from "../lib/public-route-presentation.js"
import { metricPointValue, type SizeMetric } from "../lib/size-metric.js"

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
  loader: ({ params, deps }) =>
    getScenarioPage({
      data: {
        params,
        search: deps,
      },
    }),
  component: ScenarioPageRouteComponent,
})

type ScenarioPageData = ReturnType<typeof Route.useLoaderData>
type ScenarioHistorySeries = ScenarioPageData["history"][number]

function ScenarioPageRouteComponent() {
  const data = Route.useLoaderData()
  const tab = scenarioTabs.includes(data.tab as (typeof scenarioTabs)[number])
    ? (data.tab as (typeof scenarioTabs)[number])
    : "history"

  return (
    <main>
      <header>
        <p>
          <Link
            to="/r/$owner/$repo"
            from={Route.fullPath}
            search={{
              branch: data.branch ?? undefined,
              lens: data.lens,
              metric: data.metric,
            }}
          >
            {data.repository.owner}/{data.repository.name}
          </Link>
        </p>
        <h1>{data.scenario.slug}</h1>
        <p>Scenario public page.</p>
      </header>

      <section>
        <h2>Filters</h2>
        <LinkSelector label="Branch" current={data.branch} options={data.branchOptions} searchFor={(branch) => scenarioSearch(data, { branch, tab })} />
        <LinkSelector label="Environment" current={data.env} options={["all", ...data.environmentOptions]} searchFor={(env) => scenarioSearch(data, { env, entrypoint: "all", tab })} />
        <LinkSelector label="Entrypoint" current={data.entrypoint} options={["all", ...data.entrypointOptions]} searchFor={(entrypoint) => scenarioSearch(data, { entrypoint, tab })} />
        <LinkSelector label="Lens" current={data.lens} options={data.lensOptions} searchFor={(lens) => scenarioSearch(data, { lens, tab })} />
        <MetricSelector current={data.metric} searchFor={(metric) => scenarioSearch(data, { metric, tab })} />
      </section>

      <section>
        <h2>Latest Status</h2>
        {data.latestFreshScenario ? (
          <>
            <p>Active run: {shortSha(data.latestFreshScenario.activeCommitSha)}</p>
            <p>Uploaded at: {data.latestFreshScenario.activeUploadedAt}</p>
            <p>Processed runs: {data.latestFreshScenario.processedRunCount}</p>
            <p>Failed runs: {data.latestFreshScenario.failedRunCount}</p>
            <p>Newer failed rerun: {data.latestFreshScenario.hasNewerFailedRun ? "yes" : "no"}</p>
          </>
        ) : data.latestStatusScenario ? (
          <>
            <p>State: {data.latestStatusScenario.state}</p>
            <p>{describeStatusScenarioDetail(data.latestStatusScenario)}</p>
          </>
        ) : (
          <p>No branch summary is available for this scenario yet.</p>
        )}
      </section>

      <section>
        <h2>Compare Shortcut</h2>
        {data.compareShortcut ? (
          <Link
            from={Route.fullPath}
            to="/r/$owner/$repo/compare"
            search={{
              base: data.compareShortcut.base,
              head: data.compareShortcut.head,
              scenario: data.compareShortcut.scenario,
              env: data.compareShortcut.env,
              entrypoint: data.compareShortcut.entrypoint,
              lens: data.compareShortcut.lens,
              metric: data.metric,
            }}
          >
            Open latest compare
          </Link>
        ) : (
          <p>No baseline-backed compare shortcut is available for this scenario yet.</p>
        )}
      </section>

      <section>
        <h2>History</h2>
        {data.history.length === 0 ? (
          <p>No history points match the selected scenario filters yet.</p>
        ) : (
          <>
            <TrendChart series={buildScenarioChartSeries(data.history, data.metric)} />
            {data.history.map((series) => <ScenarioHistoryTable key={series.seriesId} data={data} series={series} />)}
          </>
        )}
      </section>

      <section>
        <h2>Selected Series</h2>
        {data.selectedSeries ? (
          <>
            <p>{formatSeriesLabel(data.selectedSeries.series)}</p>
            <p>
              {describeNeutralDelta(data.selectedSeries.series, data.selectedSeries.primaryItem, {
                detailed: true,
                noBaselineText: "No baseline is available for this series yet.",
                failedPrefix: "Comparison failed",
                unchangedPrefix: "Brotli total unchanged at",
              })}
            </p>
          </>
        ) : (
          <>
            <p>Select a full series context (`env + entrypoint + lens`) to unlock the detail area.</p>
            {data.history.length > 0 ? (
              <ul>
                {data.history.map((series) => (
                  <li key={`detail:${series.seriesId}`}>
                    <Link
                      from={Route.fullPath}
                      to="/r/$owner/$repo/scenarios/$scenario"
                      search={scenarioSearch(data, {
                        env: series.environment,
                        entrypoint: series.entrypoint,
                        lens: series.lens,
                        tab: "treemap",
                      })}
                    >
                      Open treemap for {formatSeriesLabel(series)}
                    </Link>
                  </li>
                ))}
              </ul>
            ) : null}
          </>
        )}
      </section>

      <section>
        <h2>Detail Tabs</h2>
        <TabSelector current={tab} tabs={scenarioTabs} searchFor={(nextTab) => scenarioSearch(data, { tab: nextTab })} />
        <SelectedSeriesDetailView
          detail={tab === "history" ? null : data.selectedDetail}
          metric={data.metric}
          mode="snapshot"
          tab={tab}
          budgetState={data.selectedSeries?.series.budgetState}
          hasDegradedStableIdentity={data.selectedSeries?.series.hasDegradedStableIdentity}
        />
      </section>
    </main>
  )
}

function buildScenarioChartSeries(
  seriesRows: ScenarioHistorySeries[],
  metric: SizeMetric,
): TrendChartSeries[] {
  return seriesRows.map((series) => ({
    id: series.seriesId,
    label: `${series.environment} / ${series.entrypoint}`,
    points: [...series.points]
      .sort((left, right) => left.measuredAt.localeCompare(right.measuredAt))
      .map((point) => ({ commitSha: point.commitSha, measuredAt: point.measuredAt, value: metricPointValue(point, metric) })),
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

function ScenarioHistoryTable(props: { data: ScenarioPageData; series: ScenarioHistorySeries }) {
  return (
    <article>
      <h3>{formatSeriesLabel(props.series)}</h3>
      <p>
        <Link
          from={Route.fullPath}
          to="/r/$owner/$repo/scenarios/$scenario"
          search={scenarioSearch(props.data, {
            env: props.series.environment,
            entrypoint: props.series.entrypoint,
            lens: props.series.lens,
            tab: "treemap",
          })}
        >
          Treemap
        </Link>{" "}
        <Link
          from={Route.fullPath}
          to="/r/$owner/$repo/scenarios/$scenario"
          search={scenarioSearch(props.data, {
            env: props.series.environment,
            entrypoint: props.series.entrypoint,
            lens: props.series.lens,
            tab: "graph",
          })}
        >
          Graph
        </Link>{" "}
        <Link
          from={Route.fullPath}
          to="/r/$owner/$repo/scenarios/$scenario"
          search={scenarioSearch(props.data, {
            env: props.series.environment,
            entrypoint: props.series.entrypoint,
            lens: props.series.lens,
            tab: "waterfall",
          })}
        >
          Waterfall
        </Link>
      </p>
      <table>
        <thead>
          <tr>
            <th>Commit</th>
            <th>Measured At</th>
            <th>Raw</th>
            <th>Gzip</th>
            <th>Brotli</th>
          </tr>
        </thead>
        <tbody>
          {props.series.points.map((point: ScenarioHistorySeries["points"][number]) => (
            <tr key={`${props.series.seriesId}:${point.commitSha}:${point.measuredAt}`}>
              <td>{shortSha(point.commitSha)}</td>
              <td>{point.measuredAt}</td>
              <td>{formatBytes(point.totalRawBytes)}</td>
              <td>{formatBytes(point.totalGzipBytes)}</td>
              <td>{formatBytes(point.totalBrotliBytes)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </article>
  )
}
