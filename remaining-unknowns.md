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

### Why this is still unknown

We have only chosen a minimal V1 entry point for synthetic-import scenarios.

What remains unclear:

- how far synthetic-import scenarios should grow as a product area
- whether they need richer configuration than raw inline ESM
- how multiple synthetic scenarios should be authored and managed over time
- whether future repo-versioned config should exist outside workflow YAML
- what the hosted UI should expose beyond a single `scenario` plus `source`

### What seems decided already

- Synthetic-import scenarios are first-class in V1.
- They can live in workflow YAML or hosted UI.
- Repo-defined synthetic-import scenarios take precedence over hosted definitions.
- Raw inline ESM is acceptable for V1.

### References an agent should read

Local docs:

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

### Why this is still unknown

We decided on the flow, but not on the actual artifact.

We still need to define:

- artifact file format and schema
- artifact discovery rules
- schema versioning
- validation and degraded-state rules
- required vs optional raw data
- how much bundle graph/module/package data belongs in the artifact

This is the boundary between the plugin and the rest of the platform.

### What seems decided already

- The plugin should stay focused on bundle inspection.
- The plugin writes a local artifact.
- The GitHub Action is responsible for upload.
- The plugin contract should stay minimal in V1.

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

### Why this is still unknown

The overall GitHub-native strategy is clear, but the actual UX contract is not.

We still need to define:

- PR comment structure and density
- check granularity
- acknowledgement UX
- how comments link to public dashboards and deep diffs
- how multiple scenarios appear in one PR without becoming noisy

### What seems decided already

- PR comments are required.
- Checks are required.
- Comments should be updated in place.
- Per-metric acknowledgements are in V1.
- Notes on acknowledgements are optional.

### References an agent should read

Local docs:

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
- RelativeCI GitHub PR comment docs
  - `https://relative-ci.com/documentation/setup/configure/integrations/github-pull-request-comment`
- Bundlewatch
  - `https://github.com/bundlewatch/bundlewatch`

## 7. Infrastructure

### Why this is still unknown

Infrastructure is still open, but it should follow architecture rather than lead it.

We do not yet know:

- storage split between raw artifacts, normalized snapshots, and derived views
- job model for ingestion and diff computation
- what should be synchronous vs asynchronous
- caching and precomputation strategy
- public dashboard hosting model

This is important, but lower-priority than the architecture and data model choices above.

### What seems decided already

- V1 is GitHub-only.
- V1 starts with public repositories and public dashboards.
- The platform is CI-first.

### References an agent should read

Local docs:

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

If we want to reduce uncertainty efficiently, the next sequence should be:

1. Plugin artifact contract
2. GitHub UX details
3. Synthetic-import product shape
4. Infrastructure
