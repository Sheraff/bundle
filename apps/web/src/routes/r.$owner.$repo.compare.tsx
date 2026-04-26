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
import { StateBadge } from "../components/state-badge.js"
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
  describeScenarioReviewState,
  describeStatusScenarioDetail,
  formatSeriesLabel,
} from "../lib/public-route-presentation.js"

import "./repo-shared.css"
import "./r.$owner.$repo.compare.css"
import "../components/compare-form.css"

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
    <main className="page repo-page">
      <header className="page-header">
        <p className="breadcrumb">
          <Link to="/">Home</Link>
          <span aria-hidden="true">/</span>
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
          <span aria-hidden="true">/</span>
          <span>{data.mode === "pr" ? "PR Compare" : "Compare"}</span>
        </p>
        <h1>
          <span className="mono">{shortSha(search.base)}</span>
          <span data-sep aria-hidden="true">→</span>
          <span className="mono">{shortSha(search.head)}</span>
          {search.pr ? <span data-owner> · PR #{search.pr}</span> : null}
        </h1>
      </header>

      <CompareBuilder />

      <section className="section">
        <h2>Context</h2>
        <dl className="context-summary">
          <div><dt>Scenario</dt><dd>{search.scenario ?? "all"}</dd></div>
          <div><dt>Environment</dt><dd>{search.env ?? "all"}</dd></div>
          <div><dt>Entrypoint</dt><dd>{search.entrypoint ?? "all"}</dd></div>
          <div><dt>Lens</dt><dd>{search.lens ?? "—"}</dd></div>
          <div><dt>Metric</dt><dd>{data.metric}</dd></div>
          <div><dt>Tab</dt><dd>{tab}</dd></div>
          <div><dt>Stored ctx</dt><dd>{data.contextMatched ? "matched" : "fallback"}</dd></div>
        </dl>
      </section>

      <section className="section">
        <h2>Series filters</h2>
        <div className="filters-bar">
          <CompareFilterLinks rows={rows} />
          <MetricSelector current={data.metric} searchFor={(metric) => compareSearch(search, { metric })} />
        </div>
      </section>

      <section className="section">
        <h2>Status block</h2>
        {data.statusScenarios.length === 0 ? (
          <p className="notice">No inherited, missing, or failed scenario states are attached to this compare context.</p>
        ) : (
          <div className="table-scroll">
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
                    <td><StateBadge state={scenario.state} /></td>
                    <td className="text-muted">{describeStatusScenarioDetail(scenario)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="section">
        <h2>Series table</h2>
        {data.mode === "pr" ? <ReviewedRowsTable /> : <NeutralRowsTable />}
      </section>

      <section className="section">
        <h2>Selected series detail</h2>
        {data.mode === "pr" ? (
          data.selectedReviewedRow ? (
            <ReviewedRowDetail />
          ) : (
            <p className="notice">Select <code>scenario + env + entrypoint + lens</code> to unlock the detail outline.</p>
          )
        ) : data.selectedNeutralRow ? (
          <NeutralRowDetail />
        ) : (
          <p className="notice">Select <code>scenario + env + entrypoint + lens</code> to unlock the detail outline.</p>
        )}
      </section>

      <section className="section">
        <h2>Detail tabs</h2>
        <TabSelector current={tab} tabs={compareTabs} searchFor={(nextTab) => compareSearch(search, { tab: nextTab })} />
        <SelectedSeriesDetailView
          detail={tab === "summary" ? null : data.selectedDetail}
          metric={data.metric}
          mode="compare"
          tab={tab}
          treemapTimeline={data.selectedTreemapTimeline}
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
    <section className="section">
      <h2>Compare builder</h2>
      {options.length < 2 ? (
        <p className="notice">At least two known commit groups are needed to build an arbitrary comparison.</p>
      ) : (
        <form
          className="compare-form"
          action={`/r/${data.repository.owner}/${data.repository.name}/compare`}
          method="get"
        >
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
      <FilterGroup label="Scenario" current={search.scenario ?? null} values={scenarios} searchFor={(scenario) => compareSearch(search, { scenario })} />
      <FilterGroup label="Environment" current={search.env ?? null} values={environments} searchFor={(env) => compareSearch(search, { env })} />
      <FilterGroup label="Entrypoint" current={search.entrypoint ?? null} values={entrypoints} searchFor={(entrypoint) => compareSearch(search, { entrypoint })} />
      <FilterGroup label="Lens" current={search.lens ?? null} values={lenses} searchFor={(lens) => compareSearch(search, { lens })} />
    </>
  )
}

function FilterGroup(props: {
  label: string
  current: string | null
  values: string[]
  searchFor: (value: string | undefined) => Record<string, unknown>
}) {
  return (
    <section className="selector">
      <h3>
        {props.label}
        <small>{props.current ?? "all"}</small>
      </h3>
      {props.values.length === 0 ? (
        <p>No options available.</p>
      ) : (
        <ul>
          <li>
            <Link
              from={Route.fullPath}
              to="/r/$owner/$repo/compare"
              search={props.searchFor(undefined) as never}
              aria-current={props.current === null ? "true" : undefined}
            >
              all
            </Link>
          </li>
          {props.values.map((value) => (
            <li key={value}>
              <Link
                from={Route.fullPath}
                to="/r/$owner/$repo/compare"
                search={props.searchFor(value) as never}
                aria-current={value === props.current ? "true" : undefined}
              >
                {value}
              </Link>
            </li>
          ))}
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
    <p className="notice">No neutral comparison rows matched the selected base/head and series filters.</p>
  ) : (
    <div className="table-scroll">
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
              <td><StateBadge state={row.series.status} /></td>
              <td className="num mono">{describeNeutralDelta(row.series, row.primaryItem)}</td>
              <td>
                <span className="row-actions">
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
                  ) : null}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function ReviewedRowsTable() {
  const data = Route.useLoaderData()
  const search = Route.useSearch()
  return data.reviewedRows.length === 0 ? (
    <p className="notice">No PR comparison rows matched the selected series filters.</p>
  ) : (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            <th>Scenario</th>
            <th>Series</th>
            <th>Review state</th>
            <th>Delta</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {data.reviewedRows.map((row) => (
            <tr key={row.series.seriesId}>
              <td>{row.scenarioSlug}</td>
              <td>{formatSeriesLabel(row.series)}</td>
              <td><StateBadge state={row.series.reviewState} /></td>
              <td className="num mono">{describeReviewedDelta(row.series, row.primaryItem)}</td>
              <td>
                <span className="row-actions">
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
                  </Link>
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
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function NeutralRowDetail() {
  const row = Route.useLoaderData().selectedNeutralRow!

  return (
    <dl className="context-summary">
      <div><dt>Scenario</dt><dd>{row.scenarioSlug}</dd></div>
      <div><dt>Series</dt><dd>{formatSeriesLabel(row.series)}</dd></div>
      <div><dt>Status</dt><dd><StateBadge state={row.series.status} /></dd></div>
      <div><dt>Delta</dt><dd>{describeNeutralDelta(row.series, row.primaryItem, { detailed: true })}</dd></div>
      <div><dt>Entrypoint relation</dt><dd>{row.series.selectedEntrypointRelation ?? "unknown"}</dd></div>
      <div><dt>Stable identity</dt><dd>{row.series.hasDegradedStableIdentity ? "degraded" : "ok"}</dd></div>
    </dl>
  )
}

function ReviewedRowDetail() {
  const data = Route.useLoaderData()
  const row = data.selectedReviewedRow!

  return (
    <>
      <dl className="context-summary">
        <div><dt>Scenario</dt><dd>{row.scenarioSlug}</dd></div>
        <div><dt>Series</dt><dd>{formatSeriesLabel(row.series)}</dd></div>
        <div><dt>Scenario review</dt><dd>{describeScenarioReviewState(row.scenarioReviewState)}</dd></div>
        <div><dt>Series review</dt><dd><StateBadge state={row.series.reviewState} /></dd></div>
        <div><dt>Delta</dt><dd>{describeReviewedDelta(row.series, row.primaryItem)}</dd></div>
        <div><dt>Acknowledged items</dt><dd>{row.acknowledgedItemCount}</dd></div>
      </dl>
      {row.series.status === "materialized" ? (
        <ul className="item-list">
          {row.series.items.map((item) => (
            <li key={item.itemKey}>
              <p>
                {item.metricKey}: {formatBytes(item.currentValue)}
                <span className="text-muted"> vs </span>
                {formatBytes(item.baselineValue)}
              </p>
              <p>
                Review state: <StateBadge state={item.reviewState} />
              </p>
              {item.acknowledged ? (
                <p>
                  <StateBadge state="acknowledged" />
                  {item.note ? <span className="text-secondary"> {item.note}</span> : null}
                </p>
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
      className="ack-form"
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
          placeholder="Why is this regression acceptable?"
        />
      </label>
      <button disabled={pending} type="submit">
        {pending ? "Acknowledging…" : "Acknowledge regression"}
      </button>
      {error ? <p>{error}</p> : null}
    </form>
  )
}

