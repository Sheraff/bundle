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

import "./repo-shared.css"
import { queryOptions } from "@tanstack/react-query"

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
  loader: ({ params, deps }) => getScenarioPage({
    data: {
      params,
      search: deps,
    }
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
    <main className="page repo-page">
      <header className="page-header">
        <p className="breadcrumb">
          <Link to="/">Home</Link>
          <span aria-hidden="true">/</span>
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
          <span aria-hidden="true">/</span>
          <span>Scenario</span>
        </p>
        <h1>{data.scenario.slug}</h1>
        <p>Scenario detail with history, comparisons, and visualizations.</p>
      </header>

      <section className="section">
        <h2>Filters</h2>
        <div className="filters-bar">
          <LinkSelector
            label="Branch"
            options={data.branchOptions.map((branch) => (
              <Link key={branch} from={Route.fullPath} replace resetScroll={false} to="." search={(prev) => ({ ...prev, branch })}>
                {branch}
              </Link>
            ))}
          />
          <LinkSelector
            label="Environment"
            options={["all", ...data.environmentOptions].map((env) => (
              <Link key={env} from={Route.fullPath} replace resetScroll={false} to="." search={(prev) => ({ ...prev, env })}>
                {env}
              </Link>
            ))}
          />
          <LinkSelector
            label="Entrypoint"
            options={["all", ...data.entrypointOptions].map((entrypoint) => (
              <Link key={entrypoint} from={Route.fullPath} replace resetScroll={false} to="." search={(prev) => ({ ...prev, entrypoint })}>
                {entrypoint}
              </Link>
            ))}
          />
          <LinkSelector
            label="Lens"
            options={data.lensOptions.map((lens) => (
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

      <div className="card-grid">
        <section className="section">
          <h2>Latest status</h2>
          {data.latestFreshScenario ? (
            <dl className="definition">
              <dt>Active run</dt>
              <dd className="mono">{shortSha(data.latestFreshScenario.activeCommitSha)}</dd>
              <dt>Uploaded at</dt>
              <dd>{data.latestFreshScenario.activeUploadedAt}</dd>
              <dt>Processed runs</dt>
              <dd>{data.latestFreshScenario.processedRunCount}</dd>
              <dt>Failed runs</dt>
              <dd>{data.latestFreshScenario.failedRunCount}</dd>
              <dt>Newer failed rerun</dt>
              <dd>{data.latestFreshScenario.hasNewerFailedRun ? "yes" : "no"}</dd>
            </dl>
          ) : data.latestStatusScenario ? (
            <dl className="definition">
              <dt>State</dt>
              <dd>{data.latestStatusScenario.state}</dd>
              <dt>Detail</dt>
              <dd>{describeStatusScenarioDetail(data.latestStatusScenario)}</dd>
            </dl>
          ) : (
            <p className="notice">No branch summary is available for this scenario yet.</p>
          )}
        </section>

        <section className="section">
          <h2>Compare shortcut</h2>
          {data.compareShortcut ? (
            <p>
              <Link
                className="button-secondary"
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
            </p>
          ) : (
            <p className="notice">No baseline-backed compare shortcut is available for this scenario yet.</p>
          )}
        </section>
      </div>

      <section className="section">
        <h2>History</h2>
        {data.history.length === 0 ? (
          <p className="notice">No history points match the selected scenario filters yet.</p>
        ) : (
          <div className="viz-block">
            <div data-role="chart">
              <TrendChart series={buildScenarioChartSeries(data.history, data.metric)} />
            </div>
            {data.history.map((series) => <ScenarioHistoryTable key={series.seriesId} data={data} series={series} />)}
          </div>
        )}
      </section>

      <section className="section">
        <h2>Selected series</h2>
        {data.selectedSeries ? (
          <dl className="context-summary">
            <div><dt>Series</dt><dd>{formatSeriesLabel(data.selectedSeries.series)}</dd></div>
            <div>
              <dt>Delta</dt>
              <dd>
                {describeNeutralDelta(data.selectedSeries.series, data.selectedSeries.primaryItem, {
                  detailed: true,
                  noBaselineText: "No baseline is available for this series yet.",
                  failedPrefix: "Comparison failed",
                  unchangedPrefix: "Brotli total unchanged at",
                })}
              </dd>
            </div>
          </dl>
        ) : data.selectedHistorySeries ? (
          <dl className="context-summary">
            <div><dt>Series</dt><dd>{formatSeriesLabel(data.selectedHistorySeries)}</dd></div>
            <div>
              <dt>Latest point</dt>
              <dd className="mono">{shortSha(data.selectedHistoryPoint?.commitSha ?? "")} at {data.selectedHistoryPoint?.measuredAt}</dd>
            </div>
          </dl>
        ) : (
          <>
            <p className="notice">Select a full series context (<code>env + entrypoint + lens</code>) to unlock the detail area.</p>
            {data.history.length > 0 ? (
              <ul className="row-actions">
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

      <section className="section">
        <h2>Detail tabs</h2>
        <TabSelector
          tabs={scenarioTabs.map((nextTab) => (
            <Link key={nextTab} from={Route.fullPath} replace resetScroll={false} to="." search={(prev) => ({ ...prev, tab: nextTab })}>
              {nextTab}
            </Link>
          ))}
        />
        <SelectedSeriesDetailView
          detail={tab === "history" ? null : data.selectedDetail}
          metric={data.metric}
          mode="snapshot"
          tab={tab}
          treemapTimeline={data.selectedTreemapTimeline}
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
    <article className="card">
      <header className="row">
        <h3>{formatSeriesLabel(props.series)}</h3>
        <span className="row-actions">
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
          </Link>
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
          </Link>
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
        </span>
      </header>
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
            {props.series.points.map((point: ScenarioHistorySeries["points"][number]) => (
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
