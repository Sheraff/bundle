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
import { OutputRowCard } from "../components/output-row.js"
import { StateBadge } from "../components/state-badge.js"
import { LinkSelector, MetricSelector, TabSelector } from "../components/url-controls.js"
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
  type ReviewOutputRow as ReviewOutputRowReadModel,
  type UnionPairOutputRow,
} from "../lib/public-read-models.server.js"
import { formatBytes, formatSignedBytes, shortSha } from "../lib/formatting.js"
import {
  canOpenReviewEvidence,
  reviewEvidenceUnavailableReason,
  reviewVerdict,
  shouldExpandReviewScenarioGroup,
} from "../lib/review-mode.js"
import {
  buildReleaseReadinessReport,
  type ReleaseReadinessReport,
  type ReleaseReadinessTarget,
} from "../lib/release-readiness.js"
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
  preset: v.optional(v.union([v.literal("release-last-release"), v.literal("release-main"), v.literal("release-tag")])),
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

type ComparePageData = ReturnType<typeof Route.useLoaderData>
type ReviewOutputRow = ReviewOutputRowReadModel

function ComparePageRouteComponent() {
  const data = Route.useLoaderData()
  const search = Route.useSearch()
  const tab = compareTabs.includes(search.tab as (typeof compareTabs)[number])
    ? (search.tab as (typeof compareTabs)[number])
    : "summary"
  if (data.mode === "pr") {
    return <ReviewModePage tab={tab} />
  }

  return (
    <main className="page repo-page compare-page">
      <header className="page-header">
        <p className="breadcrumb">
          <Link to="/">Home</Link>
          <span aria-hidden="true">/</span>
          <Link
            from={Route.fullPath}
            to="/r/$owner/$repo"
            search={{
              branch: data.latestSummary?.branch,
              lens: search.lens ?? DEFAULT_LENS_SLUG,
              metric: data.metric,
            }}
          >
            {data.repository.owner}/{data.repository.name}
          </Link>
          <span aria-hidden="true">/</span>
          <span>Compare</span>
        </p>
        <h1>
          <span className="mono">{shortSha(search.base)}</span>
          <span data-sep aria-hidden="true">→</span>
          <span className="mono">{shortSha(search.head)}</span>
          {search.pr ? <span data-owner> · PR #{search.pr}</span> : null}
        </h1>
      </header>

      <CompareBuilder />

      <CompareCompatibilitySummary rows={data.unionRows} />

      {search.preset?.startsWith("release-") ? (
        <ReleaseReadinessPanel
          report={buildReleaseReadinessReport({
            rows: data.unionRows,
            statusScenarios: data.statusScenarios,
            target: releasePresetToTarget(search.preset),
          })}
        />
      ) : null}

      <section className="section compare-perspective" aria-label="Compare perspective">
        <h2>Perspective</h2>
        <div className="segmented-control" aria-label="Base, head, diff">
          <span>Base <strong className="mono">{shortSha(search.base)}</strong></span>
          <span>Head <strong className="mono">{shortSha(search.head)}</strong></span>
          <span aria-current="true">Diff <strong>{data.metric}</strong></span>
        </div>
        <dl className="context-summary">
          <div><dt>Scenario</dt><dd>{search.scenario ?? "all"}</dd></div>
          <div><dt>Environment</dt><dd>{search.env ?? "all"}</dd></div>
          <div><dt>Entrypoint</dt><dd>{search.entrypoint ?? "all"}</dd></div>
          <div><dt>What's counted</dt><dd>{search.lens ?? "all"}</dd></div>
          <div><dt>Size</dt><dd>{data.metric}</dd></div>
          <div><dt>Artifacts</dt><dd>{data.contextMatched ? "available" : "unavailable"}</dd></div>
        </dl>
      </section>

      <section className="section">
        <h2>Series filters</h2>
        <div className="filters-bar">
          <OutputRowFilterLinks rows={data.unionRows} />
          <MetricSelector
            raw={<Link from={Route.fullPath} replace resetScroll={false} to="." search={(prev) => ({ ...prev, metric: "raw" })}>raw</Link>}
            gzip={<Link from={Route.fullPath} replace resetScroll={false} to="." search={(prev) => ({ ...prev, metric: "gzip" })}>gzip</Link>}
            brotli={<Link from={Route.fullPath} replace resetScroll={false} to="." search={(prev) => ({ ...prev, metric: "brotli" })}>brotli</Link>}
          />
        </div>
      </section>

      <section className="section">
        <h2>Artifact status</h2>
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
        <h2>Scenario groups</h2>
        <UnionScenarioGroups rows={data.unionRows} />
      </section>

      <section className="section">
        <h2>Selected output evidence</h2>
        {data.selectedUnionRow ? (
          <UnionRowDetail row={data.selectedUnionRow} />
        ) : (
          <p className="notice">Select <code>scenario + env + entrypoint + lens</code> to inspect a paired output.</p>
        )}
      </section>

      <section className="section">
        <h2>Detail tabs</h2>
        <TabSelector
          tabs={compareTabs.map((nextTab) => (
            <Link key={nextTab} from={Route.fullPath} replace resetScroll={false} to="." search={(prev) => ({ ...prev, tab: nextTab })}>
              {nextTab}
            </Link>
          ))}
        />
        <SelectedSeriesDetailView
          context={{
            baselineRef: data.selectedUnionRow?.basePoint?.commitSha,
            currentRef: data.selectedUnionRow?.headPoint?.commitSha,
            entrypoint: data.selectedUnionRow?.entrypoint.key ?? search.entrypoint,
            environment: data.selectedUnionRow?.environment.key ?? search.env,
            lens: data.selectedUnionRow?.lens.id ?? search.lens,
            scenario: data.selectedUnionRow?.scenario.slug ?? search.scenario,
          }}
          detail={tab === "summary" ? null : data.selectedDetail}
          metric={data.metric}
          mode="compare"
          tab={tab}
          treemapTimeline={data.selectedTreemapTimeline}
          budgetState={data.selectedUnionRow?.policyState}
          hasDegradedStableIdentity={data.selectedUnionRow?.hasDegradedStableIdentity}
        />
      </section>
    </main>
  )
}

function ReviewModePage(props: { tab: (typeof compareTabs)[number] }) {
  const data = Route.useLoaderData()
  const search = Route.useSearch()

  if (data.mode !== "pr") return null

  const verdict = reviewVerdict(data)
  const topRows = data.reviewOutputRows
    .filter((row) => row.reviewState !== "neutral")
    .slice(0, 3)

  return (
    <main className="page repo-page review-page">
      <header className="page-header">
        <p className="breadcrumb">
          <Link to="/">Home</Link>
          <span aria-hidden="true">/</span>
          <Link
            from={Route.fullPath}
            to="/r/$owner/$repo"
            search={{ branch: data.latestReviewSummary?.branch, lens: search.lens ?? DEFAULT_LENS_SLUG, metric: data.metric }}
          >
            {data.repository.owner}/{data.repository.name}
          </Link>
          <span aria-hidden="true">/</span>
          <span>Review</span>
        </p>
        <h1>Review PR #{search.pr}</h1>
        <p>Review mode answers whether this PR can proceed from a bundle perspective without pretending policy enforcement exists before it is configured.</p>
      </header>

      <section className="section verdict-hero" data-verdict={verdict.state}>
        <p className="eyebrow">Verdict</p>
        <h2>{verdict.title}</h2>
        <p>{verdict.description}</p>
        <dl className="context-summary">
          <div><dt>Measurement state</dt><dd><StateBadge state={verdict.measurementState} /></dd></div>
          <div><dt>Policy state</dt><dd><StateBadge state={verdict.policyState} /></dd></div>
          <div><dt>Base</dt><dd className="mono">{shortSha(search.base)}</dd></div>
          <div><dt>Head</dt><dd className="mono">{shortSha(search.head)}</dd></div>
        </dl>
      </section>

      <section className="section">
        <h2>Why this verdict</h2>
        <ul className="review-reasons">
          {verdict.reasons.map((reason) => <li key={reason}>{reason}</li>)}
        </ul>
      </section>

      <section className="section">
        <h2>Top affected scenarios</h2>
        {topRows.length === 0 ? (
          <p className="notice">No affected scenario outputs require review for this PR.</p>
        ) : (
          <div className="output-row-grid">
            {topRows.map((row) => <ReviewOutputCard key={row.rowId} row={row} />)}
          </div>
        )}
      </section>

      <section className="section">
        <h2>Scenario groups</h2>
        {data.latestReviewSummary ? (
          <div className="review-scenario-groups">
            {data.latestReviewSummary.scenarioGroups.map((scenarioGroup) => {
              const rows = data.reviewOutputRows.filter((row) => row.scenario.id === scenarioGroup.scenarioId)
              return (
                <details key={scenarioGroup.scenarioId} open={shouldExpandReviewScenarioGroup(scenarioGroup.reviewState)}>
                  <summary>
                    <span>{scenarioGroup.scenarioSlug}</span>
                    <StateBadge state={scenarioGroup.reviewState} />
                    <span>{rows.length} outputs</span>
                  </summary>
                  {rows.length === 0 ? <p className="notice">No output rows are available for this scenario group.</p> : (
                    <div className="output-row-grid compact">
                      {rows.map((row) => <ReviewOutputCard key={row.rowId} row={row} />)}
                    </div>
                  )}
                </details>
              )
            })}
          </div>
        ) : (
          <p className="notice">No PR review summary matched this base/head context.</p>
        )}
      </section>

      <section className="section">
        <h2>Selected output evidence</h2>
        {data.selectedReviewedRow ? <ReviewedRowDetail /> : <p className="notice">Choose Inspect evidence on an output row to open the selected bundle evidence.</p>}
        <TabSelector
          tabs={compareTabs.map((nextTab) => (
            <Link key={nextTab} from={Route.fullPath} replace resetScroll={false} to="." search={(prev) => ({ ...prev, tab: nextTab })}>
              {nextTab}
            </Link>
          ))}
        />
        <SelectedSeriesDetailView
          context={{
            baselineRef: data.selectedReviewedRow?.series.selectedBaseCommitSha ?? search.base,
            currentRef: data.selectedReviewedRow?.series.selectedHeadCommitSha ?? search.head,
            entrypoint: data.selectedReviewedRow?.series.entrypoint ?? search.entrypoint,
            environment: data.selectedReviewedRow?.series.environment ?? search.env,
            lens: data.selectedReviewedRow?.series.lens ?? search.lens,
            scenario: data.selectedReviewedRow?.scenarioSlug ?? search.scenario,
          }}
          detail={props.tab === "summary" ? null : data.selectedDetail}
          metric={data.metric}
          mode="compare"
          tab={props.tab}
          treemapTimeline={data.selectedTreemapTimeline}
          budgetState={data.selectedReviewedRow?.series.budgetState}
          hasDegradedStableIdentity={data.selectedReviewedRow?.series.hasDegradedStableIdentity}
        />
      </section>

      <section className="section review-actions">
        <h2>Actions</h2>
        <div className="card-grid">
          <article className="card">
            <h3>Open policy context</h3>
            <p>Review the scenario-scoped policies that produced this decision state.</p>
            <Link to="/r/$owner/$repo/settings" params={{ owner: data.repository.owner, repo: data.repository.name }}>Repository settings</Link>
          </article>
          <article className="card">
            <h3>Release readiness presets</h3>
            <p>Use neutral Compare Mode for release candidate vs main today. Last release and tag presets appear when release data exists.</p>
          </article>
        </div>
      </section>
    </main>
  )
}

function ReviewOutputCard(props: { row: ReviewOutputRow }) {
  const row = props.row
  const data = Route.useLoaderData()
  const search = Route.useSearch()

  if (data.mode !== "pr") return null

  const primaryAction = canOpenReviewEvidence(row) ? (
    <Link
      from={Route.fullPath}
      to="/r/$owner/$repo/compare"
      search={{
        base: search.base,
        head: search.head,
        pr: search.pr,
        scenario: row.scenario.slug,
        env: row.environment.key,
        entrypoint: row.entrypoint.key,
        lens: row.lens.id,
        tab: "treemap",
        metric: data.metric,
      }}
    >
      Inspect evidence
    </Link>
  ) : (
    <span className="text-muted">{reviewEvidenceUnavailableReason(row)}</span>
  )

  return (
    <OutputRowCard
      row={row}
      primaryAction={primaryAction}
    >
      <div className="row-actions">
        <Link
          to="/r/$owner/$repo/scenarios/$scenario"
          params={{ owner: data.repository.owner, repo: data.repository.name, scenario: row.scenario.slug }}
          search={{ branch: data.latestReviewSummary?.branch, env: row.environment.key, entrypoint: row.entrypoint.key, lens: row.lens.id, metric: data.metric }}
        >
          Open scenario
        </Link>
        <Link
          from={Route.fullPath}
          to="/r/$owner/$repo/compare"
          search={{ base: search.base, head: search.head, pr: search.pr, scenario: row.scenario.slug, env: row.environment.key, entrypoint: row.entrypoint.key, lens: row.lens.id, metric: data.metric }}
        >
          Focus review
        </Link>
      </div>
    </OutputRowCard>
  )
}

function CompareCompatibilitySummary(props: { rows: UnionPairOutputRow[] }) {
  const profile = compatibilityProfile(props.rows)
  const comparisonStates = comparisonStateProfile(props.rows)
  const allExact = props.rows.length > 0 && profile.exact === props.rows.length

  return (
    <section className="section compare-compatibility">
      <p className="eyebrow">Compatibility</p>
      <h2>{allExact ? "Exact artifact comparison" : "Advisory artifact comparison"}</h2>
      <p>
        {allExact
          ? "All paired rows are exact, so these rows are policy-grade inputs."
          : "Exact rows are policy-grade. Partial, exploratory, or invalid rows are advisory and must not be treated as enforcement."}
      </p>
      <dl className="context-summary">
        <div><dt>Exact</dt><dd>{profile.exact}</dd></div>
        <div><dt>Partial</dt><dd>{profile.partial}</dd></div>
        <div><dt>Exploratory</dt><dd>{profile.exploratory}</dd></div>
        <div><dt>Invalid</dt><dd>{profile.invalid}</dd></div>
        <div><dt>Same key</dt><dd>{comparisonStates.same}</dd></div>
        <div><dt>Added</dt><dd>{comparisonStates.added}</dd></div>
        <div><dt>Removed</dt><dd>{comparisonStates.removed}</dd></div>
        <div><dt>Gaps</dt><dd>{comparisonStates.unavailable + comparisonStates.unsupported_lens + comparisonStates.missing_size + comparisonStates.invalid}</dd></div>
      </dl>
      <details>
        <summary>Compatibility dimensions</summary>
        <dl className="context-summary compact">
          <div><dt>Scenario</dt><dd>paired by scenario</dd></div>
          <div><dt>Environment</dt><dd>paired by environment</dd></div>
          <div><dt>Entrypoint</dt><dd>paired by kind and key</dd></div>
          <div><dt>What's counted</dt><dd>paired by lens</dd></div>
          <div><dt>Size</dt><dd>raw, gzip, or brotli must exist</dd></div>
          <div><dt>Build/config identity</dt><dd>exact only when stored comparison evidence exists</dd></div>
          <div><dt>Artifact availability</dt><dd>added, removed, and unavailable stay distinct</dd></div>
        </dl>
      </details>
    </section>
  )
}

function ReleaseReadinessPanel(props: { report: ReleaseReadinessReport }) {
  const targetLabel = releaseTargetLabel(props.report.target)

  return (
    <section className="section release-readiness">
      <p className="eyebrow">Release readiness</p>
      <h2>{props.report.ready ? "Release review is ready" : "Release review needs attention"}</h2>
      <p>
        This preset reviews a release candidate against {targetLabel}. Missing measurements and unavailable artifacts stay explicit and never count as success.
      </p>
      <dl className="context-summary">
        <div><dt>State</dt><dd><StateBadge state={props.report.state} /></dd></div>
        <div><dt>Scenarios required</dt><dd>{props.report.scenarioCount}</dd></div>
        <div><dt>Blocking policies</dt><dd>{props.report.blockingPolicyFailureCount}</dd></div>
        <div><dt>Warnings</dt><dd>{props.report.warningCount}</dd></div>
        <div><dt>Accepted decisions</dt><dd>{props.report.acceptedDecisionCount}</dd></div>
        <div><dt>Missing measurements</dt><dd>{props.report.missingMeasurementCount}</dd></div>
        <div><dt>Unavailable artifacts</dt><dd>{props.report.unavailableArtifactCount}</dd></div>
      </dl>
      {props.report.target === "main" ? null : (
        <p className="notice">{targetLabel} requires release metadata that is not available in this repository yet.</p>
      )}
    </section>
  )
}

function OutputRowFilterLinks(props: { rows: UnionPairOutputRow[] }) {
  const scenarios = unique(props.rows.map((row) => row.scenario.slug))
  const environments = unique(props.rows.map((row) => row.environment.key))
  const entrypoints = unique(props.rows.map((row) => row.entrypoint.key))
  const lenses = unique(props.rows.map((row) => row.lens.id))

  return (
    <>
      <LinkSelector
        label="Scenario"
        options={[
          <Link key="all" from={Route.fullPath} replace resetScroll={false} to="." search={(prev) => ({ ...prev, scenario: undefined })}>all</Link>,
          ...scenarios.map((scenario) => (
            <Link key={scenario} from={Route.fullPath} replace resetScroll={false} to="." search={(prev) => ({ ...prev, scenario })}>
              {scenario}
            </Link>
          )),
        ]}
      />
      <LinkSelector
        label="Environment"
        options={[
          <Link key="all" from={Route.fullPath} replace resetScroll={false} to="." search={(prev) => ({ ...prev, env: undefined })}>all</Link>,
          ...environments.map((env) => (
            <Link key={env} from={Route.fullPath} replace resetScroll={false} to="." search={(prev) => ({ ...prev, env })}>
              {env}
            </Link>
          )),
        ]}
      />
      <LinkSelector
        label="Entrypoint"
        options={[
          <Link key="all" from={Route.fullPath} replace resetScroll={false} to="." search={(prev) => ({ ...prev, entrypoint: undefined })}>all</Link>,
          ...entrypoints.map((entrypoint) => (
            <Link key={entrypoint} from={Route.fullPath} replace resetScroll={false} to="." search={(prev) => ({ ...prev, entrypoint })}>
              {entrypoint}
            </Link>
          )),
        ]}
      />
      <LinkSelector
        label="What's counted"
        options={[
          <Link key="all" from={Route.fullPath} replace resetScroll={false} to="." search={(prev) => ({ ...prev, lens: undefined })}>all</Link>,
          ...lenses.map((lens) => (
            <Link key={lens} from={Route.fullPath} replace resetScroll={false} to="." search={(prev) => ({ ...prev, lens })}>
              {lens}
            </Link>
          )),
        ]}
      />
    </>
  )
}

function UnionScenarioGroups(props: { rows: UnionPairOutputRow[] }) {
  const groups = groupUnionRows(props.rows)

  if (groups.length === 0) {
    return <p className="notice">No base/head outputs matched the selected artifacts and filters.</p>
  }

  return (
    <div className="compare-scenario-groups">
      {groups.map((group) => {
        const counts = comparisonStateProfile(group.rows)
        const open = counts.added + counts.removed + counts.missing_size + counts.unsupported_lens + counts.invalid > 0 || group.rows.some((row) => selectedSizeDelta(row) !== 0)

        return (
          <details key={group.scenario.slug} open={open}>
            <summary>
              <span>{group.scenario.label}</span>
              <span>{group.rows.length} outputs</span>
              {counts.added > 0 ? <StateBadge state="added" /> : null}
              {counts.removed > 0 ? <StateBadge state="removed" /> : null}
              {counts.same > 0 ? <StateBadge state="same" /> : null}
            </summary>
            <div className="output-row-grid compact">
              {group.rows.map((row) => <CompareOutputCard key={row.rowId} row={row} />)}
            </div>
          </details>
        )
      })}
    </div>
  )
}

function CompareOutputCard(props: { row: UnionPairOutputRow }) {
  const row = props.row
  const data = Route.useLoaderData()
  const search = Route.useSearch()

  if (data.mode !== "neutral") return null

  const canInspectEvidence = row.evidenceAvailability.comparisonDetailAvailable && row.evidenceAvailability.treemapFrameAvailable
  const primaryAction = canInspectEvidence ? (
    <Link
      from={Route.fullPath}
      to="/r/$owner/$repo/compare"
      search={{
        base: search.base,
        head: search.head,
        scenario: row.scenario.slug,
        env: row.environment.key,
        entrypoint: row.entrypoint.key,
        lens: row.lens.id,
        tab: "treemap",
        metric: data.metric,
      }}
    >
      Inspect evidence
    </Link>
  ) : (
    <span className="text-muted">{row.evidenceAvailability.unavailableReason ?? "Comparison evidence is unavailable."}</span>
  )

  return (
    <OutputRowCard row={row} primaryAction={primaryAction}>
      <dl className="output-row-details">
        <div><dt>Comparison state</dt><dd><StateBadge state={row.pairState} /></dd></div>
        <div><dt>Compatibility</dt><dd><StateBadge state={row.compatibility} /></dd></div>
        <div><dt>Base commit</dt><dd>{row.basePoint ? shortSha(row.basePoint.commitSha) : "none"}</dd></div>
        <div><dt>Head commit</dt><dd>{row.headPoint ? shortSha(row.headPoint.commitSha) : "none"}</dd></div>
      </dl>
      <div className="row-actions">
        <Link
          to="/r/$owner/$repo/scenarios/$scenario"
          params={{ owner: data.repository.owner, repo: data.repository.name, scenario: row.scenario.slug }}
          search={{ branch: row.headPoint?.branch ?? row.basePoint?.branch, env: row.environment.key, entrypoint: row.entrypoint.key, lens: row.lens.id, metric: data.metric }}
        >
          Open scenario
        </Link>
        <Link
          from={Route.fullPath}
          to="/r/$owner/$repo/compare"
          search={{ base: search.base, head: search.head, scenario: row.scenario.slug, env: row.environment.key, entrypoint: row.entrypoint.key, lens: row.lens.id, metric: data.metric }}
        >
          Focus diff
        </Link>
      </div>
    </OutputRowCard>
  )
}

function UnionRowDetail(props: { row: UnionPairOutputRow }) {
  const row = props.row

  return (
    <dl className="context-summary">
      <div><dt>Scenario</dt><dd>{row.scenario.slug}</dd></div>
      <div><dt>Output</dt><dd>{row.environment.key} / {row.entrypoint.key}</dd></div>
      <div><dt>What's counted</dt><dd>{row.lens.label}</dd></div>
      <div><dt>Comparison state</dt><dd><StateBadge state={row.pairState} /></dd></div>
      <div><dt>Compatibility</dt><dd><StateBadge state={row.compatibility} /></dd></div>
      <div><dt>Current</dt><dd>{formatMaybeBytes(selectedSizeValue(row.currentTotals, row.selectedSize))}</dd></div>
      <div><dt>Baseline</dt><dd>{formatMaybeBytes(selectedSizeValue(row.baselineTotals, row.selectedSize))}</dd></div>
      <div><dt>Delta</dt><dd>{formatMaybeSignedBytes(selectedSizeValue(row.deltaTotals, row.selectedSize))}</dd></div>
    </dl>
  )
}

function CompareBuilder() {
  const data = Route.useLoaderData()
  const search = Route.useSearch()
  const options = data.commitOptions
  const mainBaseOption = options.find((option) => option.branch === "main" && option.commitSha !== search.head) ?? null
  const prOption = options.find((option) => option.prNumber !== null) ?? null

  return (
    <section className="section compare-builder">
      <h2>Compare presets</h2>
      <div className="card-grid compare-preset-grid">
        <article className="card">
          <h3>PR base vs head</h3>
          {search.pr ? <p>Active for PR #{search.pr}.</p> : <p className="text-muted">Open from a PR review link when pull request data exists.</p>}
        </article>
        <article className="card">
          <h3>Current vs main</h3>
          {mainBaseOption ? (
            <Link from={Route.fullPath} to="." search={(prev) => ({ ...prev, base: mainBaseOption.commitSha, head: search.head, pr: undefined })}>
              Use {shortSha(mainBaseOption.commitSha)} as base
            </Link>
          ) : (
            <p className="text-muted">No separate main baseline is available.</p>
          )}
        </article>
        <article className="card">
          <h3>Release candidate</h3>
          {mainBaseOption ? (
            <Link from={Route.fullPath} to="." search={(prev) => ({ ...prev, base: mainBaseOption.commitSha, head: search.head, pr: undefined, preset: "release-main" })}>
              Check release candidate vs main
            </Link>
          ) : (
            <p className="text-muted">Release candidate vs main needs a measured main baseline. Last release and tag presets need release data.</p>
          )}
        </article>
        <article className="card">
          <h3>Run vs run</h3>
          <p className="text-muted">Use the advanced selector for explicit measured commit groups.</p>
        </article>
        {prOption && !search.pr ? (
          <article className="card">
            <h3>Available PR</h3>
            <p>PR #{prOption.prNumber} has uploaded measurements.</p>
          </article>
        ) : null}
      </div>
      <details className="advanced-compare">
        <summary>Advanced base/head compare</summary>
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
              <select name="base" defaultValue={search.base}>
                {options.map((option) => <option key={`base:${option.commitSha}`} value={option.commitSha}>{compareOptionLabel(option)}</option>)}
              </select>
            </label>
            <label>
              Head
              <select name="head" defaultValue={search.head}>
                {options.map((option) => <option key={`head:${option.commitSha}`} value={option.commitSha}>{compareOptionLabel(option)}</option>)}
              </select>
            </label>
            {search.pr ? <input type="hidden" name="pr" value={search.pr} /> : null}
            {search.scenario ? <input type="hidden" name="scenario" value={search.scenario} /> : null}
            {search.env ? <input type="hidden" name="env" value={search.env} /> : null}
            {search.entrypoint ? <input type="hidden" name="entrypoint" value={search.entrypoint} /> : null}
            {search.lens ? <input type="hidden" name="lens" value={search.lens} /> : null}
            {search.preset ? <input type="hidden" name="preset" value={search.preset} /> : null}
            <input type="hidden" name="metric" value={data.metric} />
            <button type="submit">Open compare</button>
          </form>
        )}
      </details>
    </section>
  )
}

function CompareFilterLinks(props: {
  rows: Array<ReturnType<typeof Route.useLoaderData>["neutralRows"][number] | ReturnType<typeof Route.useLoaderData>["reviewedRows"][number]>
}) {
  const scenarios = unique(props.rows.map((row) => row.scenarioSlug))
  const environments = unique(props.rows.map((row) => row.series.environment))
  const entrypoints = unique(props.rows.map((row) => row.series.entrypoint))
  const lenses = unique(props.rows.map((row) => row.series.lens))

  return (
    <>
      <LinkSelector
        label="Scenario"
        options={[
          <Link key="all" from={Route.fullPath} replace resetScroll={false} to="." search={(prev) => ({ ...prev, scenario: undefined })}>all</Link>,
          ...scenarios.map((scenario) => (
            <Link key={scenario} from={Route.fullPath} replace resetScroll={false} to="." search={(prev) => ({ ...prev, scenario })}>
              {scenario}
            </Link>
          )),
        ]}
      />
      <LinkSelector
        label="Environment"
        options={[
          <Link key="all" from={Route.fullPath} replace resetScroll={false} to="." search={(prev) => ({ ...prev, env: undefined })}>all</Link>,
          ...environments.map((env) => (
            <Link key={env} from={Route.fullPath} replace resetScroll={false} to="." search={(prev) => ({ ...prev, env })}>
              {env}
            </Link>
          )),
        ]}
      />
      <LinkSelector
        label="Entrypoint"
        options={[
          <Link key="all" from={Route.fullPath} replace resetScroll={false} to="." search={(prev) => ({ ...prev, entrypoint: undefined })}>all</Link>,
          ...entrypoints.map((entrypoint) => (
            <Link key={entrypoint} from={Route.fullPath} replace resetScroll={false} to="." search={(prev) => ({ ...prev, entrypoint })}>
              {entrypoint}
            </Link>
          )),
        ]}
      />
      <LinkSelector
        label="Lens"
        options={[
          <Link key="all" from={Route.fullPath} replace resetScroll={false} to="." search={(prev) => ({ ...prev, lens: undefined })}>all</Link>,
          ...lenses.map((lens) => (
            <Link key={lens} from={Route.fullPath} replace resetScroll={false} to="." search={(prev) => ({ ...prev, lens })}>
              {lens}
            </Link>
          )),
        ]}
      />
    </>
  )
}

function unique(values: string[]) {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right))
}

function releasePresetToTarget(preset: "release-last-release" | "release-main" | "release-tag"): ReleaseReadinessTarget {
  if (preset === "release-last-release") return "last-release"
  if (preset === "release-tag") return "tag"
  return "main"
}

function releaseTargetLabel(target: ReleaseReadinessTarget) {
  if (target === "last-release") return "the last release"
  if (target === "tag") return "a release tag"
  return "main"
}

function groupUnionRows(rows: UnionPairOutputRow[]) {
  const groups = new Map<string, { scenario: UnionPairOutputRow["scenario"]; rows: UnionPairOutputRow[] }>()

  for (const row of rows) {
    const existing = groups.get(row.scenario.slug)

    if (existing) {
      existing.rows.push(row)
    } else {
      groups.set(row.scenario.slug, { scenario: row.scenario, rows: [row] })
    }
  }

  return [...groups.values()].sort((left, right) => left.scenario.label.localeCompare(right.scenario.label))
}

function compatibilityProfile(rows: UnionPairOutputRow[]) {
  return rows.reduce(
    (profile, row) => {
      profile[row.compatibility] += 1
      return profile
    },
    { exact: 0, exploratory: 0, invalid: 0, partial: 0 },
  )
}

function comparisonStateProfile(rows: UnionPairOutputRow[]) {
  return rows.reduce(
    (profile, row) => {
      profile[row.pairState] += 1
      return profile
    },
    { added: 0, invalid: 0, missing_size: 0, removed: 0, same: 0, unavailable: 0, unsupported_lens: 0 },
  )
}

function selectedSizeDelta(row: UnionPairOutputRow) {
  return selectedSizeValue(row.deltaTotals, row.selectedSize) ?? 0
}

function selectedSizeValue(totals: UnionPairOutputRow["currentTotals"], metric: UnionPairOutputRow["selectedSize"]) {
  return totals?.[metric] ?? null
}

function formatMaybeBytes(value: number | null) {
  return value === null ? "Unavailable" : formatBytes(value)
}

function formatMaybeSignedBytes(value: number | null) {
  return value === null ? "No paired value" : formatSignedBytes(value)
}

function compareOptionLabel(option: ReturnType<typeof Route.useLoaderData>["commitOptions"][number]) {
  const pr = option.prNumber ? ` PR #${option.prNumber}` : ""
  return `${shortSha(option.commitSha)} on ${option.branch}${pr}`
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
