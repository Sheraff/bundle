# UI Functionality Pass

This pass is about complete product functionality, not visual polish. We should keep CSS minimal and focus on making every important state reachable, URL-addressable, testable, and backed by real data. Chunk Scope is still pre-production, so we can change routes, data shapes, and internal contracts without backwards compatibility work.

## Source Plans Reviewed

- `plans/web-app-shape-v1.md`
- `plans/product-functionality.md`
- `plans/github-ux-details-v1.md`
- `plans/synthetic-import-product-shape-v1.md`
- `plans/next-steps-todo.md`
- `plans/remaining-unknowns.md`
- `plans/stable-identity-v1.md`

## Current UI State

Existing routes:

- `/`
- `/app`
- `/app/setup`
- `/app/installations/$installationId`
- `/r/$owner/$repo`
- `/r/$owner/$repo/settings`
- `/r/$owner/$repo/compare`
- `/r/$owner/$repo/scenarios/$scenario`

Missing or incomplete product functionality:

- No repository history route.
- No hosted synthetic scenario management route.
- No treemap, graph, or waterfall detail view.
- Compare page supports base/head URLs, but not an in-app arbitrary comparison builder.
- Scenario and compare pages have data tables, but no complete selected-series detail model.
- Repository overview has basic filtering only; scenario catalog needs richer finding and scanning.
- Repository overview currently shows trend data as a raw table only; it needs a real trend graph for quick evolution scanning.
- Signed-in state exists, but global signed-in/signed-out navigation is minimal.
- Homepage is only a placeholder and does not explain the product or path to adoption.

## Evaluation Of Proposed Tasks

1. Treemap, graph, and waterfall visualizations.
   - Required for V1.
   - Should be detail tabs inside scenario and compare flows, not top-level pages.
   - Requires read models that expose selected snapshot/diff data from normalized snapshots and comparisons.
   - Use D3 directly for SVG visualizations from the start. Tables remain required as inspectable fallbacks, but the visualization implementation should not build a temporary non-D3 abstraction first.

2. Selectors for scenario, lens, and entrypoint.
   - Required and central to the URL model.
   - Existing pages have some filter links, but we need consistent controls across repository, history, scenario, and compare pages.
   - Scenario, environment, entrypoint, lens, branch, base, head, PR, and tab state should be URL-backed.
   - Most visualizations also need a metric selector for `raw`, `gzip`, and `brotli` values. The selected metric should be URL-backed, default to `gzip` where one number is needed for visual scanning, and remain independent from the measurement lens.

3. Synthetic scenario edition and creation.
   - Required by product plans.
   - Should be an authenticated repository management surface, not a public page.
   - Hosted synthetic definitions should be a catalog with create/edit/archive, raw ESM source, display name, budgets, and override notices for repo-defined scenarios.
   - Start with a simple `<textarea>` for raw ESM source, not Monaco. Monaco is useful later if editing becomes painful, but it adds bundle weight, SSR/client integration work, and keyboard/focus complexity before we need it.
   - Real measurement should still happen in CI.

4. Arbitrary comparisons.
   - Required by product plans.
   - Start with two-point comparisons: choose base/head commits or branches, then land on `/compare?base=...&head=...`.
   - Multi-select two-or-more comparisons is useful, but should be implemented as a second layer after two-point compare is solid. The product data model currently centers on pairwise comparisons; N-way comparison likely needs derived read-model additions.

5. Signed-in state and sign-out functionality.
   - Required for authenticated actions and management pages.
   - Sign-out already exists at `/api/v1/auth/logout`, but the UI should make auth state visible globally.
   - Public pages should show signed-in state and management links when applicable without blocking public reads.

6. Homepage outline.
   - Required for first external readers and dogfooding.
   - Should explain what Chunk Scope is, show a quick start, link to demo/public repo, explain GitHub App setup, and link to docs/setup.

## Additional Tasks For This Pass

1. Repository history page.
   - Explicitly listed in existing plans and still missing.
   - Needed for branch evolution, arbitrary compare launching, and repository-level exploration.

2. Selected-series detail model.
   - Required before treemap/graph/waterfall can be coherent.
   - A selected series is `scenario + environment + entrypoint + lens`.
   - Scenario and compare pages should share the same selected-series controls and detail tabs.

3. Acknowledgement UI completion.
   - `next-steps-todo.md` calls out closing the PR acknowledgement loop.
   - Compare page already contains acknowledgement-related code, but the UI pass should verify the full signed-in flow, mutation, refresh, and GitHub republish behavior.

4. Budget configuration UI skeleton.
   - Product specs require budgets.
   - Full budget engine can remain minimal, but hosted synthetic scenario forms and detail pages should reserve budget fields and show current budget states.

5. Partial, missing, inherited, and degraded-state explanations.
   - Existing docs emphasize not faking missing/inherited scenarios as normal rows.
   - UI should explain why data is absent or degraded, especially around stable identity warnings.

6. Route-level and interaction tests.
   - Every new page/control should get route or read-model coverage.
   - The pass should keep `pnpm --filter @workspace/web typecheck` and relevant tests green after each feature slice.

7. Local development data loop.
   - We currently have meaningful data in staging only.
   - The UI pass needs a fast localhost loop for Playwright and manual interaction.
   - We should support both remote-staging-binding dev for full-fidelity checks and local fixture/seeded data for fast iteration.

## Target Route Map

Public routes:

- `/`
- `/r/$owner/$repo`
- `/r/$owner/$repo/history`
- `/r/$owner/$repo/compare`
- `/r/$owner/$repo/scenarios/$scenario`

Authenticated routes:

- `/app`
- `/app/setup`
- `/app/installations/$installationId`
- `/r/$owner/$repo/settings`
- `/r/$owner/$repo/settings/synthetic-scenarios`
- `/r/$owner/$repo/settings/synthetic-scenarios/new`
- `/r/$owner/$repo/settings/synthetic-scenarios/$scenarioId/edit`

Tabs should remain URL search state on pages that have multiple detail modes. They are not universal across all pages.

Repository overview `/r/$owner/$repo`:

- No tabs in this pass.
- Shows trend graph, health summary, latest important compare, scenario catalog.
- URL controls: branch, lens, metric, catalog filters.

Repository history `/r/$owner/$repo/history`:

- No tabs in the first implementation.
- Shows branch evolution graph and history table.
- URL controls: branch, scenario, environment, entrypoint, lens, metric.

Scenario page `/r/$owner/$repo/scenarios/$scenario`:

- `tab=history`
- `tab=treemap`
- `tab=graph`
- `tab=waterfall`
- `tab=assets`
- `tab=packages`
- `tab=budget`

Compare page `/r/$owner/$repo/compare`:

- `tab=summary`
- `tab=treemap`
- `tab=graph`
- `tab=waterfall`
- `tab=assets`
- `tab=packages`
- `tab=budget`
- `tab=identity`

Repository settings `/r/$owner/$repo/settings`:

- No tabs in this pass. Use links to dedicated settings subroutes.

Synthetic scenario management routes:

- No tabs in this pass. Use list/create/edit pages.

All tabs should preserve unrelated URL state. The selected tab must never be required to understand the main page state.

## Development Strategy

We need a localhost development loop that can be exercised with Playwright while still using realistic data.

Use three complementary modes:

1. Fast local UI mode.
   - Run the app locally with local Workers/D1 bindings.
   - Add seed scripts that create a small deterministic repository with branch runs, PR runs, scenarios, comparisons, summaries, and publication rows.
   - Store enough representative normalized snapshot fixtures in the repo or generated test fixtures to power treemap, graph, and waterfall UI while the staging data copy path matures.
   - This is the default mode for Playwright UI iteration because it is fast and deterministic.

2. Localhost with remote staging data.
   - Use Cloudflare remote bindings where possible for full-fidelity manual checks against staging D1/R2.
   - The goal is to still access the app through localhost so Playwright can interact with it, but read the same data that staging has.
   - If the current Vite/Cloudflare dev stack cannot use remote bindings reliably, add a small dev proxy/read-model mode that fetches staging-only data through explicit scripts instead of blocking the UI pass.

3. Staging validation mode.
   - Deploy with `pnpm staging:deploy` after each completed slice.
   - Verify with `pnpm staging:verify` and the `Sheraff/bundle-test` smoke workflow when changes affect upload, publication, or setup flows.

Immediate development tasks:

- Add `dev:seed` or `web:seed` scripts for local D1 data.
- Add fixture normalized snapshots for one small repo with at least two commits and one PR.
- Add Playwright against localhost for route navigation and selector interactions.
- Keep staging as the final integration check, not the only place where UI data exists.

## Work Plan

### 1. Shared UI Shell And Auth State

Goal: make signed-in/signed-out state visible everywhere without making public pages private.

Tasks:

- Add a root/header server loader that returns the current user when present.
- Show product name, home link, public/repo context where applicable, signed-in user, admin link, login link, and sign-out link.
- Keep `/api/v1/auth/logout` as the sign-out action.
- Ensure public pages render for anonymous users.
- Add tests for anonymous and signed-in root/header states where practical.

Acceptance:

- Anonymous users see login/setup paths.
- Signed-in users see their login and a sign-out link.
- Public repo pages stay public.

### 2. Homepage Outline

Goal: replace placeholder homepage with a functional product outline.

Sections:

- Hero: what Chunk Scope does in one sentence.
- How it works: Vite plugin, GitHub Action, GitHub App, PR comment/check, public dashboard.
- Quick start: install GitHub App, install plugin, add Vite plugin, add workflow.
- Demo links: staging smoke repo and example PR diff.
- What you can inspect: scenarios, trends, compare, treemap, graph, waterfall, acknowledgements.
- Current limitations: public repos first, Vite first, staging channel if applicable.
- Auth CTA: sign in with GitHub or open admin.

Acceptance:

- `/` explains the product without needing internal docs.
- Quick start reflects the current staging package/action channel.

### 3. Consistent Selector Components

Goal: make scenario, branch, environment, entrypoint, lens, and tab selection consistent.

Tasks:

- Add small reusable selector components that render links/forms, not styled widgets.
- Use URL search state as the source of truth.
- Reuse selectors on repository overview, repository history, scenario page, and compare page.
- Ensure option lists come from read models and preserve unrelated URL state.
- Add “all” handling for scenario pages where broad context is valid.
- Add a reusable metric selector for `raw`, `gzip`, and `brotli`; use it on trend graphs, treemaps, graph node sizing where applicable, waterfall row sizing, and diff/detail tables.

Acceptance:

- Users can change scenario, environment, entrypoint, lens, branch, metric, and tab without losing relevant context.
- URLs are shareable and reloadable.

### 4. Repository Overview Trend Graph

Goal: make `/r/$owner/$repo` useful as a quick visual preview of bundle evolution.

Tasks:

- Add a D3 trend graph above or alongside the existing trend table.
- Keep lens fixed by URL state.
- Use the selected metric (`raw`, `gzip`, or `brotli`) for the y-axis.
- Show multiple series lines by default, one per `scenario + environment + entrypoint + lens`.
- Keep the raw table below as an accessibility/debug fallback.
- Link graph/table points to compare or scenario pages where the context is known.

Acceptance:

- Repository homepage gives a quick visual sense of trends without reading a table.
- Users can switch raw/gzip/brotli and see the graph/table update from URL state.

### 5. Repository History Page

Goal: add the missing branch-evolution surface.

Tasks:

- Add `/r/$owner/$repo/history`.
- Support URL filters: `branch`, `scenario`, `env`, `entrypoint`, `lens`.
- Show a fixed-lens D3 trend graph first, with the table as fallback/detail.
- Support raw/gzip/brotli metric selection.
- Add branch overlay/base branch comparison data where available.
- Add compare launcher links from selected points or latest branch state.
- Link from repository overview to repository history.

Acceptance:

- A user can inspect cross-scenario branch evolution from the UI.
- A user can launch a compare from history.

### 6. Arbitrary Compare Builder

Goal: let users create point-to-point comparisons from the UI.

Tasks:

- Add compare controls to repository history and compare page.
- Let users select base and head by commit SHA from known commit groups.
- Let users select branch tips as convenience shortcuts that resolve to commit SHAs.
- Keep pairwise compare as the first implementation.
- Add a “multi-compare later” placeholder only if needed; do not fake N-way comparisons using pairwise data.

Acceptance:

- Users can choose two commits or branch tips and land on a valid compare URL.
- Compare page explains no-baseline or no-matching-series states.

### 7. Selected-Series Detail Tabs

Goal: establish the detail surface used by treemap, graph, waterfall, assets, packages, and budgets.

Tasks:

- On scenario and compare pages, require or guide toward a fully qualified series for detail tabs.
- Show current selected context: scenario, environment, entrypoint, lens, base/head if compare mode.
- Add page-specific `tab` URL state as defined in the route map above.
- Add placeholder-backed functional tabs for each page-specific tab.
- Add `metric` URL state where the selected tab visualizes or tabulates size values.
- Use real read-model data where already available; clearly mark unavailable data.

Acceptance:

- Detail tabs do not appear as disconnected placeholders.
- Missing required context is explained with selector prompts.

### 8. Treemap View

Goal: render composition for one selected snapshot or pairwise diff.

Tasks:

- Add read model for treemap nodes from normalized snapshot data.
- Render the treemap with D3 directly.
- Keep asset/module/package hierarchy tables as required fallbacks and debugging views.
- Support raw/gzip/brotli metric selection for node sizing when the data exists.
- Support snapshot mode on scenario page.
- Support diff mode on compare page: added, removed, grown, shrunk, same, split, merge, ambiguous.
- Surface stable-identity degraded evidence where available.
- Add search/filter within node list.

Acceptance:

- A selected series can show composition for a snapshot.
- A selected compare can show where bytes changed in treemap terms.

### 9. Graph And Waterfall Views

Goal: expose build-time graph relationships and network-initial closure structure.

Tasks:

- Add read model for static imports, dynamic imports, imported CSS/assets, and dependency depth.
- Graph tab shows D3-rendered nodes and edges with static/dynamic edge labels, plus a table fallback.
- Waterfall tab shows D3-rendered build-time dependency order/depth, not browser timings, plus a table fallback.
- Support raw/gzip/brotli metric selection for node/row sizing where applicable.
- For lenses without network-initial semantics, explain what graph/waterfall can and cannot show.

Acceptance:

- Users can inspect dependency fan-out and dynamic boundaries.
- Waterfall language is explicitly build-time, not runtime timing.

### 10. Asset, Package, Module, And Stable-Identity Detail Tables

Goal: provide non-visual fallback and debug surfaces for every visualization.

Tasks:

- Add tables for assets, chunks, modules, and packages for selected series.
- Show raw/gzip/brotli values where available.
- Show added/removed/changed states in compare mode.
- Show stable identity confidence/evidence for changed assets/chunks/modules.
- Link table rows to treemap/graph selections where possible.

Acceptance:

- Every visualization has an inspectable table equivalent.
- Degraded identity is visible and understandable.

### 11. Hosted Synthetic Scenario Management

Goal: add authenticated create/edit/archive flows for hosted synthetic-import scenarios.

Tasks:

- Add persistence for hosted synthetic scenario definitions if not already present.
- Add list route under repository settings.
- Add create/edit forms for scenario id, display name, raw ESM source, and budget fields.
- Use a plain textarea for raw ESM source in this pass.
- Validate scenario id and source shape.
- Add archive action; no hard delete in V1.
- Show repo-defined override notices when a hosted scenario id is shadowed.
- Expose hosted definitions to CI resolution path if not already wired.

Acceptance:

- A repo admin can create, edit, archive, and list hosted synthetic-import scenarios.
- The UI makes clear that CI performs real measurement later.

### 12. Acknowledgement UI Completion

Goal: make PR acknowledgement usable from compare pages.

Tasks:

- Audit current acknowledgement mutation and UI state.
- Ensure only signed-in users with repo write permission can acknowledge.
- Add note field and per-item acknowledgement controls.
- Refresh summaries and GitHub publications after acknowledgement.
- Show acknowledged state in compare rows and detail tabs.

Acceptance:

- A user can acknowledge a regression from the PR compare page.
- PR comment/check update to reflect acknowledged state.

### 13. Budget UI Skeleton

Goal: make budget state visible and reserve configuration flows.

Tasks:

- Show current budget state on compare rows and selected-series detail tabs.
- Add budget fields to hosted synthetic scenario forms.
- Add repository/settings skeleton for future budget rules if full evaluation is not completed in this pass.
- Avoid pretending budget evaluation is complete if it remains `not-configured`.

Acceptance:

- Budget state is visible where comparisons are shown.
- Hosted synthetic scenario forms can capture initial budget intent or clearly mark it as coming soon.

### 14. Error, Empty, Partial, And Processing States

Goal: make all data absence states understandable.

Tasks:

- Standardize messages for no uploads, no scenarios, no baseline, missing scenario, inherited scenario, pending processing, failed run, failed comparison, and degraded identity.
- Add links to workflow runs, settings, or compare pages when available.
- Ensure PR compare pages explain partial state from commit-group summaries.

Acceptance:

- Users are never left with a blank table without explanation.

### 15. Local Dev, Fixtures, And Playwright

Goal: make UI work fast to develop locally before staging deployment.

Tasks:

- Add local D1 seed scripts for a deterministic demo repo.
- Add representative normalized snapshot fixtures that include enough graph/composition data for visualizations.
- Add a documented command for running localhost with seeded data.
- Add Playwright checks for homepage, repository overview graph, selector changes, scenario tabs, compare tabs, and synthetic scenario forms.
- Investigate remote staging bindings for localhost; use them for final manual checks if reliable.

Acceptance:

- We can open localhost in Playwright and interact with meaningful product data without waiting for staging deploys.
- Staging remains the final integration check, not the primary development loop.

### 16. Tests And Verification

Goal: keep the UI pass safe despite broad surface area.

Tasks:

- Add read-model tests for new history, selectors, metric selection, compare launcher, and selected-series detail data.
- Add route tests for homepage, history, synthetic management, and selected tabs.
- Add mutation tests for hosted synthetic scenarios.
- Keep `pnpm --filter @workspace/web typecheck` passing.
- Run focused tests after each slice and full web tests before deploying.

Acceptance:

- New functionality is covered by route/read-model/mutation tests.
- Staging deploy and smoke verification still pass.

## Suggested Implementation Order

1. Local dev seed/fixtures and Playwright localhost loop.
2. Shared shell/auth state and homepage outline.
3. Selector components, metric selector, and URL-state cleanup.
4. Repository overview trend graph.
5. Repository history page.
6. Arbitrary two-point compare builder.
7. Selected-series detail tabs.
8. Asset/package/module tables.
9. Treemap data and D3 treemap view.
10. Graph and waterfall data views.
11. Hosted synthetic scenario management.
12. Acknowledgement UI completion.
13. Budget UI skeleton.
14. Error/empty/partial-state polish across all pages.
15. Full verification and staging deploy.

This order creates a fast development loop first, then builds navigation and URL state, then detail inspection surfaces, then authenticated management flows. It avoids building a treemap or graph that has no coherent selected-series context.

## Non-Goals For This Pass

- Visual design polish or final CSS system. Write the least CSS possible; prefer semantic HTML, browser defaults, SVG attributes, and small utility styles only where functionality requires them.
- Private repository support.
- Non-Vite bundler support.
- Browser-observed performance timing waterfalls.
- N-way comparison charts unless pairwise compare and read models are complete first.
- Hosted preview measurements for synthetic scenarios.
- A generic online bundler or sandbox.

## Completion Criteria

- Homepage explains the product and quick start.
- Signed-in state and sign-out are visible in the app shell.
- Repository overview has a D3 trend graph and table fallback.
- Repository overview, repository history, scenario, and compare pages all have working URL-backed selectors, including raw/gzip/brotli metric selection where size values are visualized.
- A user can launch arbitrary pairwise comparisons from the UI.
- Scenario and compare pages expose selected-series detail tabs.
- Treemap, graph, waterfall, asset/package/module, and budget tabs show real data or explicit unavailable-state explanations.
- Repo admins can manage hosted synthetic-import scenarios.
- PR acknowledgement flow works from compare pages.
- Public and authenticated routes have meaningful empty/error/partial states.
- Web typecheck/tests pass and staging smoke still passes after deployment.
