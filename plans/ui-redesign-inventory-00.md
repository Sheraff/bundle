# UI Redesign 00 Inventory And Cutover Baseline

## Status

Plan 00 execution artifact.

This document records the current UI/read-model/test baseline before the scenario-centered UI execution chain changes code.

## Cutover Mode

Chosen mode:

```text
parallel-hidden during development, then replace-in-place before shipping
```

Rationale:

- The product has not shipped, so there is no need for long-term URL compatibility.
- New surfaces can be built behind new route/read-model contracts while current routes remain available for comparison and tests.
- Before shipping, old filter-first routes/components should be removed or replaced rather than kept as parallel public UI.

Deletion criteria:

- A replacement scenario-centered route exists for the old route's user job.
- E2E coverage exists for the replacement job.
- The old route no longer owns a unique expert workflow.
- Old `Filters`, `Series filters`, and `Detail tabs` UI patterns have no remaining public entry point.

## Route Inventory

| Current route | Current job | Search/state | Current read model | User-facing concepts exposed | Future surface | Action |
| --- | --- | --- | --- | --- | --- | --- |
| `/` | Marketing/home and quick start. | none | none | product pitch, sign-in/install entry | Keep/adapt separately. | Keep. |
| `/app/` | Admin home. | none | app loader/auth | authenticated repositories, setup status | App admin. | Keep outside public UI redesign. |
| `/app/setup` | Setup guide. | none | app loader/auth | GitHub App setup | Setup/onboarding. | Keep/adapt later. |
| `/app/installations/$installationId` | GitHub installation repo selection. | installation | installation loader | installation repositories | Setup/onboarding. | Keep. |
| `/r/$owner/$repo/` | Repository overview, trend, health, latest compare, scenario catalog. | `branch`, `lens`, `metric` | `getRepositoryOverviewPageData` | repository, branch, lens, size metric, trend, health counts, scenarios, latest compare | Scenarios Home, History/Review entry. | Replace. |
| `/r/$owner/$repo/history` | Repository history and compare builder. | `branch`, `scenario`, `env`, `entrypoint`, `lens`, `metric` | `getRepositoryHistoryPageData` | branch, scenario, environment, entrypoint, lens, size metric, commits | History Mode and Compare presets. | Replace. |
| `/r/$owner/$repo/scenarios/$scenario` | Scenario detail/history plus selected-series detail tabs. | `branch`, `env`, `entrypoint`, `lens`, `metric`, `tab` | `getScenarioPageData` | scenario, environment, entrypoint, lens, size metric, latest status, selected series, detail tab | Scenario Page and contextual Expert Visualizer. | Replace. |
| `/r/$owner/$repo/compare` | Neutral or PR compare and selected-series detail tabs. | `base`, `head`, `pr`, `scenario`, `env`, `entrypoint`, `lens`, `metric`, `tab` | `getNeutralComparePageData`, `getPullRequestComparePageData` | base/head, PR number, scenario, environment, entrypoint, lens, size metric, review states, acknowledgements, detail tab | Review Mode, Compare Mode, Expert Visualizer. | Replace. |
| `/r/$owner/$repo/settings` | Repository setup, action snippets, publication history. | none | settings route-local queries | setup commands, upload tokens, GitHub publications | Policies/Settings. | Keep/adapt. |
| `/r/$owner/$repo/settings/synthetic-scenarios` | Hosted synthetic scenario list. | none | settings route-local server fns | hosted synthetic scenarios | Scenario setup. | Keep/adapt. |
| `/r/$owner/$repo/settings/synthetic-scenarios/new` | New hosted synthetic scenario. | form | mutation route | route/url/budget intent form | Scenario setup. | Keep/adapt. |
| `/r/$owner/$repo/settings/synthetic-scenarios/$scenarioId/edit` | Edit hosted synthetic scenario. | form | mutation route | route/url/budget intent form | Scenario setup. | Keep/adapt. |

## Read Model Inventory

| Read model | Current input shape | Current output shape | Preserves scenario/env/entrypoint/lens | Current/base/delta totals | History points | Evidence/detail links | Mini-viz data | Current gaps for redesign |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `getRepositoryOverviewPageData` | `{ owner, repo, branch?, lens?, metric? }` | repository, resolved branch/lens/metric, option lists, trend rows, latest summary, commit options, latest important compare, scenario catalog | Partially; trend rows include scenario/env/entrypoint/lens, catalog rows have primary series | Yes through summary comparison rows and trend totals | Yes through `trend` | Compare links only; no row evidence availability | Trend chart data only | Not scenario-centered, no `OutputRow`, no mini-viz row contract, no evidence availability. |
| `getRepositoryHistoryPageData` | `{ owner, repo, branch?, scenario?, env?, entrypoint?, lens?, metric? }` | repository, resolved filters, option lists, commit options, grouped history series | Yes in history series | Current totals only per point | Yes, up to 20 points per series | Compare builder only | Trend chart data only | Filter-first shape, no output matrix, no compatibility semantics. |
| `getScenarioPageData` | `{ owner, repo, scenario, branch?, env?, entrypoint?, lens?, tab?, metric? }` | repository, scenario, resolved filters, latest summary/status, history, compare shortcut, selected series/history point/detail/timeline | Yes; history and selected contexts use env/entrypoint/lens | Yes through latest compare rows; current totals in history | Yes | Heavy detail only after a full selected series context | Trend chart and treemap timeline only | Page-shaped around filters/tabs, no matrix row contract, detail locked to selected series. |
| `getNeutralComparePageData` | `{ owner, repo, search: { base, head, scenario?, env?, entrypoint?, lens?, metric?, tab? } }` | repository, neutral mode, context match flag, latest summary/statuses, neutral rows, selected row/detail/timeline, commit options | Yes for head-side rows | Yes for summary rows | Only treemap timeline for selected row | Heavy comparison detail after selected row | Treemap timeline only | Head-summary driven; cannot show removed/base-only series; no union pairing. |
| `getPullRequestComparePageData` | `{ owner, repo, search: { pr, base, head, scenario?, env?, entrypoint?, lens?, metric?, tab? } }` | repository, PR mode, context match flag, latest PR review summary/statuses, reviewed rows, selected row/detail/timeline, commit options | Yes in reviewed rows | Yes for reviewed rows plus acknowledgement state | Only treemap timeline for selected row | Heavy comparison detail after selected row | Treemap timeline only | Compare-page shape, no scenario-centered Review Mode contract, no row mini-viz. |
| `loadScenarioHistory` | repository/scenario/branch/environment/entrypoint/lens | grouped `ScenarioHistorySeries[]` | Yes | Current totals only | Yes | No | Trend-ready points | No batch mini-viz helper; filter-first API. |
| `loadRepositoryHistory` | repository plus branch/scenario/environment/entrypoint/lens | grouped `ScenarioHistorySeries[]` | Yes | Current totals only | Yes | No | Trend-ready points | No scenario-centered grouping/read-model contract. |
| `loadComparisonDetail` | comparison id, environment, entrypoint, metric | `DetailAvailability` with head/base snapshots and diffs | Requires selected full series context | Yes in diff rows for assets/chunks/modules/packages | No | Yes; loads normalized snapshots from R2 | Treemap diff nodes only | Good expert evidence source, but not exposed as row-level availability. |
| `loadSnapshotDetailForScenarioRun` | scenario run id, environment, entrypoint, metric | `DetailAvailability` with snapshot detail | Requires selected full series context | Current snapshot only | No | Yes; loads normalized snapshot from R2 | Treemap nodes only | Good expert evidence source, not row availability. |
| `loadTreemapTimelineForSeries` | repository, series, branch, environment, entrypoint, metric, optional base/head SHAs | `TreemapTimeline` frame list, initial nodes, base/head frame indexes | Yes | Current total per frame | Yes for selected series | Lazy `nodesUrl` per frame | Treemap scrubber data | Treemap-specific scrubber; graph/waterfall scrubber not generalized. |
| `loadTreemapFrameForScenarioRun` | scenario run id, environment, entrypoint, metric | treemap nodes | Yes via selected scenario run | Current frame value through node values | Single frame | Lazy treemap endpoint support | Treemap frame nodes | Treemap-specific. |

## Component Inventory

| Component | Current purpose | Future status |
| --- | --- | --- |
| `LinkSelector` | Generic link-list selector for filters. | Avoid as primary UI; may be replaced by scoped controls. |
| `MetricSelector` | raw/gzip/brotli selector. | Replace/copy as `Size` control. |
| `TabSelector` | Detail tab nav. | Replace with contextual Expert Visualizer intent rail. |
| `TrendChart` | Time-series chart. | Reuse for History Mode and mini-viz derivatives. |
| `TreemapChart` | Bundle composition treemap. | Preserve in Expert Visualizer. |
| `TreemapTimelineScrubber` | Treemap history scrubber. | Preserve, later generalize frame navigation. |
| `DependencyGraph` | Chunk dependency graph. | Preserve in Expert Visualizer. |
| `WaterfallChart` | Build-time dependency waterfall. | Preserve, label as bundle dependency waterfall. |
| `SelectedSeriesDetailView` | Tab-switched detail rendering for selected series. | Preserve as evidence engine, redesign shell/context. |
| `StateBadge` | Status badge. | Reuse, but state vocabulary may expand. |
| `HostedSyntheticForm` | Hosted synthetic scenario forms. | Keep/adapt in scenario setup. |

## Test Inventory

| Test file | Current coverage | Redesign relevance |
| --- | --- | --- |
| `apps/web/e2e/ui-functionality.spec.ts` | Homepage, overview/history/compare navigation, scenario treemap, compare visual tabs. | Must be replaced/retargeted to Scenarios/Review/Expert flows. |
| `apps/web/test/public-read-models.test.ts` | Public read model behaviors. | Extend with OutputRow/read-model adapters. |
| `apps/web/test/public-pages.test.ts` | Public page rendering. | Retarget after route changes. |
| `apps/web/test/comparisons.test.ts` | Comparison materialization. | Important for union compare and policy. |
| `apps/web/test/summaries.test.ts` | Summary builders. | Important for review/scenario rows. |
| `apps/web/test/treemap-timeline-layout.test.ts` | Treemap timeline layout. | Preserve during Expert Visualizer work. |
| `apps/web/test/acknowledgements.test.ts` | PR acknowledgement behavior. | Preserve until policy/decision records replace/extend it. |
| `apps/web/test/publish-github.test.ts` | GitHub publishing. | Retarget in Plan 09. |
| upload/normalize/derive tests | Ingest and derived data. | Preserve; not UI-first. |

## Seed Data Coverage

Local seed command:

```bash
pnpm web:seed
```

Implementation:

- `apps/web/scripts/dev-seed.mjs` applies local D1 migrations, writes seed SQL, and stores normalized snapshots in local R2.
- Seeded public URL is `/r/acme/widget`.
- Seeded repository is `acme/widget` with one public repository row and one scenario, `fixture-app-cost`.
- Seeded commit groups are two settled `main` commits: `0123456789abcdef0123456789abcdef01234567` and `1111111111111111111111111111111111111111`.
- Seeded scenario runs are two processed runs with normalized snapshot keys.
- Seeded series is `default / src/main.ts / entry / entry-js-direct-css`.
- Seeded points include raw/gzip/brotli totals and entry JS/direct CSS component sizes.
- Seeded comparison is one materialized `branch-previous` comparison with current, baseline, and delta totals.
- Seeded summary includes one fresh scenario group, one changed series, and no pending/inherited/missing/failed scenarios.
- Seeded normalized snapshots include chunks, modules, packages/assets, graph edges, waterfall rows, and treemap source data sufficient for current detail tabs.

Seed gaps for later plans:

- No PR review summary or acknowledgement state.
- No failed upload/build scenario.
- No incomplete or pending run state.
- No missing baseline scenario.
- No unsupported lens or missing size scenario.
- No added or removed output pair.
- No multiple environments, multiple entrypoints, or multiple lenses.
- No policy states beyond `not-configured`.

## Visualization Data Dependencies

| Visualization/UI | Current data source | Required inputs | Current semantics | Redesign implication |
| --- | --- | --- | --- | --- |
| `TrendChart` | `loadRepositoryTrend`, `loadRepositoryHistory`, `loadScenarioHistory` | series id/label, commit SHA, measured-at timestamp, selected size value | One line per series; chart value comes from raw/gzip/brotli selector. | Reuse for History Mode; mini sparklines need a smaller typed projection. |
| `TreemapChart` | `loadSnapshotDetailForScenarioRun`, `loadComparisonDetail`, `loadTreemapFrameForScenarioRun` | treemap nodes with id, parent id, label, kind, value, optional state/identity | Snapshot or compare diff bundle composition. | Preserve in Expert Visualizer and row evidence. |
| `TreemapTimelineScrubber` | `loadTreemapTimelineForSeries` plus lazy frame endpoint | selected series, branch, metric, optional base/head SHAs, frame node URLs | Selected-series history scrubber; base/head frames are highlighted when present. | Preserve, then generalize timeline affordance for other expert views if needed. |
| `DependencyGraph` | `SnapshotDetail.graphEdges` and chunks | selected snapshot/comparison detail | Build-time chunk imports; dynamic imports are dashed. | Preserve and label explicitly as bundle dependency graph. |
| `WaterfallChart` | `SnapshotDetail.waterfallRows` | selected snapshot/comparison detail | Build-time dependency depth, not browser network timing. | Preserve and label as bundle dependency waterfall. |
| Assets/packages/modules tables | `SnapshotDetail` and `DiffDetail` | selected snapshot/comparison detail | Evidence tables for selected series. | Preserve in Expert Visualizer; expose availability from rows. |
| Budget tab | selected comparison budget state | selected series | Displays stored state only; copy says budget configuration is reserved. | Replace only after real policy evaluator exists. |
| Identity tab | selected comparison stable identity fields and module diffs | selected compare row | Shows degraded identity flag and module diff table. | Preserve as expert evidence; do not expose confidence UI. |

## GitHub Check And Comment Flow

Current persisted state:

- `pull_requests` and `commit_groups.pull_request_id` connect uploads to PRs.
- `pr_review_summaries` store review summaries with scenario groups, reviewed series, review state counts, status scenarios, base/head SHAs, and acknowledgement overlays.
- `github_publications` stores per-surface publication status, external IDs/URLs, payload hashes, and published head SHA.

Current flow:

- `refreshSummariesForCommitGroup()` builds and persists a commit-group summary for every commit group.
- When a commit group belongs to a PR, it builds and persists a PR review summary.
- It schedules `PrPublishDebounceWorkflow` through `schedulePrPublishDebounceWorkflow()`.
- The workflow waits `10_000` ms, then enqueues a `publish-github` queue message.
- `handlePublishGithubMessage()` validates queue payloads and calls `publishGithubForPullRequest()`.
- `publishGithubForPullRequest()` selects the exact or latest PR summary, renders both surfaces, skips current payload hashes, creates an installation token, and publishes to GitHub.
- `buildCommentPublicationPayload()` creates one maintained PR comment with an `<!-- bundle-review:pr:... -->` marker and links to `/r/$owner/$repo/compare?pr=...&base=...&head=...`.
- `buildCheckRunPublicationPayload()` creates/updates the aggregate `Chunk Scope Review` check run with status/conclusion and the same compare URL as `details_url`.

Current GitHub test coverage:

- `apps/web/test/publish-github.test.ts` covers creating one maintained PR comment and one aggregate check.
- The same test file covers updating maintained surfaces after reruns, skipping current payloads, publication failures, and terminal/non-terminal queue behavior.

Plan 09 implications:

- Existing PR publication links point to the old compare route and must move to Review Mode.
- GitHub comment/check text is scenario-oriented enough to preserve, but links and visual hierarchy should align with the new review UI.
- Publication hashing must remain stable for unchanged rendered payloads.

## Current Semantic Baseline

Current internal comparable key:

```text
repository + scenario + environment + entrypointKey + lens
```

Current schema stores `entrypointKind`, but the unique index does not include it.

Decision required in Plan 01:

```text
Include entrypointKind in comparable identity, or prove entrypointKey cannot collide across kinds.
```

Current size metrics:

- `totalRawBytes`
- `totalGzipBytes`
- `totalBrotliBytes`
- plus entry JS and direct CSS component fields on `series_points`.

Current default lens:

```text
entry-js-direct-css
```

Current budget/policy state:

- `comparisons.budgetState` exists.
- `budget_results` table exists.
- `evaluateBudgetResults()` returns `not-configured`.
- Hosted synthetic scenario budget intent fields exist.
- There is no general scenario-scoped policy evaluator yet.

Current PR review state:

- `pr_review_summaries` persist scenario groups, reviewed series, review states, counts, status scenarios.
- PR compare route can acknowledge individual comparison items.
- Current UI exposes this through `/compare?pr=...`, not a dedicated Review Mode.

## Current Behavior Regression Scope

Scenario semantics:

- Scenario slugs are public route identifiers and grouping labels.
- Scenario source kind is preserved in summaries and scenario catalog rows.
- Scenario pages currently expose latest status, history, compare shortcut, and selected-series evidence.

Environment semantics:

- Environment is stored on `series.environment` and read-model rows.
- Current UI treats `all` as an aggregate filter value, not a real environment.
- Detail evidence requires one concrete environment.

Entrypoint semantics:

- Entrypoint key is stored on `series.entrypoint_key` and displayed as entrypoint/output label.
- Entrypoint kind is stored on `series.entrypoint_kind` and returned in history/trend rows.
- Current filters list only entrypoint keys; they do not disambiguate kind in the URL.

Lens semantics:

- Lens is stored on `series.lens` and is part of history, trend, compare, and detail selection.
- Current default is `entry-js-direct-css`.
- Current charts and comparisons should not mix lenses in one series.

Size semantics:

- Raw/gzip/brotli are selected through `metric` and map to total raw/gzip/brotli bytes.
- Size metric is not part of comparable identity.
- Component fields for entry JS and direct CSS exist on `series_points`, but primary route tables use total fields.

History behavior:

- Repository and scenario history group points by series and cap each grouped series at 20 points.
- History pages use a filter-first selector over branch/scenario/environment/entrypoint/lens and render `TrendChart` plus tables.
- Compare builder launches arbitrary base/head compare using commit options.

Compare behavior:

- Neutral compare loads a commit-group summary by head SHA and filters rows to matching base/head context.
- PR compare loads `pr_review_summaries` by PR number and base/head context.
- Selected compare evidence requires scenario/environment/entrypoint/lens selection.
- Current neutral compare is head-side only and cannot represent removed/base-only outputs honestly.

Review/PR behavior:

- Review state is derived into PR review summaries and includes blocking/regression/acknowledged/warning/neutral categories.
- Acknowledgement is exposed from the PR compare route for individual comparison items.
- GitHub comments/checks link to the PR compare route with `pr`, `base`, and `head` search params.

Expert visualizer behavior:

- Detail tabs are exposed as direct tabs: treemap, graph, waterfall, assets, packages, budget, and identity on compare.
- Snapshot evidence and comparison evidence are loaded from normalized snapshots in R2.
- Treemap timeline is lazy-loaded per frame and currently exists only for treemap.

Policy/budget behavior:

- Budget state is stored on comparison/summary rows but currently evaluates to `not-configured` for normal flows.
- Budget tab explicitly warns that budget configuration is reserved and rows do not imply evaluation unless stored state says so.

## Fixture / State Matrix

Later plans must preserve or add fixtures for:

- complete measurement
- missing baseline
- failed upload
- failed build
- incomplete run
- unsupported lens
- missing size
- added output
- removed output
- unavailable evidence
- no policy
- not evaluated policy
- warning policy
- blocking policy
- accepted policy decision
- multiple environments
- multiple entrypoints
- multiple lenses
- PR review with acknowledgements
- treemap timeline with multiple frames

## Data Availability Gaps

- No shared `OutputRow` contract.
- No scenario matrix read model.
- No mini-viz batch read model.
- No evidence availability adapter.
- Neutral compare cannot show removed/base-only rows because it is head-summary driven.
- Graph/waterfall history scrubber frame contracts do not exist.
- Real scenario-scoped policy model/evaluation does not exist.
- Current E2E tests assert old labels and routes.

## Regression Guardrails

All later plans must preserve:

- scenario/environment/entrypoint/lens distinctions
- raw/gzip/brotli size semantics
- deterministic missing/failure states
- no sourcemap requirement
- no confidence UI
- no zero-filling missing data
- no lens mixing in one chart

## Acceptance Evidence

- Route inventory complete.
- Read-model inventory complete.
- Component inventory complete.
- Test inventory complete.
- Seed-data state coverage documented.
- Visualization data dependencies documented.
- GitHub check/comment flow documented.
- Cutover mode chosen.
- Current semantic baseline documented.
- Current regression behavior scope documented.
- Fixture/state matrix defined.

## Verification Results

Run during Plan 00 execution:

- `pnpm web:test` passed after updating stale public page copy assertions to current UI text.
- `pnpm web:test:unit` passed.
- `pnpm web:typecheck` passed.
- `pnpm web:seed` passed.
- `pnpm web:test:e2e` passed after updating stale homepage/history assertions to current UI text.

Test-only drift fixed during verification:

- `apps/web/test/public-pages.test.ts` now asserts the current repository/history/scenario copy and empty states.
- `apps/web/e2e/ui-functionality.spec.ts` now asserts the current homepage hero, history nav, and compare landing heading.
