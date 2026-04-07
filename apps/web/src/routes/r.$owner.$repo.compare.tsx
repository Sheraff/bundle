import {
  DEFAULT_LENS_SLUG,
  gitShaSchema,
  nonAllStringSchema,
  nonEmptyStringSchema,
  positiveIntegerSchema,
  publicRepositoryRouteParamsSchema,
  scenarioSlugSchema,
} from '@workspace/contracts'
import { Link, createFileRoute } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import * as v from 'valibot'

import { getComparePageData } from '../lib/public-read-models.server.js'
import {
  formatBytes,
  formatSignedBytes,
  formatSignedPercentage,
  shortSha,
} from '../lib/formatting.js'

const comparePageSearchSchema = v.strictObject({
  base: gitShaSchema,
  head: gitShaSchema,
  pr: v.optional(positiveIntegerSchema),
  scenario: v.optional(scenarioSlugSchema),
  env: v.optional(nonAllStringSchema),
  entrypoint: v.optional(nonAllStringSchema),
  lens: v.optional(nonEmptyStringSchema),
  tab: v.optional(nonEmptyStringSchema),
})

const getComparePage = createServerFn({ method: 'GET' })
  .inputValidator(v.strictObject({
    params: publicRepositoryRouteParamsSchema,
    search: comparePageSearchSchema,
  }))
  .handler(({ data, context }) => getComparePageData(context.env, {
    owner: data.params.owner,
    repo: data.params.repo,
    search: data.search,
  }))

export const Route = createFileRoute('/r/$owner/$repo/compare')({
  validateSearch: comparePageSearchSchema,
  loaderDeps: ({ search }) => search,
  loader: ({ params, deps }) => getComparePage({
    data: {
      params,
      search: deps,
    },
  }),
  component: ComparePageRouteComponent,
})

function ComparePageRouteComponent() {
  const data = Route.useLoaderData()
  const search = Route.useSearch()

  return (
    <main>
      <header>
        <p>
          <Link
            from={Route.fullPath}
            to="/r/$owner/$repo"
            search={{
              branch: data.latestSummary?.branch ?? data.latestReviewSummary?.branch,
              lens: search.lens ?? DEFAULT_LENS_SLUG,
            }}
          >
            {data.repository.owner}/{data.repository.name}
          </Link>
        </p>
        <h1>{data.mode === 'pr' ? 'PR Compare' : 'Compare'}</h1>
        <p>
          Base {shortSha(search.base)} to head {shortSha(search.head)}
          {search.pr ? ` for PR #${search.pr}` : ''}
        </p>
      </header>

      <section>
        <h2>Context</h2>
        <p>Requested scenario: {search.scenario ?? 'all'}</p>
        <p>Requested environment: {search.env ?? 'all'}</p>
        <p>Requested entrypoint: {search.entrypoint ?? 'all'}</p>
        <p>Requested lens: {search.lens ?? 'table mode'}</p>
        <p>Requested tab: {search.tab ?? 'summary'}</p>
        <p>Stored compare context matched: {data.contextMatched ? 'yes' : 'no'}</p>
      </section>

      <section>
        <h2>Status Block</h2>
        {data.statusScenarios.length === 0 ? (
          <p>No inherited, missing, or failed scenario states are attached to this compare context.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Scenario</th>
                <th>State</th>
                <th>Detail</th>
              </tr>
            </thead>
            <tbody>
              {data.statusScenarios.map((scenario) => (
                <tr key={`${scenario.state}:${scenario.scenarioId}`}>
                  <td>{scenario.scenarioSlug}</td>
                  <td>{scenario.state}</td>
                  <td>
                    {scenario.state === 'missing'
                      ? scenario.reason
                      : scenario.state === 'failed'
                        ? scenario.failureMessage ?? 'Scenario rerun failed.'
                        : `Inherited from ${shortSha(scenario.sourceCommitSha)}`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section>
        <h2>Series Table</h2>
        {data.mode === 'pr' ? (
          <ReviewedRowsTable />
        ) : (
          <NeutralRowsTable />
        )}
      </section>

      <section>
        <h2>Selected Series Detail</h2>
        {data.mode === 'pr' ? (
          data.selectedReviewedRow ? (
            <ReviewedRowDetail />
          ) : (
            <p>Select `scenario + env + entrypoint + lens` to unlock the detail outline.</p>
          )
        ) : data.selectedNeutralRow ? (
          <NeutralRowDetail />
        ) : (
          <p>Select `scenario + env + entrypoint + lens` to unlock the detail outline.</p>
        )}
      </section>

      <section>
        <h2>Tabs</h2>
        <p>Current tab: {search.tab ?? 'summary'}</p>
        <p>
          Treemap, graph, waterfall, and deeper diff widgets are placeholders in this pass. The page structure and
          read paths are wired, but detail payload generation is still pending.
        </p>
      </section>
    </main>
  )
}

function NeutralRowsTable() {
  const data = Route.useLoaderData()
  return data.neutralRows.length === 0 ? (
    <p>No neutral comparison rows matched the selected base/head and series filters.</p>
  ) : (
    <table>
      <thead>
        <tr>
          <th>Scenario</th>
          <th>Series</th>
          <th>Status</th>
          <th>Delta</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody>
        {data.neutralRows.map((row) => (
          <tr key={row.series.seriesId}>
            <td>{row.scenarioSlug}</td>
            <td>
              {row.series.environment} / {row.series.entrypoint} / {row.series.lens}
            </td>
            <td>{row.series.status}</td>
            <td>{renderNeutralDelta(row.series, row.primaryItem)}</td>
            <td>
              <Link
                to="/r/$owner/$repo/scenarios/$scenario"
                params={{
                  owner: data.repository.owner,
                  repo: data.repository.name,
                  scenario: row.scenarioSlug,
                }}
                search={{
                  branch: data.latestSummary?.branch,
                  env: row.series.environment,
                  entrypoint: row.series.entrypoint,
                  lens: row.series.lens,
                }}
              >
                Scenario
              </Link>
              {row.series.selectedBaseCommitSha ? (
                <>
                  {' '}
                  <Link
                    to="/r/$owner/$repo/compare"
                    params={{
                      owner: data.repository.owner,
                      repo: data.repository.name,
                    }}
                    search={{
                      base: row.series.selectedBaseCommitSha,
                      head: row.series.selectedHeadCommitSha,
                      scenario: row.scenarioSlug,
                      env: row.series.environment,
                      entrypoint: row.series.entrypoint,
                      lens: row.series.lens,
                    }}
                  >
                    Focus
                  </Link>
                </>
              ) : null}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function ReviewedRowsTable() {
  const data = Route.useLoaderData()
  const search = Route.useSearch()
  return data.reviewedRows.length === 0 ? (
    <p>No PR comparison rows matched the selected series filters.</p>
  ) : (
    <table>
      <thead>
        <tr>
          <th>Scenario</th>
          <th>Series</th>
          <th>Review State</th>
          <th>Delta</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody>
        {data.reviewedRows.map((row) => (
          <tr key={row.series.seriesId}>
            <td>{row.scenarioSlug}</td>
            <td>
              {row.series.environment} / {row.series.entrypoint} / {row.series.lens}
            </td>
            <td>{row.series.reviewState}</td>
            <td>{renderReviewedDelta(row.series, row.primaryItem)}</td>
            <td>
              <Link
                to="/r/$owner/$repo/scenarios/$scenario"
                params={{
                  owner: data.repository.owner,
                  repo: data.repository.name,
                  scenario: row.scenarioSlug,
                }}
                search={{
                  branch: data.latestReviewSummary?.branch,
                  env: row.series.environment,
                  entrypoint: row.series.entrypoint,
                  lens: row.series.lens,
                }}
              >
                Scenario
              </Link>{' '}
              <Link
                from={Route.fullPath}
                to="/r/$owner/$repo/compare"
                search={{
                  base: search.base,
                  head: search.head,
                  pr: search.pr,
                  scenario: row.scenarioSlug,
                  env: row.series.environment,
                  entrypoint: row.series.entrypoint,
                  lens: row.series.lens,
                }}
              >
                Focus
              </Link>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function NeutralRowDetail() {
  const row = Route.useLoaderData().selectedNeutralRow!

  return (
    <>
      <p>Scenario: {row.scenarioSlug}</p>
      <p>
        Series: {row.series.environment} / {row.series.entrypoint} / {row.series.lens}
      </p>
      <p>Status: {row.series.status}</p>
      <p>{renderNeutralDelta(row.series, row.primaryItem)}</p>
      <p>Selected entrypoint relation: {row.series.selectedEntrypointRelation ?? 'unknown'}</p>
      <p>Degraded stable identity: {row.series.hasDegradedStableIdentity ? 'yes' : 'no'}</p>
    </>
  )
}

function ReviewedRowDetail() {
  const row = Route.useLoaderData().selectedReviewedRow!

  return (
    <>
      <p>Scenario: {row.scenarioSlug}</p>
      <p>
        Series: {row.series.environment} / {row.series.entrypoint} / {row.series.lens}
      </p>
      <p>Scenario review state: {row.scenarioReviewState}</p>
      <p>Series review state: {row.series.reviewState}</p>
      <p>{renderReviewedDelta(row.series, row.primaryItem)}</p>
      <p>Acknowledged items on this scenario: {row.acknowledgedItemCount}</p>
    </>
  )
}

function renderNeutralDelta(
  series: {
    status: string
    currentTotals: { brotli: number }
    baselineTotals: { brotli: number } | null
    failureMessage?: string
  },
  primaryItem: {
    deltaValue: number
    percentageDelta: number
  } | null,
) {
  if (series.status === 'failed') {
    return `Failed: ${series.failureMessage ?? 'Comparison materialization failed.'}`
  }

  if (series.status === 'no-baseline' || !series.baselineTotals) {
    return 'No baseline'
  }

  if (!primaryItem) {
    return `Unchanged at ${formatBytes(series.currentTotals.brotli)}`
  }

  return `${formatSignedBytes(primaryItem.deltaValue)} (${formatSignedPercentage(primaryItem.percentageDelta)})`
}

function renderReviewedDelta(
  series: {
    status: string
    currentTotals: { brotli: number }
    baselineTotals: { brotli: number } | null
    failureMessage?: string
  },
  primaryItem: {
    deltaValue: number
    percentageDelta: number
    reviewState?: string
  } | null,
) {
  if (series.status === 'failed') {
    return `Failed: ${series.failureMessage ?? 'Comparison materialization failed.'}`
  }

  if (series.status === 'no-baseline' || !series.baselineTotals) {
    return 'No baseline'
  }

  if (!primaryItem) {
    return `Unchanged at ${formatBytes(series.currentTotals.brotli)}`
  }

  return `${formatSignedBytes(primaryItem.deltaValue)} (${formatSignedPercentage(primaryItem.percentageDelta)}) ${primaryItem.reviewState ?? ''}`.trim()
}
