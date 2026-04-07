import {
  DEFAULT_LENS_SLUG,
  nonEmptyStringSchema,
  publicScenarioRouteParamsSchema,
} from '@workspace/contracts'
import { Link, createFileRoute } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import * as v from 'valibot'

import {
  getScenarioPageData,
} from '../lib/public-read-models.server.js'
import {
  formatBytes,
  formatSignedBytes,
  formatSignedPercentage,
  shortSha,
} from '../lib/formatting.js'

const scenarioPageSearchSchema = v.strictObject({
  branch: v.optional(nonEmptyStringSchema),
  env: v.optional(nonEmptyStringSchema, 'all'),
  entrypoint: v.optional(nonEmptyStringSchema, 'all'),
  lens: v.optional(nonEmptyStringSchema, DEFAULT_LENS_SLUG),
  tab: v.optional(nonEmptyStringSchema),
})

const getScenarioPage = createServerFn({ method: 'GET' })
  .inputValidator(v.strictObject({
    params: publicScenarioRouteParamsSchema,
    search: scenarioPageSearchSchema,
  }))
  .handler(({ data, context }) => getScenarioPageData(context.env, {
    owner: data.params.owner,
    repo: data.params.repo,
    scenario: data.params.scenario,
    branch: data.search.branch,
    env: data.search.env,
    entrypoint: data.search.entrypoint,
    lens: data.search.lens,
    tab: data.search.tab,
  }))

export const Route = createFileRoute('/r/$owner/$repo/scenarios/$scenario')({
  validateSearch: scenarioPageSearchSchema,
  loaderDeps: ({ search }) => search,
  loader: ({ params, deps }) => getScenarioPage({
    data: {
      params,
      search: deps,
    },
  }),
  component: ScenarioPageRouteComponent,
})

type ScenarioPageData = ReturnType<typeof Route.useLoaderData>
type ScenarioHistorySeries = ScenarioPageData['history'][number]

function ScenarioPageRouteComponent() {
  const data = Route.useLoaderData()

  return (
    <main>
      <header>
        <p>
          <Link
            to="/r/$owner/$repo"
            from={Route.fullPath}
            search={{
              branch: data.branch,
              lens: data.lens,
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
        <p>Branch: {data.branch ?? 'No branch data yet'}</p>
        <p>Environment: {data.env}</p>
        <p>Entrypoint: {data.entrypoint}</p>
        <p>Lens: {data.lens}</p>
        <p>Available branches:</p>
        <ul>
          {data.branchOptions.map((branch) => (
            <li key={branch}>
              <Link
                to="/r/$owner/$repo/scenarios/$scenario"
                from={Route.fullPath}
                search={{
                  branch,
                  env: data.env,
                  entrypoint: data.entrypoint,
                  lens: data.lens,
                  tab: data.tab,
                }}
              >
                {branch}
              </Link>
            </li>
          ))}
        </ul>
        <p>Available environments:</p>
        <ul>
          <li>
            <Link
              to="/r/$owner/$repo/scenarios/$scenario"
              from={Route.fullPath}
              search={{
                branch: data.branch,
                env: 'all',
                entrypoint: 'all',
                lens: data.lens,
                tab: data.tab,
              }}
            >
              all
            </Link>
          </li>
          {data.environmentOptions.map((environment) => (
            <li key={environment}>
              <Link
                to="/r/$owner/$repo/scenarios/$scenario"
                from={Route.fullPath}
                search={{
                  branch: data.branch,
                  env: environment,
                  entrypoint: 'all',
                  lens: data.lens,
                  tab: data.tab,
                }}
              >
                {environment}
              </Link>
            </li>
          ))}
        </ul>
        <p>Available entrypoints:</p>
        <ul>
          <li>
            <Link
              to="/r/$owner/$repo/scenarios/$scenario"
              from={Route.fullPath}
              search={{
                branch: data.branch,
                env: data.env,
                entrypoint: 'all',
                lens: data.lens,
                tab: data.tab,
              }}
            >
              all
            </Link>
          </li>
          {data.entrypointOptions.map((entrypoint) => (
            <li key={entrypoint}>
              <Link
                from={Route.fullPath}
                to="/r/$owner/$repo/scenarios/$scenario"
                search={{
                  branch: data.branch,
                  env: data.env,
                  entrypoint,
                  lens: data.lens,
                  tab: data.tab,
                }}
              >
                {entrypoint}
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2>Latest Status</h2>
        {data.latestFreshScenario ? (
          <>
            <p>Active run: {shortSha(data.latestFreshScenario.activeCommitSha)}</p>
            <p>Uploaded at: {data.latestFreshScenario.activeUploadedAt}</p>
            <p>Processed runs: {data.latestFreshScenario.processedRunCount}</p>
            <p>Failed runs: {data.latestFreshScenario.failedRunCount}</p>
            <p>Newer failed rerun: {data.latestFreshScenario.hasNewerFailedRun ? 'yes' : 'no'}</p>
          </>
        ) : data.latestStatusScenario ? (
          <>
            <p>State: {data.latestStatusScenario.state}</p>
            <p>
              {data.latestStatusScenario.state === 'missing'
                ? data.latestStatusScenario.reason
                : 'The latest branch summary does not include a fresh run for this scenario.'}
            </p>
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
          data.history.map((series) => <ScenarioHistoryTable key={series.seriesId} series={series} />)
        )}
      </section>

      <section>
        <h2>Selected Series</h2>
        {data.selectedSeries ? (
          <>
            <p>
              {data.selectedSeries.series.environment} / {data.selectedSeries.series.entrypoint} /{' '}
              {data.selectedSeries.series.lens}
            </p>
            <p>{renderNeutralSeriesSummary(data.selectedSeries.series, data.selectedSeries.primaryItem)}</p>
          </>
        ) : (
          <p>Select a full series context (`env + entrypoint + lens`) to unlock the detail area.</p>
        )}
      </section>

      <section>
        <h2>Tabs</h2>
        <p>Current tab: {data.tab ?? 'history'}</p>
        <p>Detail widgets are structural only in this pass. Heavy compare detail payloads are not wired yet.</p>
      </section>
    </main>
  )
}

function ScenarioHistoryTable(props: { series: ScenarioHistorySeries }) {
  return (
    <article>
      <h3>
        {props.series.environment} / {props.series.entrypoint} / {props.series.lens}
      </h3>
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
          {props.series.points.map((point: ScenarioHistorySeries['points'][number]) => (
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

function renderNeutralSeriesSummary(
  series: {
    status: string
    failureMessage?: string
  } & {
    currentTotals: { brotli: number }
    baselineTotals: { brotli: number } | null
  },
  primaryItem: {
    deltaValue: number
    percentageDelta: number
  } | null,
) {
  if (series.status === 'failed') {
    return `Comparison failed: ${series.failureMessage ?? 'Comparison materialization failed.'}`
  }

  if (series.status === 'no-baseline' || !series.baselineTotals) {
    return 'No baseline is available for this series yet.'
  }

  if (!primaryItem) {
    return `Brotli total unchanged at ${formatBytes(series.currentTotals.brotli)}.`
  }

  return `${formatBytes(series.currentTotals.brotli)} vs ${formatBytes(series.baselineTotals.brotli)} (${formatSignedBytes(primaryItem.deltaValue)}, ${formatSignedPercentage(primaryItem.percentageDelta)})`
}
