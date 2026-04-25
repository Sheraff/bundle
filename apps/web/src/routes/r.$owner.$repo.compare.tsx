import {
  DEFAULT_LENS_SLUG,
  acknowledgeComparisonItemInputSchema,
  gitShaSchema,
  nonAllStringSchema,
  nonEmptyStringSchema,
  positiveIntegerSchema,
  publicRepositoryRouteParamsSchema,
  scenarioSlugSchema,
} from "@workspace/contracts"
import { Link, createFileRoute, useRouter } from "@tanstack/react-router"
import { createServerFn, useServerFn } from "@tanstack/react-start"
import { getRequest, setResponseStatus } from "@tanstack/react-start/server"
import { useState } from "react"
import * as v from "valibot"

import { SelectedSeriesDetailView } from "../components/selected-series-detail.js"
import { MetricSelector, TabSelector } from "../components/url-controls.js"
import {
  AcknowledgementAuthorizationError,
  AcknowledgementNotFoundError,
  AcknowledgementValidationError,
  acknowledgeComparisonItemForUser,
} from "../acknowledgements.js"
import { AuthRequiredError, requireUser } from "../auth/session.js"
import {
  getNeutralComparePageData,
  getPullRequestComparePageData,
} from "../lib/public-read-models.server.js"
import { formatBytes, shortSha } from "../lib/formatting.js"
import {
  describeNeutralDelta,
  describeReviewedDelta,
  describeReviewedSeriesState,
  describeScenarioReviewState,
  describeStatusScenarioDetail,
  formatSeriesLabel,
} from "../lib/public-route-presentation.js"

const compareTabs = ["summary", "treemap", "graph", "waterfall", "assets", "packages", "budget", "identity"] as const

const comparePageSearchSchema = v.strictObject({
  base: gitShaSchema,
  head: gitShaSchema,
  pr: v.optional(positiveIntegerSchema),
  scenario: v.optional(scenarioSlugSchema),
  env: v.optional(nonAllStringSchema),
  entrypoint: v.optional(nonAllStringSchema),
  lens: v.optional(nonEmptyStringSchema),
  tab: v.optional(nonEmptyStringSchema),
  metric: v.optional(nonEmptyStringSchema),
})

const getComparePage = createServerFn({ method: "GET" })
  .inputValidator(
    v.strictObject({
      params: publicRepositoryRouteParamsSchema,
      search: comparePageSearchSchema,
    }),
  )
  .handler(({ data, context }) =>
    data.search.pr
      ? getPullRequestComparePageData(context.env, {
          owner: data.params.owner,
          repo: data.params.repo,
          search: {
            ...data.search,
            pr: data.search.pr,
          },
        })
      : getNeutralComparePageData(context.env, {
          owner: data.params.owner,
          repo: data.params.repo,
          search: data.search,
        }),
  )

const acknowledgeComparisonItem = createServerFn({ method: "POST" })
  .inputValidator(acknowledgeComparisonItemInputSchema)
  .handler(async ({ context, data }) => {
    const request = getRequest()

    let user: Awaited<ReturnType<typeof requireUser>>

    try {
      user = await requireUser(context.env, request)
    } catch (error) {
      if (error instanceof AuthRequiredError) {
        setResponseStatus(401)
        return {
          kind: "error" as const,
          message: "Sign in with GitHub to acknowledge regressions.",
        }
      }

      throw error
    }

    try {
      const acknowledgement = await acknowledgeComparisonItemForUser(context.env, user, data)

      return {
        kind: "ok" as const,
        acknowledgementId: acknowledgement.acknowledgementId,
      }
    } catch (error) {
      if (error instanceof AcknowledgementAuthorizationError) {
        setResponseStatus(403)
      } else if (error instanceof AcknowledgementNotFoundError) {
        setResponseStatus(404)
      } else if (error instanceof AcknowledgementValidationError) {
        setResponseStatus(422)
      } else {
        throw error
      }

      return {
        kind: "error" as const,
        message: error instanceof Error ? error.message : "Could not acknowledge item.",
      }
    }
  })

export const Route = createFileRoute("/r/$owner/$repo/compare")({
  validateSearch: comparePageSearchSchema,
  loaderDeps: ({ search }) => search,
  loader: ({ params, deps }) =>
    getComparePage({
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
  const tab = compareTabs.includes(search.tab as (typeof compareTabs)[number])
    ? (search.tab as (typeof compareTabs)[number])
    : "summary"
  const rows = data.mode === "pr" ? data.reviewedRows : data.neutralRows

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
              metric: data.metric,
            }}
          >
            {data.repository.owner}/{data.repository.name}
          </Link>
        </p>
        <h1>{data.mode === "pr" ? "PR Compare" : "Compare"}</h1>
        <p>
          Base {shortSha(search.base)} to head {shortSha(search.head)}
          {search.pr ? ` for PR #${search.pr}` : ""}
        </p>
      </header>

      <CompareBuilder />

      <section>
        <h2>Context</h2>
        <p>Requested scenario: {search.scenario ?? "all"}</p>
        <p>Requested environment: {search.env ?? "all"}</p>
        <p>Requested entrypoint: {search.entrypoint ?? "all"}</p>
        <p>Requested lens: {search.lens ?? "table mode"}</p>
        <p>Requested metric: {data.metric}</p>
        <p>Requested tab: {tab}</p>
        <p>Stored compare context matched: {data.contextMatched ? "yes" : "no"}</p>
      </section>

      <section>
        <h2>Series Selectors</h2>
        <CompareFilterLinks rows={rows} />
        <MetricSelector current={data.metric} searchFor={(metric) => compareSearch(search, { metric })} />
      </section>

      <section>
        <h2>Status Block</h2>
        {data.statusScenarios.length === 0 ? (
          <p>
            No inherited, missing, or failed scenario states are attached to this compare context.
          </p>
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
                  <td>{describeStatusScenarioDetail(scenario)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section>
        <h2>Series Table</h2>
        {data.mode === "pr" ? <ReviewedRowsTable /> : <NeutralRowsTable />}
      </section>

      <section>
        <h2>Selected Series Detail</h2>
        {data.mode === "pr" ? (
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
        <h2>Detail Tabs</h2>
        <TabSelector current={tab} tabs={compareTabs} searchFor={(nextTab) => compareSearch(search, { tab: nextTab })} />
        <SelectedSeriesDetailView
          detail={tab === "summary" ? null : data.selectedDetail}
          metric={data.metric}
          mode="compare"
          tab={tab}
          budgetState={(data.selectedNeutralRow ?? data.selectedReviewedRow)?.series.budgetState}
          hasDegradedStableIdentity={(data.selectedNeutralRow ?? data.selectedReviewedRow)?.series.hasDegradedStableIdentity}
        />
      </section>
    </main>
  )
}

function CompareBuilder() {
  const data = Route.useLoaderData()
  const search = Route.useSearch()
  const options = data.commitOptions

  return (
    <section>
      <h2>Compare Builder</h2>
      {options.length < 2 ? (
        <p>At least two known commit groups are needed to build an arbitrary comparison.</p>
      ) : (
        <form action={`/r/${data.repository.owner}/${data.repository.name}/compare`} method="get">
          <label>
            Base
            <select name="base" defaultValue={quoteSearchString(search.base)}>
              {options.map((option) => <option key={`base:${option.commitSha}`} value={quoteSearchString(option.commitSha)}>{compareOptionLabel(option)}</option>)}
            </select>
          </label>
          <label>
            Head
            <select name="head" defaultValue={quoteSearchString(search.head)}>
              {options.map((option) => <option key={`head:${option.commitSha}`} value={quoteSearchString(option.commitSha)}>{compareOptionLabel(option)}</option>)}
            </select>
          </label>
          {search.pr ? <input type="hidden" name="pr" value={search.pr} /> : null}
          {search.scenario ? <input type="hidden" name="scenario" value={search.scenario} /> : null}
          {search.env ? <input type="hidden" name="env" value={search.env} /> : null}
          {search.entrypoint ? <input type="hidden" name="entrypoint" value={search.entrypoint} /> : null}
          {search.lens ? <input type="hidden" name="lens" value={search.lens} /> : null}
          <input type="hidden" name="metric" value={data.metric} />
          <button type="submit">Open compare</button>
        </form>
      )}
    </section>
  )
}

function CompareFilterLinks(props: {
  rows: Array<ReturnType<typeof Route.useLoaderData>["neutralRows"][number] | ReturnType<typeof Route.useLoaderData>["reviewedRows"][number]>
}) {
  const search = Route.useSearch()
  const scenarios = unique(props.rows.map((row) => row.scenarioSlug))
  const environments = unique(props.rows.map((row) => row.series.environment))
  const entrypoints = unique(props.rows.map((row) => row.series.entrypoint))
  const lenses = unique(props.rows.map((row) => row.series.lens))

  return (
    <>
      <FilterGroup label="Scenario" values={scenarios} searchFor={(scenario) => compareSearch(search, { scenario })} />
      <FilterGroup label="Environment" values={environments} searchFor={(env) => compareSearch(search, { env })} />
      <FilterGroup label="Entrypoint" values={entrypoints} searchFor={(entrypoint) => compareSearch(search, { entrypoint })} />
      <FilterGroup label="Lens" values={lenses} searchFor={(lens) => compareSearch(search, { lens })} />
    </>
  )
}

function FilterGroup(props: {
  label: string
  values: string[]
  searchFor: (value: string | undefined) => Record<string, unknown>
}) {
  return (
    <section>
      <h3>{props.label}</h3>
      {props.values.length === 0 ? <p>No options are available for the current compare.</p> : (
        <ul>
          <li><Link from={Route.fullPath} to="/r/$owner/$repo/compare" search={props.searchFor(undefined) as never}>all</Link></li>
          {props.values.map((value) => <li key={value}><Link from={Route.fullPath} to="/r/$owner/$repo/compare" search={props.searchFor(value) as never}>{value}</Link></li>)}
        </ul>
      )}
    </section>
  )
}

function compareSearch(
  current: ReturnType<typeof Route.useSearch>,
  updates: Partial<Record<"scenario" | "env" | "entrypoint" | "lens" | "tab" | "metric", string | undefined>>,
) {
  return {
    base: current.base,
    head: current.head,
    pr: current.pr,
    scenario: "scenario" in updates ? updates.scenario : current.scenario,
    env: "env" in updates ? updates.env : current.env,
    entrypoint: "entrypoint" in updates ? updates.entrypoint : current.entrypoint,
    lens: "lens" in updates ? updates.lens : current.lens,
    tab: "tab" in updates ? updates.tab : current.tab,
    metric: "metric" in updates ? updates.metric : current.metric,
  }
}

function unique(values: string[]) {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right))
}

function compareOptionLabel(option: ReturnType<typeof Route.useLoaderData>["commitOptions"][number]) {
  const pr = option.prNumber ? ` PR #${option.prNumber}` : ""
  return `${shortSha(option.commitSha)} on ${option.branch}${pr}`
}

function quoteSearchString(value: string) {
  return JSON.stringify(value)
}

function NeutralRowsTable() {
  const data = Route.useLoaderData()
  const search = Route.useSearch()
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
            <td>{formatSeriesLabel(row.series)}</td>
            <td>{row.series.status}</td>
            <td>{describeNeutralDelta(row.series, row.primaryItem)}</td>
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
                  metric: data.metric,
                }}
              >
                Scenario
              </Link>
              {row.series.selectedBaseCommitSha ? (
                <>
                  {" "}
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
                      tab: search.tab,
                      metric: data.metric,
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
            <td>{formatSeriesLabel(row.series)}</td>
            <td>{describeReviewedSeriesState(row.series)}</td>
            <td>{describeReviewedDelta(row.series, row.primaryItem)}</td>
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
                  metric: data.metric,
                }}
              >
                Scenario
              </Link>{" "}
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
                  tab: search.tab,
                  metric: data.metric,
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
      <p>Series: {formatSeriesLabel(row.series)}</p>
      <p>Status: {row.series.status}</p>
      <p>{describeNeutralDelta(row.series, row.primaryItem, { detailed: true })}</p>
      <p>Selected entrypoint relation: {row.series.selectedEntrypointRelation ?? "unknown"}</p>
      <p>Degraded stable identity: {row.series.hasDegradedStableIdentity ? "yes" : "no"}</p>
    </>
  )
}

function ReviewedRowDetail() {
  const data = Route.useLoaderData()
  const row = data.selectedReviewedRow!

  return (
    <>
      <p>Scenario: {row.scenarioSlug}</p>
      <p>Series: {formatSeriesLabel(row.series)}</p>
      <p>Scenario review state: {describeScenarioReviewState(row.scenarioReviewState)}</p>
      <p>Series review state: {describeReviewedSeriesState(row.series)}</p>
      <p>{describeReviewedDelta(row.series, row.primaryItem)}</p>
      <p>Acknowledged items on this scenario: {row.acknowledgedItemCount}</p>
      {row.series.status === "materialized" ? (
        <ul>
          {row.series.items.map((item) => (
            <li key={item.itemKey}>
              <p>
                {item.metricKey}: {formatBytes(item.currentValue)} vs{" "}
                {formatBytes(item.baselineValue)}
              </p>
              <p>Review state: {item.reviewState}</p>
              {item.acknowledged ? (
                <p>Acknowledged{item.note ? `: ${item.note}` : ""}</p>
              ) : item.reviewState === "blocking" || item.reviewState === "regression" ? (
                <AcknowledgeComparisonItemForm itemKey={item.itemKey} row={row} />
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </>
  )
}

function AcknowledgeComparisonItemForm({
  itemKey,
  row,
}: {
  itemKey: string
  row: NonNullable<ReturnType<typeof Route.useLoaderData>["selectedReviewedRow"]>
}) {
  const data = Route.useLoaderData()
  const acknowledgeItem = useServerFn(acknowledgeComparisonItem)
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState("")
  const [pending, setPending] = useState(false)

  if (!data.latestReviewSummary) {
    return null
  }

  return (
    <form
      onSubmit={async (event) => {
        event.preventDefault()
        setError(null)
        setPending(true)

        try {
          const result = await acknowledgeItem({
            data: {
              comparisonId: row.series.comparisonId,
              itemKey,
              note: note.length > 0 ? note : undefined,
              pullRequestId: data.latestReviewSummary!.pullRequestId,
              repositoryId: data.latestReviewSummary!.repositoryId,
              seriesId: row.series.seriesId,
            },
          })

          if (result.kind === "error") {
            setError(result.message)
            return
          }

          await router.invalidate()
        } finally {
          setPending(false)
        }
      }}
    >
      <label>
        Acknowledgement note
        <input
          maxLength={4000}
          onChange={(event) => setNote(event.currentTarget.value)}
          value={note}
        />
      </label>
      <button disabled={pending} type="submit">
        Acknowledge regression
      </button>
      {error ? <p>{error}</p> : null}
    </form>
  )
}
