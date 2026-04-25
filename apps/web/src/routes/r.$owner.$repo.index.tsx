import {
  DEFAULT_LENS_SLUG,
  nonEmptyStringSchema,
  publicRepositoryRouteParamsSchema,
} from "@workspace/contracts"
import { Link, createFileRoute } from "@tanstack/react-router"
import { createServerFn } from "@tanstack/react-start"
import * as v from "valibot"

import { TrendChart, type TrendChartSeries } from "../components/charts.js"
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
  formatStateBadge,
} from "../lib/public-route-presentation.js"
import { metricPointValue, type SizeMetric } from "../lib/size-metric.js"

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
    <main>
      <header>
        <p>
          <Link to="/">Home</Link>
        </p>
        <h1>
          {data.repository.owner}/{data.repository.name}
        </h1>
        <p>Repository overview public page.</p>
        <p>
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
            Open repository history
          </Link>
        </p>
      </header>

      <section>
        <h2>Filters</h2>
        <LinkSelector
          label="Branch"
          current={data.branch}
          options={data.branchOptions}
          searchFor={(branch) => ({ branch, lens: data.lens, metric: data.metric })}
        />
        <LinkSelector
          label="Lens"
          current={data.lens}
          options={data.lensOptions}
          searchFor={(lens) => ({ branch: data.branch ?? undefined, lens, metric: data.metric })}
        />
        <MetricSelector
          current={data.metric}
          searchFor={(metric) => ({ branch: data.branch ?? undefined, lens: data.lens, metric })}
        />
      </section>

      <section>
        <h2>Trend</h2>
        {data.trend.length === 0 ? (
          <p>No trend data has been derived for the selected branch and lens yet.</p>
        ) : (
          <>
            <TrendChart series={buildTrendSeries(data.trend, data.metric)} />
            <table>
              <thead>
                <tr>
                  <th>Series</th>
                  <th>Commit</th>
                  <th>Measured At</th>
                  <th>Raw</th>
                  <th>Gzip</th>
                  <th>Brotli</th>
                </tr>
              </thead>
              <tbody>
                {data.trend.map((point) => (
                  <tr key={`${point.seriesId}:${point.commitGroupId}`}>
                    <td>{point.scenarioSlug} / {point.environment} / {point.entrypoint}</td>
                    <td>{shortSha(point.commitSha)}</td>
                    <td>{point.measuredAt}</td>
                    <td>{formatBytes(point.totalRawBytes)}</td>
                    <td>{formatBytes(point.totalGzipBytes)}</td>
                    <td>{formatBytes(point.totalBrotliBytes)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </section>

      <section>
        <h2>Repository Health</h2>
        {data.latestSummary ? (
          <>
            <p>Status: {data.latestSummary.status}</p>
            <p>Commit: {shortSha(data.latestSummary.commitSha)}</p>
            <p>Fresh scenarios: {data.latestSummary.counts.freshScenarioCount}</p>
            <p>Pending scenarios: {data.latestSummary.counts.pendingScenarioCount}</p>
            <p>Inherited scenarios: {data.latestSummary.counts.inheritedScenarioCount}</p>
            <p>Missing scenarios: {data.latestSummary.counts.missingScenarioCount}</p>
            <p>Failed scenarios: {data.latestSummary.counts.failedScenarioCount}</p>
            <p>Changed metrics: {data.latestSummary.counts.changedMetricCount}</p>
          </>
        ) : (
          <p>No settled branch summary is available yet.</p>
        )}
      </section>

      <section>
        <h2>Latest Important Compare</h2>
        {data.latestImportantCompare ? (
          <>
            <p>Scenario: {data.latestImportantCompare.scenarioSlug}</p>
            <p>
              Series: {data.latestImportantCompare.environment} /{" "}
              {data.latestImportantCompare.entrypoint} / {data.latestImportantCompare.lens}
            </p>
            <p>
              {formatBytes(data.latestImportantCompare.primaryItem.currentValue)} vs{" "}
              {formatBytes(data.latestImportantCompare.primaryItem.baselineValue)} ({" "}
              {formatSignedBytes(data.latestImportantCompare.primaryItem.deltaValue)},{" "}
              {formatSignedPercentage(data.latestImportantCompare.primaryItem.percentageDelta)})
            </p>
            <p>
              <Link
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
            </p>
          </>
        ) : (
          <p>No branch comparison is available for the latest summary yet.</p>
        )}
      </section>

      <section>
        <h2>Scenario Catalog</h2>
        <table>
          <thead>
            <tr>
              <th>Scenario</th>
              <th>State</th>
              <th>Primary Series</th>
              <th>Primary Delta</th>
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
        <td>{formatStateBadge(row.scenario.hasNewerFailedRun ? "warning" : "fresh")}</td>
        <td>{primarySeries ? formatSeriesLabel(primarySeries) : "No active series"}</td>
        <td>{primarySeries ? describeNeutralDelta(primarySeries, primaryItem) : "No delta"}</td>
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
            Scenario
          </Link>
          {primarySeries?.selectedBaseCommitSha ? (
            <>
              {" "}
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
            </>
          ) : null}
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
        <td>{formatStateBadge(row.scenario.state)}</td>
        <td>Not available on the active commit group</td>
        <td>{describeStatusScenarioDetail(row.scenario)}</td>
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
            Scenario
          </Link>
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
      <td>{formatStateBadge("known")}</td>
      <td>No active summary row yet</td>
      <td>Awaiting the first processed branch summary</td>
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
          Scenario
        </Link>
      </td>
    </tr>
  )
}
