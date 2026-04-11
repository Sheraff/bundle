# Remaining Product Unknowns

This document captures the main open design areas for the bundle evolution platform after the current round of product-definition work.

These are ordered roughly by importance.

## Read First

Any agent starting work on one of these topics should read these local documents first:

- `product-functionality.md`
- `scenario-environment-runid-v1.md`

These establish the current product direction:

- library-first
- scenario-first
- Vite-first
- GitHub-only in V1
- public repos first
- no repeated separate-build grouping in V1
- no public uploader in V1

## 1. Stable Identity

Status: resolved for V1.

Resolution:

- `stable-identity-v1.md`

This was the hardest technical unknown in the product, but the current V1 design is now defined and validated by the local research lab under `research/stable-identity/`.

What is now answered for V1:

- chunk continuity across commits
- split and merge detection
- degraded or low-confidence matches via explicit `ambiguous` states
- stable treemap diffing over time via logical node keys
- identity rules for entries, shared chunks, CSS, assets, packages, and modules

Follow-on work remains, but it belongs to later tasks rather than to stable-identity algorithm uncertainty:

- mapping the design onto the final plugin artifact contract
- mapping the design onto normalization and derived-data stages in the broader architecture
- surfacing degraded warnings and evidence clearly in the product UX

### References an agent should read

Local docs:

- `product-functionality.md`
  - `## Stable Identity And Normalization`
  - `## Treemap And Composition Analysis`
  - `## Build-time Graph And Waterfall Analysis`
- `scenario-environment-runid-v1.md`
- `stable-identity-v1.md`

External references:

- Vite backend integration and manifest docs
  - `https://vite.dev/guide/backend-integration`
- Vite plugin API / output metadata docs
  - `https://vite.dev/guide/api-plugin`
- Rollup plugin development and output bundle metadata
  - `https://rollupjs.org/plugin-development/#generatebundle`
- Rollup sourcemap/output docs
  - `https://rollupjs.org/configuration-options/#output-sourcemap`
- Statoscope
  - `https://github.com/statoscope/statoscope`
- rollup-plugin-visualizer
  - `https://github.com/btd/rollup-plugin-visualizer`
- source-map-explorer
  - `https://github.com/danvk/source-map-explorer`
- D3 treemap docs
  - `https://d3js.org/d3-hierarchy/treemap`

## 2. Architecture

Status: resolved for V1.

Resolution:

- `architecture-v1.md`

This defines the core system design from uploaded plugin artifact through normalized snapshots, derived series and comparisons, GitHub surfaces, and sparse-scenario commit-group behavior.

What is now answered for V1:

- the ingestion flow from uploaded artifact to persisted raw data
- the separation between raw artifacts, normalized snapshots, and derived views
- the internal commit-group model above per-scenario runs
- sparse scenario semantics for skipped or inherited runs, reruns, and partial commit groups
- baseline and comparison materialization rules
- where acknowledgements live and what they attach to
- how PR comments, checks, and dashboards consume shared derived comparison data

Follow-on work remains, but it belongs to later tasks rather than to core architecture uncertainty:

- mapping the architecture onto the final plugin artifact schema
- mapping the architecture onto concrete storage, jobs, and caching
- designing the web app information architecture on top of the shared read models
- designing the final GitHub comment and check presentation details

### References an agent should read

Local docs:

- `architecture-v1.md`
- `product-functionality.md`
  - `## Core Domain Model`
  - `## Snapshot Data Model`
  - `## Comparison And Baseline Selection`
  - `## Required Functionality`
- `scenario-environment-runid-v1.md`

External references:

- CodSpeed product/docs
  - `https://codspeed.io`
  - `https://codspeed.io/docs`
- RelativeCI
  - `https://relative-ci.com`
- Codecov Bundle Analysis overview
  - `https://docs.codecov.com/docs/javascript-bundle-analysis`
- Lighthouse CI configuration and workflow model
  - `https://googlechrome.github.io/lighthouse-ci/docs/configuration.html`

## 3. Web App Shape And Dashboards

Status: resolved for V1.

Resolution:

- `web-app-shape-v1.md`

This defines the V1 public dashboard information architecture across repository overview, repository history, scenario, and compare pages.

What is now answered for V1:

- the default public landing page
- the main `repository -> scenario` hierarchy
- how branch, scenario, environment, entrypoint, and lens navigation work
- how history, compare, treemap, graph, and budget surfaces connect
- what the public dashboard hierarchy looks like
- how to keep one repository understandable when it has many scenarios
- which public pages the GitHub PR comment should link to for current PR state inspection

Follow-on work remains, but it belongs to later tasks rather than to core web-app information architecture uncertainty:

- mapping the IA onto concrete routes, components, and implementation details
- defining final chart interactions, filtering behavior, and visual design details
- defining the final GitHub comment and check content density plus acknowledgement UX

### References an agent should read

Local docs:

- `web-app-shape-v1.md`
- `product-functionality.md`
  - `## Dashboards`
  - `## Metrics And Views`
  - `## Treemap And Composition Analysis`
  - `## Build-time Graph And Waterfall Analysis`

External references:

- CodSpeed product and docs
  - `https://codspeed.io`
  - `https://codspeed.io/docs`
- RelativeCI
  - `https://relative-ci.com`
- Codecov Bundle Analysis
  - `https://docs.codecov.com/docs/javascript-bundle-analysis`
- Statoscope
  - `https://statoscope.tech`
- rollup-plugin-visualizer
  - `https://github.com/btd/rollup-plugin-visualizer`
- D3 treemap docs
  - `https://d3js.org/d3-hierarchy/treemap`

## 4. Synthetic-Import Product Shape

Status: resolved for V1.

Resolution:

- `synthetic-import-product-shape-v1.md`

This defines the V1 synthetic-import product shape across positioning, authoring surfaces, hosted catalog behavior, saved-definition format, and future extension boundaries.

What is now answered for V1:

- synthetic-import scenarios are a saved CI checks product area, not a hosted bundle lab
- raw ESM plus metadata remains the canonical saved definition
- workflow YAML remains the repo-owned definition path
- the hosted UI should manage synthetic-import scenarios as a catalog rather than as only a single editor
- the core hosted shape is `scenario id + display name + source + budgets`
- the hosted UI should validate definitions, while real measurement stays in CI
- repo-defined and hosted synthetic scenarios with the same id should appear as one effective catalog row with an override notice
- hosted synthetic-import scenarios follow the same manual archive-only lifecycle as other scenarios
- richer synthetic settings belong behind a hidden advanced panel rather than in the normal flow
- `aliases` may become worth supporting later, but should likely stay post-V1 unless a strong recurring need appears

Follow-on work remains, but it belongs to later tasks rather than to core synthetic-import product-shape uncertainty:

- mapping the chosen synthetic-import shape onto the concrete action and hosted configuration contract
- deciding the exact syntax for any future advanced settings beyond `source`
- designing the exact hosted catalog, edit, archive, and override-notice UX
- deciding whether `aliases` ever become worth adding after V1

### References an agent should read

Local docs:

- `synthetic-import-product-shape-v1.md`
- `product-functionality.md`
  - `## Scenario Kinds And Source Of Truth`
  - `## Measurement Strategies`
  - `## Suggested V1 Scope`
- `scenario-environment-runid-v1.md`
  - `## GitHub Action Contract`
  - `## Adjacent Boundary`

External references:

- Size Limit
  - `https://github.com/ai/size-limit`
- bundlejs
  - `https://bundlejs.com`
- pkg-size
  - `https://github.com/privatenumber/pkg-size`
- Bundlephobia
  - `https://bundlephobia.com`

## 5. Plugin Artifact Contract

Status: resolved for V1.

Resolution:

- `plugin-artifact-contract-v1.md`

This defines the V1 boundary between the Vite plugin and the rest of the platform.

What is now answered for V1:

- the artifact file format as one JSON file per build invocation and scenario run
- the fixed discovery path under the Action `working-directory`
- the split between plugin artifact data and Action upload metadata
- the required top-level, environment, chunk, asset, and module raw evidence
- the rule that manifest data is required and auto-enabled by the plugin
- the rule that package attribution stays derived later instead of living in the artifact
- the rule that sourcemaps stay out of the V1 artifact contract
- the validation model where missing required evidence fails in the plugin build step
- the separate `schemaVersion` and `pluginVersion` fields for versioning

Follow-on work remains, but it belongs to later tasks rather than to core artifact-boundary uncertainty:

- mapping the chosen artifact contract onto concrete plugin implementation details and TypeScript types
- mapping the artifact plus Action envelope onto ingest validation and persistence
- defining the final upload envelope for scenario source-of-truth and GitHub metadata
- deciding whether sourcemap-enhanced attribution is ever worth adding after V1

### References an agent should read

Local docs:

- `scenario-environment-runid-v1.md`
  - `## Vite Plugin Contract`
  - `## Operational Model`
- `product-functionality.md`
  - `## Snapshot Data Model`
  - `## Collection And Upload`

External references:

- Vite backend integration / manifest
  - `https://vite.dev/guide/backend-integration`
- Vite Environment API
  - `https://vite.dev/guide/api-environment`
  - `https://vite.dev/guide/api-environment-plugins`
- Rollup plugin development / generateBundle
  - `https://rollupjs.org/plugin-development/#generatebundle`
- Codecov supported build environments
  - `https://docs.codecov.com/docs/supported-build-environments`

## 6. GitHub UX Details

Status: resolved for V1.

Resolution:

- `github-ux-details-v1.md`

This defines the V1 GitHub-native review contract across PR comments, aggregate checks, acknowledgements, deep links, and multi-scenario PR summarization.

What is now answered for V1:

- one maintained PR comment plus one aggregate required GitHub check
- a fixed-format, impacted-only, scenario-grouped PR comment
- one visible worst-series summary row plus one diff link per impacted scenario
- compare page as the primary deep-link target from both comments and checks
- partial PR comment updates with header-only pending counts
- web-app-based per-metric acknowledgements with inline GitHub visibility
- a lean blocker-focused GitHub check surface instead of a second full GitHub report

Follow-on work remains, but it belongs to later tasks rather than to core GitHub UX uncertainty:

- repo-level PR comment density settings
- exact copy and visual formatting during implementation
- whether richer GitHub-native acknowledgement actions are ever worth adding
- whether the GitHub check surface should grow denser after real user feedback

### References an agent should read

Local docs:

- `github-ux-details-v1.md`
- `architecture-v1.md`
  - `## Acknowledgements`
  - `## GitHub And Dashboard Consumption`
- `web-app-shape-v1.md`
  - `## GitHub PR Comment Deep Links`
- `product-functionality.md`
  - `## GitHub Pull Request Workflow`
  - `## GitHub Checks And Budget Gating`
  - `## Regression Acknowledgements`
- `scenario-environment-runid-v1.md`

External references:

- CodSpeed docs and product pages
  - `https://codspeed.io`
  - `https://codspeed.io/docs/features/performance-checks/`
- Codecov Bundle Analysis
  - `https://docs.codecov.com/docs/javascript-bundle-analysis`
- Codecov PR comment and status docs
  - `https://docs.codecov.com/docs/pull-request-comments`
  - `https://docs.codecov.com/docs/commit-status`
- RelativeCI GitHub PR comment docs
  - `https://relative-ci.com/documentation/setup/configure/integrations/github-pull-request-comment`
- RelativeCI GitHub check docs
  - `https://relative-ci.com/documentation/setup/configure/integrations/github-check-report`
- Bundlewatch
  - `https://github.com/bundlewatch/bundlewatch`

## 7. Infrastructure

Status: resolved for V1.

Resolution:

- `infrastructure-v1.md`
- `technology-stack-v1.md`

These documents define the V1 infrastructure shape from GitHub App-anchored upload through durable raw artifact retention, async processing, shared read models, public dashboard hosting, and the recommended concrete platform choices.

What is now answered for V1:

- one hosted product origin for authenticated pages and public dashboards
- GitHub App as the trust anchor plus short-lived repo-scoped Action upload auth
- storage split between durable raw artifacts, rebuildable normalized caches, relational read models, and object-stored heavy detail payloads
- a narrow synchronous ingest path plus queue-backed async workers
- incremental commit-group recomputation without a public finalization protocol
- summary-oriented precompute for PR and branch comparisons, landing pages, and history series
- lazy cached generation for treemap, graph, and waterfall detail payloads
- CDN and cache-friendly public dashboard delivery without a separate public read plane
- the recommended concrete V1 stack of `TanStack Start + React`, `Cloudflare Workers`, `D1`, `R2`, `Queues`, and `Workflows`

Follow-on work remains, but it belongs to later tasks rather than to core infrastructure uncertainty:

- mapping the chosen stack onto concrete schemas, storage keys, queue families, and Workflow classes
- defining the exact short-lived upload auth exchange and webhook flow
- defining worker partitioning, retry policy, and backfill controls
- tuning cache invalidation, retention controls, and cost-management after real usage appears

### References an agent should read

Local docs:

- `infrastructure-v1.md`
- `technology-stack-v1.md`
- `architecture-v1.md`
  - `## Data Layers`
  - `## Processing Pipeline`
  - `## GitHub And Dashboard Consumption`
- `product-functionality.md`
  - `## Goal`
  - `## Product Principles`
  - `## Suggested V1 Scope`
  - `## Not V1 By Default`
- `scenario-environment-runid-v1.md`

External references:

- CodSpeed product/docs
  - `https://codspeed.io`
  - `https://codspeed.io/docs`
- Lighthouse CI
  - `https://googlechrome.github.io/lighthouse-ci/docs/configuration.html`
- Codecov Bundle Analysis
  - `https://docs.codecov.com/docs/javascript-bundle-analysis`

## Suggested Next Order

The main product-shape unknowns captured in this document are now resolved for V1.

The next work should come from the follow-on sections in the resolved V1 docs:

1. map the decision docs onto concrete schemas, routes, jobs, and contracts
2. implement the plugin, ingest, worker, GitHub, and dashboard slices against those contracts
3. refine deferred UX and operational details only where the resolved V1 docs explicitly leave room for later choices
