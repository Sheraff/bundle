import {
  DEFAULT_LENS_SLUG,
  nonEmptyStringSchema,
  publicRepositoryRouteParamsSchema,
} from "@workspace/contracts"
import { Link, createFileRoute } from "@tanstack/react-router"
import { createServerFn } from "@tanstack/react-start"
import * as v from "valibot"

import { TrendChart, type TrendChartSeries } from "../components/charts.js"
import { StateBadge } from "../components/state-badge.js"
import { LinkSelector, MetricSelector } from "../components/url-controls.js"
import { getRepositoryOverviewPageData } from "../lib/public-read-models.server.js"
import {
  formatBytes,
  formatSignedBytes,
  formatSignedPercentage,
  shortSha,
} from "../lib/formatting.js"
import {
  describeNeutralDelta,
  describeStatusScenarioDetail,
  formatSeriesLabel,
} from "../lib/public-route-presentation.js"
import { metricPointValue, type SizeMetric } from "../lib/size-metric.js"

import "./repo-shared.css"

const repositoryOverviewSearchSchema = v.strictObject({
  branch: v.optional(nonEmptyStringSchema),
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
type RepositoryTrendPoint = RepositoryOverviewData["trend"][number]

function RepositoryOverviewRouteComponent() {
  const data = Route.useLoaderData()

  return (
    <main className="page repo-page">
      <header className="page-header">
        <p className="breadcrumb">
          <Link to="/">Home</Link>
          <span aria-hidden="true">/</span>
          <span>Repository</span>
        </p>
        <h1>
          <span data-owner>{data.repository.owner}</span>
          <span data-sep aria-hidden="true">/</span>
          {data.repository.name}
        </h1>
        <p>Public repository overview.</p>
        <nav aria-label="Repository views" className="repo-subnav">
          <a aria-current="page">Overview</a>
          <Link
            to="/r/$owner/$repo/history"
            params={{ owner: data.repository.owner, repo: data.repository.name }}
            search={{
              branch: data.branch ?? undefined,
              scenario: "all",
              env: "all",
              entrypoint: "all",
              lens: data.lens,
              metric: data.metric,
            }}
          >
            History
          </Link>
        </nav>
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

      <section className="section">
        <h2>Trend</h2>
        {data.trend.length === 0 ? (
          <p className="notice">No trend data has been derived for the selected branch and lens yet.</p>
        ) : (
          <div className="viz-block">
            <div data-role="chart">
              <TrendChart series={buildTrendSeries(data.trend, data.metric)} />
            </div>
            <details>
              <summary>Show data table</summary>
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Series</th>
                      <th>Commit</th>
                      <th>Measured at</th>
                      <th>Raw</th>
                      <th>Gzip</th>
                      <th>Brotli</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.trend.map((point) => (
                      <tr key={`${point.seriesId}:${point.commitGroupId}`}>
                        <td>{point.scenarioSlug} / {point.environment} / {point.entrypoint}</td>
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
            </details>
          </div>
        )}
      </section>

      <section className="section">
        <h2>Repository health</h2>
        {data.latestSummary ? (
          <dl className="repo-health">
            <div>
              <dt>Status</dt>
              <dd><StateBadge state={data.latestSummary.status} /></dd>
            </div>
            <div>
              <dt>Commit</dt>
              <dd className="mono">{shortSha(data.latestSummary.commitSha)}</dd>
            </div>
            <div>
              <dt>Fresh</dt>
              <dd>{data.latestSummary.counts.freshScenarioCount}</dd>
            </div>
            <div>
              <dt>Pending</dt>
              <dd>{data.latestSummary.counts.pendingScenarioCount}</dd>
            </div>
            <div>
              <dt>Inherited</dt>
              <dd>{data.latestSummary.counts.inheritedScenarioCount}</dd>
            </div>
            <div>
              <dt>Missing</dt>
              <dd>{data.latestSummary.counts.missingScenarioCount}</dd>
            </div>
            <div>
              <dt>Failed</dt>
              <dd>{data.latestSummary.counts.failedScenarioCount}</dd>
            </div>
            <div>
              <dt>Changed</dt>
              <dd>{data.latestSummary.counts.changedMetricCount}</dd>
            </div>
          </dl>
        ) : (
          <p className="notice">No settled branch summary is available yet.</p>
        )}
      </section>

      <section className="section">
        <h2>Latest important compare</h2>
        {data.latestImportantCompare ? (
          <div className="compare-callout">
            <div data-role="series">
              <strong>{data.latestImportantCompare.scenarioSlug}</strong>
              {" — "}
              {data.latestImportantCompare.environment} / {data.latestImportantCompare.entrypoint} /{" "}
              {data.latestImportantCompare.lens}
            </div>
            <div data-role="delta">
              {formatBytes(data.latestImportantCompare.primaryItem.currentValue)}
              <span className="text-muted"> vs </span>
              {formatBytes(data.latestImportantCompare.primaryItem.baselineValue)}
              <span className="text-muted"> · </span>
              {formatSignedBytes(data.latestImportantCompare.primaryItem.deltaValue)}
              <span className="text-muted"> · </span>
              {formatSignedPercentage(data.latestImportantCompare.primaryItem.percentageDelta)}
            </div>
            <div>
              <Link
                className="button-secondary"
                to="/r/$owner/$repo/compare"
                from={Route.fullPath}
                search={{
                  base: data.latestImportantCompare.baseSha,
                  head: data.latestImportantCompare.headSha,
                  scenario: data.latestImportantCompare.scenarioSlug,
                  env: data.latestImportantCompare.environment,
                  entrypoint: data.latestImportantCompare.entrypoint,
                  lens: data.latestImportantCompare.lens,
                }}
              >
                Open compare
              </Link>
            </div>
          </div>
        ) : (
          <p className="notice">No branch comparison is available for the latest summary yet.</p>
        )}
      </section>

      <section className="section">
        <h2>Scenario catalog</h2>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Scenario</th>
                <th>State</th>
                <th>Primary series</th>
                <th>Primary delta</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {data.scenarioCatalog.map((row) => (
                <RepositoryScenarioRow
                  key={`${row.kind}:${row.kind === "known" ? row.scenario.id : row.scenario.scenarioId}`}
                  owner={data.repository.owner}
                  repo={data.repository.name}
                  branch={data.branch ?? undefined}
                  lens={data.lens}
                  row={row}
                />
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  )
}

function buildTrendSeries(
  points: RepositoryTrendPoint[],
  metric: SizeMetric,
): TrendChartSeries[] {
  const seriesById = new Map<string, TrendChartSeries>()

  for (const point of points) {
    const existing = seriesById.get(point.seriesId)
    const nextPoint = {
      commitSha: point.commitSha,
      measuredAt: point.measuredAt,
      value: metricPointValue(point, metric),
    }

    if (existing) {
      existing.points.push(nextPoint)
      continue
    }

    seriesById.set(point.seriesId, {
      id: point.seriesId,
      label: `${point.scenarioSlug} / ${point.environment} / ${point.entrypoint}`,
      points: [nextPoint],
    })
  }

  return [...seriesById.values()].map((series) => ({
    ...series,
    points: [...series.points].sort((left, right) => left.measuredAt.localeCompare(right.measuredAt)),
  }))
}

function RepositoryScenarioRow({
  owner,
  repo,
  branch,
  lens,
  row,
}: {
  owner: string
  repo: string
  branch?: string
  lens: string
  row: RepositoryScenarioCatalogRow
}) {
  if (row.kind === "fresh") {
    const primarySeries = row.primarySeries
    const primaryItem = row.primaryItem

    return (
      <tr>
        <td>
          <Link
            to="/r/$owner/$repo/scenarios/$scenario"
            params={{ owner, repo, scenario: row.scenario.scenarioSlug }}
            search={{
              branch,
              env: "all",
              entrypoint: "all",
              lens,
            }}
          >
            {row.scenario.scenarioSlug}
          </Link>
        </td>
        <td><StateBadge state={row.scenario.hasNewerFailedRun ? "warning" : "fresh"} /></td>
        <td>{primarySeries ? formatSeriesLabel(primarySeries) : <span className="text-muted">No active series</span>}</td>
        <td className="num">{primarySeries ? describeNeutralDelta(primarySeries, primaryItem) : <span className="text-muted">No delta</span>}</td>
        <td>
          <span className="row-actions">
            <Link
              to="/r/$owner/$repo/scenarios/$scenario"
              params={{ owner, repo, scenario: row.scenario.scenarioSlug }}
              search={{
                branch,
                env: "all",
                entrypoint: "all",
                lens,
              }}
            >
              Scenario
            </Link>
            {primarySeries?.selectedBaseCommitSha ? (
              <Link
                to="/r/$owner/$repo/compare"
                from={Route.fullPath}
                search={{
                  base: primarySeries.selectedBaseCommitSha,
                  head: primarySeries.selectedHeadCommitSha,
                  scenario: row.scenario.scenarioSlug,
                  env: primarySeries.environment,
                  entrypoint: primarySeries.entrypoint,
                  lens: primarySeries.lens,
                }}
              >
                Compare
              </Link>
            ) : null}
          </span>
        </td>
      </tr>
    )
  }

  if (row.kind === "status") {
    return (
      <tr>
        <td>
          <Link
            to="/r/$owner/$repo/scenarios/$scenario"
            params={{ owner, repo, scenario: row.scenario.scenarioSlug }}
            search={{
              branch,
              env: "all",
              entrypoint: "all",
              lens,
            }}
          >
            {row.scenario.scenarioSlug}
          </Link>
        </td>
        <td><StateBadge state={row.scenario.state} /></td>
        <td className="text-muted">Not on active commit group</td>
        <td className="text-muted">{describeStatusScenarioDetail(row.scenario)}</td>
        <td>
          <span className="row-actions">
            <Link
              to="/r/$owner/$repo/scenarios/$scenario"
              params={{ owner, repo, scenario: row.scenario.scenarioSlug }}
              search={{
                branch,
                env: "all",
                entrypoint: "all",
                lens,
              }}
            >
              Scenario
            </Link>
          </span>
        </td>
      </tr>
    )
  }

  return (
    <tr>
      <td>
        <Link
          to="/r/$owner/$repo/scenarios/$scenario"
          params={{ owner, repo, scenario: row.scenario.slug }}
          search={{
            branch,
            env: "all",
            entrypoint: "all",
            lens,
          }}
        >
          {row.scenario.slug}
        </Link>
      </td>
      <td><StateBadge state="known" /></td>
      <td className="text-muted">No active summary row yet</td>
      <td className="text-muted">Awaiting the first processed branch summary</td>
      <td>
        <span className="scenario-row-actions">
          <Link
            to="/r/$owner/$repo/scenarios/$scenario"
            params={{ owner, repo, scenario: row.scenario.slug }}
            search={{
              branch,
              env: "all",
              entrypoint: "all",
              lens,
            }}
          >
            Scenario
          </Link>
        </span>
      </td>
    </tr>
  )
}
