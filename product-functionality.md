# Bundle Evolution Platform Product Spec

## Goal

Build a CodSpeed-like platform for tracking the evolution of bundle outputs over time.

The product should help GitHub repositories:

- measure bundle impact automatically in CI
- compare pull requests against their base branch
- understand why bytes changed
- track trends across branches and consumer scenarios
- enforce budgets while allowing explicit acknowledgement of known regressions

V1 should be:

- GitHub-only
- Vite-first
- public-repo-first
- public-dashboard-friendly
- library-first, while still supporting app repositories naturally

## Product Direction

This product should optimize first for libraries and frameworks, not generic app dashboards.

The main user question is not only:

- "How big is the build?"

It is also:

- "How does this library impact a real consumer scenario?"
- "What does a tree-shaken import actually cost?"
- "How does that cost evolve over time?"

That pushes the product toward a scenario-first model instead of a flat list of metrics.

## Problem Statement

Bundle size is not a single number.

- A single build can produce raw, gzip, and brotli numbers.
- A single repository can contain multiple realistic consumer scenarios.
- A single scenario can produce multiple arbitrary Vite environments.
- A single environment can produce multiple entrypoints.
- A single build can emit many kinds of assets: JS, CSS, HTML, images, fonts, media, workers, server bundles, edge bundles, and more.
- Chunk names are often hashed, so naive file-to-file comparison breaks across commits.
- Source code can move between chunks as code splitting evolves.
- Module attribution is useful for explanation, but it is not the same as final emitted byte cost.

The product therefore needs to track normalized bundle snapshots and graph relationships, not just a scalar metric per commit.

## Research Takeaways

### CodSpeed

- The strongest part of the product is the GitHub-native workflow: collection in CI, results in PRs, checks, dashboards, and historical comparison.
- Baseline selection rules matter a lot. PRs compare against base branch. Branch runs compare against previous successful branch runs.
- Regression acknowledgement is part of the real workflow, not a nice-to-have.

### RelativeCI and Codecov Bundle Analysis

- Bundle products need assets, chunks, modules, packages, duplicate detection, and historical monitoring, not only totals.
- Stable longitudinal tracking requires normalization of asset identity beyond raw hashed filenames.
- One repo can naturally contain multiple bundle targets such as client, server, edge, esm, and cjs.

### Size Limit and bundlejs

- Synthetic, tree-shaken import measurement is a legitimate first-class need for libraries.
- Synthetic measurement and real-app measurement answer different questions and should not be collapsed into one model.

### rollup-plugin-visualizer, source-map-explorer, statoscope

- Treemap and graph analysis are central to understanding where bytes came from.
- Raw graph data matters because visualizations alone are not enough for tracking or diffing over time.

### Bundlephobia and pkg-size

- Publish size and install size are adjacent concerns.
- They are useful, but they are not the main question for this product, which is runtime bundle impact.

### Vite-specific findings

- Vite's Environment API formalizes arbitrary named environments. The product should not assume a fixed set of built-ins.
- Vite's manifest exposes entrypoints, static imports, dynamic imports, associated CSS, and imported assets.
- Vite's output metadata also exposes imported CSS and imported assets during build.
- Non-client environments may emit assets too, especially with environment-aware builds.

## Product Principles

1. GitHub-native first.
2. CI-first collection, dashboard-second exploration.
3. Library-first design center.
4. Scenario-first model.
5. Arbitrary named environments, not fixed built-ins.
6. Explicit measurement semantics instead of vague metric names.
7. Structured snapshots and graphs, not a single number.
8. Bytes plus build-time graph first. Runtime timing is not V1.
9. Scenarios are the main product differentiator.
10. Do not require a central repo config when existing build targets and plugin metadata are sufficient.

## Primary Users

- Library maintainers who want to measure tree-shaken import cost.
- Framework authors who need to measure real consumer fixtures across multiple environments.
- Teams that want PR-native summaries and checks.
- Teams that want public, linkable dashboards for public repositories.

## Core Domain Model

### Organization

- Connected through GitHub auth.
- Owns repositories and admin settings.

### Repository

- A GitHub repository connected to the platform.
- Public in V1.
- Can contain many scenarios.

### Scenario

The first-class measurement subject inside a repository.

A scenario represents a concrete way of consuming or building the codebase.

Examples:

- `minimal-react-app`
- `feature-set-a-fixture`
- `feature-set-b-fixture`
- `export-Foo-from-core`
- `export-everything-from-package`

This is the main abstraction that replaces the earlier flat profile idea.

### Scenario Kind

Scenarios come in different kinds.

#### Fixture-app

- A real app or example app in the repository.
- Best for measuring realistic framework behavior, code splitting, route splitting, and app-dependent transforms.
- Repository-defined only.

#### Synthetic-import

- A generated consumer entry such as `export { Foo } from "foo-lib"`.
- Best for measuring tree-shaken public API cost.
- Can be defined in the repository or in the hosted UI.

#### Built-output

- Measures the library's own emitted build artifacts.
- Useful and worth documenting, but secondary to runtime-impact scenarios.
- Best treated as optional or later-stage functionality.

### Environment

- A named Vite environment under a scenario.
- Must support arbitrary names.
- May optionally carry a classification such as client, server, edge, worker, or other.
- In the product model, an environment is a logical named output space, not a hard dependency on Vite's Environment API.
- In the V1 UI, the environment name itself should be the label. We should not force a richer taxonomy yet.

Examples:

- `client`
- `ssr`
- `edge`
- `workerd`
- `server`

In V1, environments should come from a single Vite build invocation.

- Native Vite Environment API builds are the primary multi-environment path.
- If Vite does not expose an environment name, the platform should fall back to a default logical environment name such as `default`.

### Entrypoint

- A concrete emitted entry within an environment.
- This is where several key metrics and comparisons should anchor.

### Measurement Lens

A named measurement semantic applied to an entrypoint or environment.

This is important because terms like `initial JS` are otherwise ambiguous.

The same scenario and entrypoint may expose multiple lenses, each with different semantics.

### Run

- A CI execution uploaded for a repo at a given commit, branch, and PR context.
- One build invocation produces one run for one scenario.

### Commit Group

- An internal commit-level grouping over many scenario runs for the same repository commit.
- Exists to power one maintained PR comment, one aggregate GitHub check, and repository-level summaries.
- Does not change the rule that one build invocation equals one scenario run.

### Snapshot

- The normalized bundle representation captured from a run.
- Includes emitted assets, graph relationships, compression sizes, and attribution data.

### Series

- The stable comparable subject used for trend lines and baselines.
- A series is effectively a stable combination of repository, scenario, environment, entrypoint, and lens.

## Scenario Kinds And Source Of Truth

### Fixture-app scenarios

- Must live in the repository.
- The platform should not try to host fixture app definitions in V1.
- Their code, configuration, and build semantics are too coupled to the repository itself.
- In V1, fixture-app scenarios should be declared through Vite plugin metadata inside the app plus the existing build target, script, or workflow that runs that app.
- A central root repo config should not be required for fixture-app scenarios in V1.

### Synthetic-import scenarios

- May live in the repository.
- May also live in the hosted UI.
- This enables maintainers to add quick import-cost checks without changing repository files.
- If versioned in the repository in V1, they should live in workflow YAML or action inputs rather than a mandatory central root config file.

Functional consequence:

- CI needs to resolve scenario definitions from both repository config and hosted configuration.
- In V1, "repository config" for synthetic-import scenarios can mean workflow YAML rather than a dedicated repo-level config file.

### Built-output scenarios

- Should be described in the product model.
- Should not dominate V1, because the primary focus is runtime impact.

## Measurement Strategies

The product should treat the following as distinct strategies, not just variants of one feature.

### Fixture-app measurement

- Build a real consumer app or example app.
- Best for realistic runtime shape.
- Best for app-dependent transforms, route splitting, framework plugins, and consumer-specific tree shaking.
- More expensive and more configuration-heavy.

### Synthetic-import measurement

- Generate a consumer entry and bundle it.
- Best for measuring public API cost and tree-shaking quality.
- Less representative when a library's runtime shape depends heavily on the host app.

### Built-output measurement

- Measure emitted library artifacts directly.
- Best for publish-oriented insight.
- Less representative of actual runtime impact in a consumer app.

## Vite-Specific Measurement Semantics

### Arbitrary environments

The product must assume that a scenario can expose many arbitrary named environments.

It should not hardcode `client`, `server`, or `edge` as the only valid options.

The product should not assume that repeated separate builds can be grouped into one scenario run in V1.

### Many asset kinds

The product must assume that an environment may emit:

- JS
- CSS
- HTML
- images
- fonts
- media
- workers
- server files
- edge files
- other static assets

### Manifest and graph data

Vite gives enough information to model:

- exact emitted entry chunks
- static import relationships
- dynamic import relationships
- CSS attached to chunks
- imported assets attached to chunks

This is sufficient for a meaningful build-time graph model.

## Measurement Lenses

### Default lens: Entry JS + Direct CSS

This should be the default library-facing lens.

Definitions:

- `Entry JS` means exactly the emitted JS entry chunk for the chosen entrypoint.
- `Direct CSS` means only CSS directly attached to that entrypoint according to Vite metadata or manifest relationships.
- No recursive static import closure is included.
- No dynamic import closure is included.

This lens is intentionally conservative and easy to explain.

### Opt-in lens: Network-initial closure

This should be available, but not the default.

Definitions:

- Start from a chosen emitted entrypoint.
- Recursively follow static import relationships.
- Include modulepreload-related dependencies where Vite's output semantics make them observable.
- Union all reachable JS, CSS, and relevant imported assets.
- Exclude dynamic import edges by default.

This lens should also store the build-time dependency graph so the UI can show waterfall structure.

Important note:

- This is a build-time graph and payload model.
- It is not a browser-observed timing waterfall.
- V1 should stay in the build-time graph world.

### Optional lens: Whole-output

- Measures all emitted assets for a scenario or environment.
- Useful for server, edge, or publish-oriented views.
- Not the main library-facing default.

## Snapshot Data Model

Each snapshot should store enough data for PR summaries, dashboards, diffs, treemaps, and graph analysis.

Required fields:

- repository identity
- scenario identity
- scenario kind
- scenario source of truth
- environment name
- optional environment classification
- entrypoint identity
- selected measurement lens
- bundler and bundler version
- framework or adapter metadata when available
- build timestamp and duration
- commit SHA, branch, PR number, and base branch when applicable
- full emitted asset list
- raw, gzip, and brotli sizes for assets where applicable
- asset kind and file type
- chunk relationships
- manifest relationships when available
- static import graph
- dynamic import graph
- build-time waterfall edges for the network-initial lens
- module attribution data when available
- package attribution data when available
- duplicate package and duplicate module data when available
- warnings for incomplete attribution, missing source maps, or partial output data

Important rule:

- Final emitted sizes and explanatory attribution must remain separate concepts.
- Module and package attribution explain where bytes likely came from.
- Final emitted asset sizes are the authoritative runtime-facing numbers.

Sourcemap note:

- Sourcemaps are not required for stable chunk or module identity.
- Rollup-style output metadata already exposes stable module IDs, chunk membership, import relationships, and per-module rendered lengths.
- Sourcemaps are still a useful optional enhancement for finer-grained attribution after transforms and minification.

## Stable Identity And Normalization

This remains one of the hardest product problems.

Required behavior:

- Normalize hashed asset filenames into stable logical identities when possible.
- Compare assets across commits even when filenames changed.
- Preserve grouping by scenario, environment, entrypoint, format, and asset kind.
- Detect likely rename versus true add or remove.
- Handle chunk split and merge cases well enough to avoid useless noisy diffs.
- Keep enough raw metadata so normalization can improve over time.

Practical guidance:

- Asset-level stable identity should rely first on manifest relationships, entrypoint associations, original file names, normalized output names, and graph context.
- Module-level stable identity should rely on stable module IDs from bundler output metadata.
- Sourcemaps should improve attribution quality, but should not be a prerequisite for the product to function.

Recommended V1 matching strategy:

- Entry and dynamic-entry continuity should rely on manifest key, `src`, and `facadeModuleId` before anything else.
- Module continuity should rely on stable module IDs.
- Shared non-entry chunk continuity should rely on module composition plus owner-entrypoint set.
- When continuity is ambiguous, the product should prefer explicit add or remove and split or merge states over aggressive continuity claims.

## Required Functionality

### 1. Onboarding And Auth

- GitHub App-based auth.
- Public repository onboarding in V1.
- Repository access control at minimum with admin and viewer roles.
- Repository setup flow for CI and PR integration.

### 2. Collection And Upload

- Vite-first plugin for collecting bundle metadata.
- GitHub Action for CI integration.
- Upload metadata should include commit, branch, PR, and CI context.
- GitHub App installation should be the trust anchor in V1.
- The normal GitHub Actions path should use short-lived repo-scoped upload credentials rather than long-lived manual secrets.
- The plugin should write a standard local result artifact.
- The GitHub Action should read that artifact and upload it.

Recommended V1 upload model:

- One build invocation equals one scenario run.
- Upload is owned by the GitHub Action in V1.
- There is no public `runId` in V1.
- There is no public uploader contract in V1.

### 3. Scenario Definition And Execution

- Support repository-defined fixture-app scenarios through existing build targets plus Vite plugin metadata.
- Support repository-defined synthetic-import scenarios through workflow YAML or action inputs in V1.
- Support hosted-UI-defined synthetic-import scenarios.
- If a synthetic-import scenario exists both in the repository and in the hosted UI, the repository definition takes precedence.
- Resolve all applicable scenarios during CI execution.
- Validate scenario definitions and surface configuration errors clearly.

Important V1 constraint:

- Do not require a central root repo config for fixture-app scenarios when the repository already has a working build topology.

### 4. Comparison And Baseline Selection

- PR baseline should use the latest successful comparable series on the base branch.
- Branch baseline should use the previous successful comparable series on the same branch.
- Arbitrary run-to-run comparison should be supported.
- Baselines must compare like-for-like series only.
- Missing baselines should be explained clearly.
- Initial baseline backfill should be supported.

### 5. GitHub Pull Request Workflow

- Post one maintained PR comment instead of spamming multiple comments.
- Summarize regressions and improvements by scenario.
- Include current, baseline, and delta values.
- Link to a focused compare page in the web app.
- Keep the PR comment links limited in V1; richer treemap and graph views should be reachable from the compare page rather than linked inline from GitHub.
- Stay readable when one repository has many scenarios.

### 6. GitHub Checks And Budget Gating

- Publish GitHub checks or statuses for relevant scenario results.
- Support informational, warning, and failing outcomes.
- Support branch protection on failures.
- Show exactly which scenario, entrypoint, lens, or metric failed.

### 7. Regression Acknowledgements

- Support per-metric acknowledgement on PRs in V1.
- The acknowledgement should be attached to a specific failing metric or diff item.
- The acknowledgement note or comment should be optional.
- Acknowledged regressions should stop blocking the PR while remaining visible.

### 8. Dashboards

#### Repository overview

- Show recent scenario health.
- Show recent regressions and improvements.
- Show currently failing budgets.

#### Scenario dashboard

- Show the latest results for a scenario across environments and entrypoints.
- Show the available lenses for each entrypoint.

#### Branch view

- Show the latest comparable results for a branch.
- Provide quick comparison to the previous successful branch run.
- In V1 this should live within repository and scenario history flows rather than as a separate top-level dashboard page.

#### Historical dashboard

- Plot series over time.
- Overlay arbitrary branches.
- Filter by scenario, environment, entrypoint, lens, and metric.

#### Diff dashboard

- Compare any two runs for the same series.
- Show totals, asset deltas, package deltas, and graph differences.

### 9. Metrics And Views

The product should support metrics beyond one total number.

Core metrics:

- entry JS
- direct CSS
- network-initial closure size
- raw size
- gzip size
- brotli size
- asset count
- chunk count
- package count
- duplicate package count

Useful secondary metrics:

- duplicate module count
- duplicate code ratio
- total size by file type
- whole-output size

The UI must make the semantic context explicit. Metrics should always be shown together with their lens definition.

### 10. Treemap And Composition Analysis

Treemap support is required.

Minimum functionality:

- render a treemap for a single snapshot
- drill down by asset, package, and module or path
- search within the visualization
- connect treemap nodes to diff tables

Over-time functionality:

- compare two snapshots even when chunk filenames changed
- show added, removed, grown, and shrunk nodes
- preserve enough identity to answer where source ended up after chunking changed

Recommended product shape:

- keep treemap evolution in 2D
- do not use 3D as the primary temporal representation
- prefer stable-layout diffing and frame-to-frame updates keyed by stable node identity
- allow a timeline scrubber or commit stepper instead of trying to encode time directly into the treemap plane

Relevant prior art:

- D3 `treemapResquarify` explicitly preserves topology across updates for animated treemaps
- Statoscope emphasizes stats comparison rather than introducing a new 3D temporal metaphor
- rollup-plugin-visualizer exposes `treemap-3d`, but 3D should be treated as optional exploration, not the core longitudinal UX

### 11. Build-time Graph And Waterfall Analysis

This is also required.

Minimum functionality:

- show static import graph
- show dynamic import edges separately
- show network-initial closure graph for the opt-in lens
- show dependency depth and fan-out
- show build-time waterfall structure derived from emitted graph relationships

This should remain a build-time graph feature in V1, not a browser timing feature.

### 12. Budget And Policy System

- Configure budgets per scenario, entrypoint, or lens.
- Support budgets on raw, gzip, and brotli values.
- Support budgets on asset groups and packages.
- Support absolute and percentage thresholds.
- Allow informational, warning, and failing policy actions.

For synthetic-import scenarios defined in the hosted UI:

- definitions are not versioned in V1
- definitions are not audited in V1
- definitions are not attributed to specific commits or users in V1

### 13. Reliability And Debuggability

- Show upload failures clearly.
- Show partial-data and degraded-comparison warnings clearly.
- Explain why a metric is missing.
- Allow reruns and reprocessing after configuration changes.
- Preserve raw metadata for future reanalysis.

## Suggested V1 Scope

The first release should include:

- public GitHub repositories only
- public dashboards
- GitHub App auth and repo onboarding
- Vite plugin
- GitHub Action upload flow
- scenario-first model
- fixture-app scenarios from existing build targets plus Vite plugin metadata
- synthetic-import scenarios from workflow YAML or hosted UI
- arbitrary named environments
- multiple entrypoints per environment
- default `Entry JS + Direct CSS` lens
- opt-in `Network-initial closure` lens
- build-time graph and waterfall views
- raw, gzip, and brotli metrics
- PR comments and GitHub checks
- per-metric PR acknowledgements
- repository, scenario, branch, history, and diff dashboards
- treemap and composition diff views
- budgets on scenario, entrypoint, lens, package, and asset groups
- baseline backfill
- no mandatory central root repo config for fixture-app scenarios

## Not V1 By Default

- private repositories
- non-Vite bundlers beyond future-proofing
- built-output scenarios
- repeated separate-build grouping into one scenario run
- public uploader or standalone upload CLI
- browser-observed waterfalls
- real runtime download, parse, or execute timings
- AI setup wizard that opens PRs automatically
- Slack and external metrics forwarding integrations

## Open Questions

1. If repo-defined synthetic-import scenarios outgrow workflow YAML, what should the future dedicated repo config format be?
2. When should sourcemap-enhanced attribution become worth the extra build and storage cost?

## Research References

- CodSpeed
- RelativeCI
- Codecov Bundle Analysis
- Size Limit
- bundlejs
- Bundlephobia
- pkg-size
- rollup-plugin-visualizer
- source-map-explorer
- statoscope
- Lighthouse CI
- Vite manifest and output metadata
- Vite Environment API
