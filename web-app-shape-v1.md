# Web App Shape And Dashboards V1

## Summary

- The default public landing page for a repository is the repository overview.
- The main public hierarchy is `repository -> scenario`, with history and comparison views attached to both levels.
- Repository and scenario pages are history-first exploration surfaces, not only static latest-result pages.
- Branch evolution and point-to-point commit comparison are both first-class in V1, but they serve different jobs.
- Branch evolution lives on repository history and scenario history pages.
- Point-to-point commit comparison lives on a dedicated compare page.
- The compare page has a neutral public mode and an optional PR-scoped review mode.
- Treemap and graph views are detail tabs inside scenario and compare flows, not top-level navigation items.
- Metrics and charts must always keep lens semantics explicit.
- One chart must not mix multiple lenses in the same plot.
- All main page state should live in the URL so every important screen is public and shareable.

## Goals

This document resolves the V1 web-app information architecture questions around:

- the default public landing page
- the top-level navigation hierarchy
- how repository, scenario, environment, entrypoint, branch, and lens navigation work
- how history, diff, treemap, graph, and budget views connect
- what the public dashboard hierarchy looks like
- how the UI stays understandable when one repository has many scenarios

## Core Navigation Model

### Global context

The main user-visible navigation dimensions are:

- repository
- branch
- scenario
- environment
- entrypoint
- lens
- comparison base and head when compare mode is active

Important V1 rules:

- The repository is the top-level public object.
- Scenario is the main drilldown object under the repository.
- Branch is primarily a history filter and overlay dimension, not a top-level navigation section.
- Environment, entrypoint, and lens are sticky page-level controls on scenario and history views.
- Lens must always be explicit anywhere metrics or charts are shown.
- All main filters and compare state should be encoded in the URL.

### Top-level public pages

V1 should expose these public page types:

- repository overview
- repository history
- scenario page
- compare page

V1 should not add separate top-level public sections for:

- branches
- treemap
- graph
- budgets

Those remain attached to repository, scenario, and compare flows.

## Page Model

### 1. Repository overview

Purpose:

- be the default public landing page
- give a quick sense of overall bundle evolution for the repository
- make it easy to find the scenario or regression worth inspecting next

Default state:

- default branch selected
- default lens selected as the product default lens from `product-functionality.md`, which is `Entry JS + Direct CSS`
- many series lines visible in the main trend chart

The top of the page should prioritize a trend chart first.

Chart semantics:

- One line represents one full comparable series.
- A series means `scenario + environment + entrypoint + lens`.
- The chart must keep one lens fixed.
- The chart may show many series lines at once.
- Users can trim or refine the chart with filters.

Below the hero chart, the page should include:

- repository health and budget summary
- quick access to the latest important compare state
- a filterable scenario catalog

### 2. Scenario catalog on repository overview

The repository overview should include one scenario list, not hardcoded grouped sections.

The catalog should support strong filtering and finding behavior because repositories may contain many scenarios.

Recommended filter dimensions:

- text search
- health state
- changed or regressed only
- scenario kind
- scenario source of truth
- freshness

The catalog should use rich rows rather than minimal list items.

Each scenario row should show:

- scenario name
- visible kind or source chip
- current health state
- recent delta summary
- freshness or last-updated signal
- small trend sparkline

The catalog should not depend on environment count or entrypoint count as a primary scanning aid.

### 3. Repository history

Purpose:

- provide repository-level branch evolution
- allow users to view how many series changed over time
- support branch overlay against the base branch for the same selected context

Default state:

- default branch selected
- default lens selected
- many series lines visible

Repository history is the main cross-scenario branch evolution surface.

It should support filters for:

- branch
- scenario
- environment
- entrypoint
- lens

Behavior:

- When a non-default branch is selected, the base branch should be overlaid for the same filter context.
- The chart should still keep one fixed lens.
- Users may aggregate or trim down the set of visible lines, but the default should still allow many full series lines.

### 4. Scenario page

Purpose:

- make scenario the main focused drilldown object under a repository
- support branch evolution and deeper inspection within one scenario
- provide the main home for environment, entrypoint, and lens exploration

The scenario page is history-first in V1.

Default state:

- default branch selected
- default lens selected
- environment filter defaulting to a broad state rather than forcing one environment immediately
- entrypoint filter defaulting to a broad state rather than forcing one entrypoint immediately

This lets the page open with several series lines visible while still using sticky controls to narrow to a single series when needed.

Sticky controls should include:

- branch
- environment
- entrypoint
- lens

Scenario chart semantics:

- One chart still uses one explicit lens.
- The chart can show several full series lines within the scenario.
- Users can filter down or aggregate from there.

The scenario page should also expose detail tabs or panes for the current selected context, including:

- history
- compare shortcuts
- treemap
- graph
- supporting diff tables and budget details

### 5. Compare page

Purpose:

- provide point-to-point comparison between a selected base point and head point
- support regression inspection for a branch or PR
- provide the main diff surface for deltas, treemap diff, and graph diff

This compare page is distinct from branch evolution.

Branch evolution answers:

- how a branch changed over time

Point comparison answers:

- what changed between these two selected commits or runs

The compare page should support comparing two comparable points for the same repository context.

Mode rule:

- neutral compare uses base and head plus normal repository context filters
- PR-scoped compare adds PR review context so acknowledged and blocker state can match GitHub surfaces for that PR
- for public repositories, both modes may remain public-read, but acknowledgement actions require auth and repo permission

Typical use:

- open the branch head commit against the base commit where the branch diverged
- inspect delta summaries for all affected series
- drill into one series for treemap and graph diff

The compare page should be public and URLable.

The first content block should be a flat list of series rows rather than scenario-grouped sections.

If the compare context is partial or contains non-series review states, the page should also expose a compact commit-group status block ahead of the main series table.

That block should explain states such as:

- inherited scenarios
- missing scenarios
- no-baseline cases
- still-pending processing when the page is opened mid-flight

Each row represents one comparable series and should include:

- scenario
- environment
- entrypoint
- lens
- current value
- baseline value
- absolute delta
- percentage delta
- budget or health state

From a row, the user should be able to open deeper detail for:

- treemap diff
- graph diff
- asset or package diff
- budget explanation

Important V1 rule:

- inherited or missing scenario state should not be faked as ordinary series rows when no fresh comparable series was measured for that scenario on the selected head commit

## Selected-Series Detail Model

Treemap, graph, and stable longitudinal inspection require a fully qualified series context.

That means:

- scenario selected
- environment selected
- entrypoint selected
- lens selected

Important V1 rule:

- Treemap-over-time should apply only to one selected series.

This avoids confusing repository-wide or scenario-wide treemap timelines where the underlying measured subject changes shape too much.

When the series context is fully qualified, the product can expose:

- a single-series history chart
- a point-to-point diff view
- a treemap diff
- a treemap timeline or scrubber across time
- a graph view
- asset, package, and module detail tables

## Treemap And Graph Placement

Treemap and graph views are required in V1, but they should not define the navigation spine of the app.

V1 placement rules:

- Treemap is a detail view inside scenario and compare flows.
- Graph is a detail view inside scenario and compare flows.
- Neither treemap nor graph should be a top-level repository navigation item.
- Treemap and graph should share the same selected context.
- Treemap timeline behavior should only activate once one series is selected.

This keeps overview and history pages understandable while still making deep inspection available from every meaningful state.

## Budget And Status Surfaces

Budgets are part of the dashboard story, but not a separate first-class dashboard hierarchy.

Budget and status information should appear in:

- repository overview summaries
- scenario catalog rows
- compare-page series rows
- selected-series detail views

V1 should treat budgets as overlays on the main repository, scenario, history, and compare flows rather than as a dedicated standalone section.

## URL Model

All important public state should live in the URL.

That includes:

- branch
- scenario
- environment
- entrypoint
- lens
- optional PR review context
- compare base
- compare head

Route shape can still change during implementation, but the public model should support shareable URLs like:

- repository overview
- repository history with branch and lens filters
- scenario page with branch, environment, entrypoint, and lens filters
- compare page with base and head plus the same context filters
- PR-scoped compare page with the same filters plus PR context

Illustrative examples:

- `/{repo}`
- `/{repo}/history?branch=main&lens=entry-js-direct-css`
- `/{repo}/scenarios/{scenario}?branch=main&env=all&entrypoint=all&lens=entry-js-direct-css`
- `/{repo}/compare?base=<sha>&head=<sha>&scenario=<id>&env=client&entrypoint=<entry>&lens=entry-js-direct-css`
- `/{repo}/compare?pr=<number>&base=<sha>&head=<sha>&scenario=<id>&env=client&entrypoint=<entry>&lens=entry-js-direct-css`

These route examples are descriptive, not a final router contract.

## Public Dashboard Hierarchy

The public hierarchy should feel like this:

- repository overview as the landing page
- repository history for cross-scenario branch evolution
- scenario page for focused history and detail
- compare page for point-to-point diff

The product should not force users to choose a scenario before seeing any data.

The product should also not force users into a compare-first workflow when they are trying to understand long-term evolution.

## Page Relationship Map

Illustrative sitemap:

```text
GitHub PR comment / GitHub check
  |
  |  primary "what changed in this PR?" entry
  v
+----------------------------------------------------------------------------------+
| Compare Page                                                                     |
| /{repo}/compare?base=<sha>&head=<sha>[&scenario][&env][&entrypoint][&lens][&tab]|
|----------------------------------------------------------------------------------|
| widgets                                                                          |
| - compare header: base vs head                                                   |
| - flat series delta table                                                        |
| - selected-series detail                                                         |
| - tabs: Treemap diff | Graph diff | Asset/package diff | Budget explanation      |
+---------------------------+--------------------------------------+-----------------+
                            |                                      |
                            | long-term context                    | direct tab state
                            v                                      v
+----------------------------------------------------------------------------------+
| Scenario Page                                                                    |
| /{repo}/scenarios/{scenario}?branch=<branch>&env=<env>&entrypoint=<e>&lens=<l>  |
|----------------------------------------------------------------------------------|
| widgets                                                                          |
| - history chart                                                                  |
| - sticky controls: branch, environment, entrypoint, lens                         |
| - compare shortcut                                                               |
| - tabs or panes: History | Treemap | Graph | Diff/Budget                         |
| - treemap timeline only after one full series is selected                        |
+---------------------------+--------------------------------------+
                            |
                            | broader branch evolution
                            v
+----------------------------------------------------------------------------------+
| Repository History                                                               |
| /{repo}/history?branch=<branch>&scenario=<s>&env=<env>&entrypoint=<e>&lens=<l>  |
|----------------------------------------------------------------------------------|
| widgets                                                                          |
| - branch evolution chart                                                         |
| - many series lines, fixed lens                                                  |
| - base-branch overlay                                                            |
| - filters: branch, scenario, environment, entrypoint, lens                       |
| - compare launcher                                                               |
+---------------------------+--------------------------------------+
                            ^
                            |
                            | default public landing page
                            |
+----------------------------------------------------------------------------------+
| Repository Overview                                                              |
| /{repo}                                                                          |
|----------------------------------------------------------------------------------|
| widgets                                                                          |
| - hero trend chart with many series lines and a fixed lens                       |
| - repository health and budget summary                                           |
| - latest important compare card                                                  |
| - scenario catalog with rich rows, filters, and sparklines                       |
+---------------------------+------------------------------------------------------+

Typical navigation:
Repository Overview -> Repository History
Repository Overview -> Scenario Page
Repository Overview -> Compare Page
Repository History -> Compare Page
Repository History -> Scenario Page
Scenario Page -> Compare Page
Scenario Page -> Treemap or Graph tab state
Compare Page -> Treemap diff or Graph diff tab state
Compare Page -> Scenario Page
```

## GitHub PR Comment Deep Links

The PR comment is fundamentally a point-comparison surface, not a history surface.

Important rule:

- The main PR comment destination should be the compare page for the current PR base and head.

Primary link target:

- `/{repo}/compare?pr=<number>&base=<base-sha>&head=<head-sha>`

This should be the main call to action from the PR comment because it best matches the user job:

- what changed on this PR
- what is passing or failing
- which series regressed or improved

Per-row or per-scenario links in the PR comment should go to filtered compare views rather than generic overview pages.

Recommended PR comment links:

- `Open PR diff`
  - `/{repo}/compare?pr=<number>&base=<base-sha>&head=<head-sha>`
- `View diff` for one affected series
  - `/{repo}/compare?pr=<number>&base=<base-sha>&head=<head-sha>&scenario=<id>&env=<env>&entrypoint=<entry>&lens=<lens>`

Recommended meaning of each link:

- `Open PR diff` is the main state-of-the-PR destination.
- `View diff` is the main per-series delta inspection link.

Once on the compare page, richer treemap, graph, and scenario-history exploration remain available as normal web-app navigation.

Pages that should not be the primary PR comment destination:

- repository overview
- repository history

Those pages remain useful for exploration, but the PR comment should lead with the compare page because the PR comment is about current PR state, not about broad repository history.

## Why This Shape Fits V1

- It matches the scenario-first model without making the app impossible to scan at repository level.
- It keeps public dashboards understandable for repositories with many scenarios by using one filterable catalog instead of hardcoded grouped pages.
- It keeps lens semantics explicit by fixing lens per chart.
- It supports both major user jobs: branch evolution and regression investigation.
- It keeps treemap and graph where they are strongest: deep inspection after context selection.
- It stays aligned with the architecture decision that dashboards, PR comments, and checks read from the same derived comparison objects.
- It keeps every important state public and shareable through URL state.

## Explicit V1 Limits

- No top-level public `Branches` page.
- No top-level public `Treemap` page.
- No top-level public `Graph` page.
- No mixed-lens charts.
- No repository-wide treemap-over-time view.
- No scenario-wide treemap-over-time view without selecting a single series.
- No requirement that scenario catalog scanning depend on environment or entrypoint counts.

## Follow-On Work

This document resolves the V1 information architecture shape, but follow-on work remains:

- map these pages onto concrete route names and UI components
- define the exact repository overview summary blocks and ordering below the hero chart
- define compare-page interaction details for row selection and detail tabs
- define exact chart interactions for filtering, aggregation, and branch overlay
- define the final GitHub deep-link targets into these public pages
