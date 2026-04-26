# User-Configurable Lenses

## Summary

- The product should stay scoped to lenses that can be answered from Vite build output.
- Runtime, route-behavior, interaction, above-the-fold, coverage, and code-owner/team lenses are out of scope.
- Users should be able to configure lenses from the web UI without writing code.
- A lens should become a declarative query over normalized bundle graph facts, not hard-coded derivation logic for one stored total.
- Default lenses should remain product-owned, versioned, and available to every repository.
- Repository lenses should be user-owned presets built from allowed lens primitives.
- The pipeline should upload raw build graph evidence, normalize and tag it, materialize configured lens results, and query those materialized results for fast product pages.

## Current State

Today `lens` is already a first-class product dimension, but only one lens is implemented:

- `entry-js-direct-css`

That lens counts:

- selected entry JavaScript chunk
- CSS directly imported by that entrypoint

The current database shape stores `lens` on `series`, and a series is effectively keyed by:

```txt
repository + scenario + environment + entrypoint + lens
```

The current derivation path computes one measurement per entrypoint and writes precomputed totals into `series_points`:

```txt
entry_js_*_bytes
direct_css_*_bytes
total_*_bytes
```

This is good enough for one hard-coded lens, but it is not enough for user-configurable lenses. A user-configurable lens needs reusable graph facts and a lens engine that can evaluate different counting rules against the same normalized snapshot.

## Scope

The lens system should only support questions that Vite build output can answer reliably.

In scope:

- entry chunk counting
- direct CSS counting
- static import traversal
- dynamic import traversal
- all reachable chunk traversal
- JS-only filtering
- CSS-only filtering
- emitted asset filtering
- full environment output counting
- shared chunk handling
- unique-only counting
- proportional shared counting
- large-file threshold filters

Out of scope:

- route critical path unless users explicitly map routes to entrypoints or chunks
- interaction path
- above-the-fold bytes
- runtime coverage or used-code-only bytes
- browser performance data
- code owner or team lenses unless a separate metadata source is added later
- package/vendor/app lenses for the initial custom-lens release
- duplicate-module and changed-module lenses for the initial custom-lens release
- arbitrary custom code execution inside lens definitions

Medium-confidence lenses should not be part of the initial user-configurable product. Package, app/vendor, duplicate-module, and changed-module lenses can be reconsidered later only if normalization proves reliable in real repositories. The first version should prefer fewer primitives with predictable semantics over many approximate lenses.

## Product Model

The product should have two kinds of lenses.

### Default Lenses

Default lenses are maintained by the product and available to all repositories.

Candidate defaults:

- `entry-js-only`
- `entry-js-direct-css`
- `initial-static-js-css`
- `all-reachable-js-css`
- `js-only-all-reachable`
- `css-only-all-reachable`
- `full-output`
- `unique-only`
- `shared-proportional`

Default lenses should be versioned. A semantic change should create a new lens version or migration path rather than silently changing historical meaning.

### Repository Lenses

Repository lenses are user-created in the web UI.

They should be configured from safe primitives rather than code:

- name
- description
- starting point
- traversal mode
- included file kinds
- included chunk kinds
- asset filters
- module scope filters
- shared byte mode
- optional size threshold
- optional package include or exclude list

The UI should present these as choices, not as SQL, JavaScript, or regular expressions by default.

Example repository lens:

```txt
Name: Initial app JS only
Start: selected entrypoint
Traversal: static imports
Include: JavaScript chunks
Exclude: CSS and assets
Shared mode: full
```

Another example:

```txt
Name: Vendor reachable bytes
Start: selected entrypoint
Traversal: all reachable imports
Include: JavaScript chunks
Module scope: package
Shared mode: proportional
```

## Lens Definition Shape

A lens definition should be declarative and validated.

Possible shape:

```ts
type LensDefinition = {
  id: string
  repositoryId: string | null
  name: string
  description: string
  version: number
  enabled: boolean
  start: "selected-entrypoint" | "environment"
  traversal: "direct" | "static" | "dynamic" | "all-reachable" | "all-output"
  includeKinds: Array<"js" | "css" | "asset">
  chunkKinds: Array<"entry" | "dynamic-entry" | "shared" | "non-entry">
  moduleScopes: Array<"app" | "package" | "virtual" | "other">
  sharedMode: "full" | "proportional" | "unique-only" | "separate"
  packageFilters: Array<{ mode: "include" | "exclude"; packageName: string }>
  minimumBytes: number | null
}
```

The exact schema can be smaller for the first release. The important point is that each field maps to a known graph operation.

## Uploading Data

The Vite plugin should continue uploading a versioned artifact per scenario run, but the artifact should be treated as raw graph evidence, not as final measurement output.

Required upload data:

- environments
- Vite manifest entries
- entrypoints
- emitted chunks
- emitted assets
- chunk sizes in raw, gzip, and brotli
- asset sizes in raw, gzip, and brotli
- static import edges
- dynamic import edges
- implicit load edges
- chunk to imported CSS relations
- chunk to imported asset relations
- chunk module membership
- module rendered length
- module original length when available
- facade module ids
- enough root path information to normalize module ids

The current artifact already captures much of this. The upload contract should evolve toward preserving enough graph detail to evaluate future lenses without rerunning the build.

The plugin should not upload browser runtime data, route traces, coverage, or code ownership data as part of the core product scope.

## Normalizing And Tagging Data

Normalization should transform the raw artifact into canonical graph facts.

Core normalized facts:

- environment
- entrypoint
- item
- edge
- module
- package
- item size

Items should represent countable bundle units:

- JavaScript chunk
- CSS asset
- non-CSS asset
- module when module-level attribution is available
- package aggregate when package-level attribution is materialized

Edges should represent relationships:

- entrypoint to chunk
- chunk to statically imported chunk
- chunk to dynamically imported chunk
- chunk to implicitly loaded chunk
- chunk to CSS asset
- chunk to emitted asset
- chunk to module
- module to package

Tags should be deterministic and derived from normalized data:

- `kind: js | css | asset`
- `chunkKind: entry | dynamic-entry | shared | non-entry`
- `moduleScope: app | package | virtual | other`
- `packageName`
- `entrypointOwnerCount`
- `reachableFromEntrypoints`
- `isDirect`
- `isStaticReachable`
- `isDynamicReachable`
- `isShared`
- `isUniqueToEntrypoint`

Tagging should be conservative. If a tag cannot be derived reliably, the lens engine should either exclude that primitive from user configuration or mark the result as degraded.

## Materializing Data

The product should not compute every lens on every page request.

Instead, after normalization, the server should materialize lens results for:

- all enabled default lenses
- all enabled repository lenses
- each scenario run
- each environment
- each entrypoint where the lens applies

Materialized lens results should include:

- repository id
- scenario run id
- scenario id
- environment
- entrypoint key
- entrypoint kind
- lens id
- lens version
- raw total bytes
- gzip total bytes
- brotli total bytes
- selected item count
- degraded state
- warning summary
- optional selected item evidence pointer

The existing `series` and `series_points` tables can remain as the public read-model boundary, but they should become materialized lens outputs rather than the only measurement source.

A separate table or object-store payload should retain selected item evidence for detail pages:

```txt
lens_result_items
```

or:

```txt
lens-result-items/{scenarioRunId}/{lensId}/{environment}/{entrypoint}.json
```

This evidence should explain why each item counted.

## Querying Data

Overview, history, compare, policies, and GitHub rendering should continue reading materialized series and comparison data.

Query path for normal pages:

```txt
selected repository
selected branch or commit
selected scenario/env/entrypoint/lens
materialized series point
materialized comparison
```

Query path for detail pages:

```txt
selected materialized lens result
load selected item evidence
show chunks/assets/modules/packages and reasons
```

This keeps common pages fast while still allowing the user to inspect what a lens counted.

## Building Lenses

The codebase should introduce a lens engine.

The lens engine should take:

- normalized environment graph
- selected entrypoint
- lens definition
- selected size metric only for display, not selection

The lens engine should return:

- selected items
- attribution weights
- total raw/gzip/brotli bytes
- warnings
- explanation strings

The engine should be built from a small set of operations:

- resolve start nodes
- traverse graph
- collect related CSS and assets
- filter by item kind
- filter by module scope
- filter by package
- compute ownership and sharing
- apply shared byte mode
- apply thresholds
- sum byte totals
- emit evidence

The engine should be deterministic. The same normalized snapshot and same lens definition version must always produce the same result.

## User Interface

The web UI should expose lens configuration as a guided form.

Recommended fields:

- lens name
- description
- start from selected entrypoint or whole output
- traversal mode
- include JavaScript
- include CSS
- include other assets
- module scope filter
- package include or exclude list
- shared byte handling
- minimum item size
- preview against a recent scenario run

The preview is important. Users should see:

- total size for a sample output
- selected item count
- top selected items
- excluded categories
- warnings or degraded states

The UI should prevent invalid combinations instead of allowing a lens that produces confusing results.

Examples:

- `all-output` should not require a selected entrypoint traversal.
- `package` scope filters should be disabled if package inference is unavailable.
- `proportional` shared mode should explain how ownership is computed.

## Refactoring Required

### Contracts

- Add a persisted lens definition schema separate from the current static `lensRegistry` schema.
- Distinguish product default lenses from repository-configured lenses.
- Add lens versioning to materialized results.
- Add schemas for lens result evidence and degraded lens states.
- Keep route search params using `lens`, but make the id resolve through default or repository lens definitions.

### Plugin Artifact

- Confirm the artifact includes all graph facts needed for in-scope lenses.
- Add missing fields only when Vite exposes them reliably.
- Avoid adding runtime or browser-observed data to the core artifact.
- Preserve raw graph evidence in object storage as the reprocessing boundary.

### Normalization

- Normalize the uploaded artifact into a graph model that can support multiple lens evaluations.
- Persist or materialize deterministic tags for items, edges, modules, packages, and ownership.
- Track degraded normalization when module scope or package inference is uncertain.

### Derivation

- Replace `buildSeriesMeasurements()` as the source of hard-coded lens totals.
- Introduce `materializeLensResults()` that evaluates all enabled lenses for a scenario run.
- Create or update `series` rows for each materialized lens output.
- Create or update `series_points` rows from lens result totals.
- Store selected item evidence separately from totals.

### Comparisons

- Keep comparison keyed by series so existing compare behavior continues to work.
- Include lens version in comparison metadata or ensure comparisons only pair compatible lens versions.
- Rebuild comparison item details from selected lens evidence rather than assuming one total shape.
- Surface degraded lens states when a lens cannot be evaluated consistently for base and head.

### Policies

- Allow policies to target default or repository lenses.
- Decide what happens when a repository lens used by a policy is edited, disabled, or deleted.
- Prefer immutable lens versions so existing policy results remain explainable.

### UI

- Add repository lens management under settings.
- Add create, edit, disable, duplicate, and preview flows.
- Add lens availability and degraded-state messaging to overview, scenario, history, and compare pages.
- Keep default lenses visible even if no custom lenses exist.

### Backfill And Reprocessing

- Since pre-existing measurements are not required, initial implementation can apply only to new uploads.
- Later, if normalized snapshots are available, a reprocess job can materialize newly created lenses for older scenario runs.
- Reprocessing should be explicit and asynchronous because a new lens can multiply the number of series points and comparisons.

## Initial Implementation Plan

1. Define the declarative lens schema with a minimal set of primitives.
2. Add default lens definitions using the new schema.
3. Build a lens engine over the existing normalized snapshot shape.
4. Make the current `entry-js-direct-css` result come from the lens engine.
5. Materialize enabled default lens results into existing `series` and `series_points` tables.
6. Add selected item evidence storage for detail pages.
7. Add repository lens CRUD and preview UI.
8. Materialize repository lenses for new scenario runs.
9. Update compare and policy flows to understand lens versions and degraded states.

## Open Decisions

- Should editing a repository lens mutate the current lens or create a new version?
- Should disabled lenses remain selectable for historical data?
- Should repository lenses be materialized for every scenario run automatically or only after first use?
- How many default lenses should ship before custom lenses are exposed?
- Should package and app/vendor filters be included in the first custom-lens release or deferred until package inference is proven reliable?
- Where should selected item evidence live: database rows or object-store JSON?
- How much selected item evidence should be retained for old scenario runs?

## Recommended First Cut

The first cut should support only highly reliable Vite-derived lens primitives:

- start from selected entrypoint
- direct traversal
- static traversal
- dynamic traversal
- all reachable traversal
- all output traversal
- include JS chunks
- include CSS assets
- include other emitted assets
- shared mode `full`
- shared mode `unique-only`
- shared mode `proportional`

Defer package, app/vendor, duplicate module, and changed-module lenses until the graph-backed materialization system is working and the reliability of module and package normalization is proven in real repositories.
