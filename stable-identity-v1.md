# Stable Identity V1 Design

## Summary

This document records the current V1 design for stable identity in the bundle evolution product.

The goal is to make bundle history comparable over time even when emitted filenames, chunk groupings, CSS extraction, and output layout change.

This is the algorithm and logical-model design, not the final product-facing artifact schema or storage model.

The current design is validated by the research lab under `research/stable-identity/` using real Vite apps, stored artifacts, and regression expectations.

Core outcome:

- V1 stable identity does not require sourcemaps.
- Matching is conservative by default.
- Continuity is defined separately for entries, modules, packages, shared chunks, CSS, assets, and treemap nodes.
- The matcher supports `same`, `split`, `merge`, `ambiguous`, `added`, and `removed` relations.
- Treemap updates key on logical identity, not emitted hashed filenames.

## Scope

This design is for V1 bundle comparison inside a like-for-like comparison frame.

The matcher assumes the comparison is already partitioned by:

- repository
- scenario
- environment

Important V1 rule:

- Stable identity is not defined across environments.
- Environment is an outer partition key.
- A `client` snapshot is compared to a `client` snapshot, not to `ssr`.
- V1 does not introduce a separate public `build kind` or `format` partition key inside the matcher.
- If incompatible outputs need separate continuity frames in V1, they must already be separated as distinct environments or entrypoints before matching begins.

This stays aligned with the existing V1 direction:

- scenario-first
- Vite-first
- one build invocation equals one scenario run
- repeated separate-build grouping is out of public V1

## Goals

Required V1 behavior:

- preserve entry and dynamic-entry continuity across hash churn
- preserve module continuity across commits
- match shared non-entry chunks conservatively
- detect real split and merge cases
- represent uncertain lineage explicitly instead of forcing a wrong match
- preserve enough identity to support stable treemap diffing
- keep enough raw evidence so normalization can improve later

## Non-Goals

These are intentionally out of scope for the V1 stable-identity design:

- sourcemap-required attribution
- fuzzy rename matching for arbitrary moved modules with no graph evidence
- cross-environment continuity
- repeated separate-build grouping into one public scenario run
- inferring continuity from emitted hashed filenames alone
- aggressive content-similarity matching that risks false positives

## Required Raw Evidence

The matcher relies on Rollup and Vite output metadata captured at build time.

Required evidence:

- emitted chunks and assets
- chunk `fileName`
- `isEntry`
- `isDynamicEntry`
- `facadeModuleId`
- static imports and dynamic imports
- per-chunk module membership
- per-module `renderedLength`
- Vite manifest entries when available
- Vite `importedCss`
- Vite `importedAssets`
- asset `originalFileNames` when available

Important rule:

- Raw evidence should be preserved separately from normalized identities.
- Normalization is a derived layer, not the source of truth.

## Normalization

### Module IDs

Module continuity is rooted in normalized stable module IDs.

Normalization rules:

- convert Windows separators to `/`
- strip machine-specific absolute prefixes when the path is inside the captured `build.rootDir`
- preserve relative app paths like `src/routes/overview.js`
- normalize `node_modules` paths into package-prefixed stable IDs such as `pkg:react` or `pkg:react-dom/client`
- preserve virtual modules as `virtual:<id>`

Synthetic-import entry rule:

- V1 synthetic-import scenarios should prefer a stable generated on-disk entry module path over an ephemeral virtual entry id
- when that rule is followed, the synthetic entry normalizes like any other app module path under the captured build root

Result:

- app modules, package modules, and virtual modules each have stable normalized IDs suitable for continuity and treemap keying

### Output Labels

Hashed output filenames are not treated as stable identity.

They are only used as weak supporting evidence through normalized output labels such as:

- `renderPanel.js`
- `renderPanel.css`
- `surface.svg`

These labels are never the primary identity signal.

## Relation Model

The matcher emits one of these relations per logical comparison unit:

- `same`
- `split`
- `merge`
- `ambiguous`
- `added`
- `removed`

Confidence levels:

- `exact`
- `strong`
- `low`

Meaning:

- `exact` means the primary identity evidence is explicit and unambiguous
- `strong` means the match is derived but well-supported
- `low` means the continuity is the best conservative interpretation but still degraded
- `ambiguous` means there is meaningful overlap but not enough evidence to claim `same`, `split`, or `merge`

## Identity Rules By Entity

### Entries And Dynamic Entries

Primary identity rules:

- manifest key first
- then manifest `src`
- then `facadeModuleId`

Entry continuity should rely on exact source identity before anything else.

Implications:

- hash churn is ignored
- output layout changes like `assets/` to `entries/` do not matter
- route renames are treated as real add/remove unless a stable entry identity still exists

### Modules

Module continuity is defined by normalized stable module ID.

Rules:

- if the stable module ID is the same, the module is the same logical module
- if the source path changes, module continuity is not assumed in V1

Implication:

- moved or renamed source files degrade unless some higher-level chunk, CSS, or asset continuity can still be justified conservatively

### Packages

Package continuity is derived from normalized package module IDs.

Rules:

- package nodes are keyed by package name
- package size is the aggregate rendered size of modules in that package

Implication:

- package treemap nodes remain stable even if package code moves across emitted chunks

### Shared Non-Entry JS Chunks

Shared chunk continuity is based on two primary signals:

- owner-entrypoint context
- weighted module composition

#### Owner-entrypoint context

For each chunk, derive an owner-entry set by traversing chunk imports and dynamic imports from every entry and dynamic entry.

This owner set is part of chunk identity and prevents unrelated shared chunks from matching only because they have similar shapes.

#### Weighted module composition

For each chunk, compare module overlap weighted by `renderedLength`.

This gives byte-aware overlap instead of treating every module equally.

#### One-to-one continuity

Claim `same` only when:

- module overlap is strong enough
- owner context is compatible
- the candidate is clearly better than the runner-up

#### Split detection

Claim `split` when:

- one old shared chunk is not a safe one-to-one match
- two or more unmatched new chunks together explain almost all of the old chunk’s weighted module bytes

#### Merge detection

Claim `merge` symmetrically when:

- two or more old shared chunks together explain almost all of one new chunk’s weighted module bytes

#### Ambiguous detection

Claim `ambiguous` when:

- meaningful overlap exists
- no one-to-one match is strong enough
- split or merge evidence is not complete enough

This is intentionally preferred over fake continuity.

#### Conservative move fallback

V1 includes a limited fallback for shared chunks whose source module IDs changed because the underlying helper file moved or was renamed.

This fallback is allowed only when all of these are true:

- owner-entry context still overlaps strongly
- normalized output role is still uniquely aligned, such as `renderPanel.js`
- total rendered size and module count remain close
- the candidate is unique in both directions

This fallback is deliberately narrow.

### CSS Assets

CSS continuity uses two different strategies depending on the CSS kind.

#### Entry CSS

For entry CSS, continuity follows stable entry identity first.

Strong evidence:

- manifest `src`
- manifest file linkage
- importer entry continuity

#### Shared generated CSS

Generated shared CSS often lacks a stable source path.

For this case, continuity follows importer-lineage context:

- already-matched shared JS chunks
- importer file continuity
- owner-entrypoint context
- normalized emitted role like `renderPanel.css` as weak support only

This supports:

- same
- split
- merge

and prevents generated CSS from collapsing into add/remove noise when extraction topology changes.

### Static Assets

Static assets use this evidence order:

- stable source path or `originalFileNames` first
- importer-lineage context second
- normalized basename or output role as weak support only

Conservative move fallback is allowed when:

- importer lineage is uniquely aligned
- owner-entry context still overlaps strongly
- emitted role and size remain very similar

If those conditions are not met, V1 prefers `added` and `removed`.

### Treemap Nodes

Treemap diffing is not keyed directly on emitted files.

Treemap node rules:

- module nodes use `module:<stableModuleId>`
- package nodes use `package:<packageName>`
- shared chunk diff nodes use lineage keys derived from owner-entry context plus module composition
- shared generated CSS diff nodes use lineage keys derived from importer continuity and owner context when no stable source path exists
- static assets prefer `asset:<sourcePath>` and only fall back to lineage keys if required

This is the key design choice that keeps treemap evolution stable in 2D over time.

## Matching Algorithm

### 1. Analyze one snapshot

For every snapshot:

- normalize module IDs
- derive owner-entry sets for chunks
- derive per-chunk weighted module maps
- derive importer information for CSS and static assets

### 2. Match entries and dynamic entries

Use exact source identity:

- manifest key
- manifest `src`
- `facadeModuleId`

### 3. Match shared JS chunks

Use weighted module overlap plus owner-entry context.

Order of operations:

1. detect high-confidence split
2. detect high-confidence merge
3. detect safe one-to-one `same`
4. detect degraded `ambiguous`
5. apply narrow move fallback only when uniquely supported
6. otherwise emit `added` and `removed`

Important V1 rule:

- never collapse a real split or merge into a fake rename

### 4. Match CSS and assets

Use exact source continuity first, then importer-lineage continuity.

Order of operations:

1. exact source-path match when available
2. split or merge via importer-lineage coverage
3. unique one-to-one fallback with strong importer evidence
4. otherwise emit `added` and `removed`

## Degraded Behavior

The product should remain conservative when evidence is incomplete.

V1 degraded rules:

- prefer `ambiguous` over an unsupported `same`
- prefer `added` and `removed` over a risky fuzzy match
- keep evidence with every derived relation
- do not infer module continuity from content alone when source identity changed

This is the most important product-safety rule in the design.

The failure mode we are avoiding is a pleasant-looking but false historical story.

## Treemap Diff Contract

Treemap support is required in V1, and the treemap should survive chunk churn.

The stable treemap contract is:

- frame-to-frame treemap updates key on logical node identity
- lower-level nodes like modules and packages are more stable than chunk nodes and should remain stable even if chunk grouping changes
- chunk-level instability must not destroy package and module continuity
- shared chunk and shared CSS diff nodes can be represented as lineage nodes with `same`, `split`, `merge`, or `ambiguous` state

Recommended UI implication:

- use stable keyed updates with D3 `treemapResquarify` or equivalent stable-layout behavior
- keep temporal evolution in 2D with a compare view or scrubber, not a 3D treemap

## Validated Research Corpus

The current design is validated by real Vite fixture apps in `research/stable-identity/apps/`.

Current families:

- `react-routes`
- `multi-entry-manifest`
- `css-assets`
- `client-ssr`
- `ambiguous-shared`
- `auto-chunk-routes`
- `rename-moves`

These corpora cover:

- entry continuity
- dynamic-entry continuity
- shared JS split and merge
- shared CSS split and merge
- explicit degraded `ambiguous` states
- output-layout changes
- natural Rollup chunking with no `manualChunks`
- client and SSR environment-specific continuity
- route rename add/remove behavior
- shared helper move fallback behavior
- static asset path-move fallback behavior

Regression commands:

```bash
pnpm stable-identity:test
pnpm stable-identity:refresh
```

## Practical V1 Decisions

The current V1 design decisions are:

- Sourcemaps are optional, not required.
- Entries and dynamic entries match by manifest/source identity first.
- Modules match by normalized stable module ID.
- Packages aggregate by normalized package identity.
- Shared non-entry chunks match by owner-entry context plus weighted module composition.
- Generated shared CSS follows importer lineage when no stable source path exists.
- Static assets prefer source path and fall back conservatively to importer lineage.
- Treemap diff keys are logical identities, not emitted hashed filenames.
- Ambiguity is a first-class output state.

## Explicit V1 Limits

This design intentionally does not claim more than the evidence supports.

Known V1 limits:

- arbitrary moved modules without graph support are not matched
- renamed helpers with no stable role signal degrade to add/remove
- renamed generated CSS or assets without stable importer context degrade to add/remove
- the design assumes comparison already happens inside a like-for-like series

These are acceptable V1 boundaries because they protect the product from false continuity.

## Improvement Paths

If we want the stable-identity system to match more often without increasing false positives, the right next step is not to lower thresholds blindly.

The right strategy is to add new independent evidence so the matcher can make more exact or strong continuity claims safely.

Best next steps:

- Add exact content hashes for static assets.
- Add normalized CSS fingerprints for generated CSS after stripping unstable rewritten details like emitted asset URLs.
- Capture module graph neighborhood in the artifact, including importer sets, import sets, and export shape when available.
- Add a strict module-move detector that only promotes continuity when graph neighborhood, size, and export shape remain uniquely aligned.
- Add shared-chunk role signatures beyond module overlap, such as reachable facade set, importer profile, imported CSS and assets profile, and package composition profile.
- Let chunk, CSS, and asset fallback logic combine several weak signals together instead of relying too heavily on any one weak signal.
- Add optional sourcemap-assisted matching as an enhancement path, while keeping sourcemaps out of the required V1 contract.
- Expand the fixture corpus with harder real-world move and rename cases.

Recommended implementation order:

1. asset content hashes
2. normalized CSS fingerprints
3. module graph capture in the artifact
4. safe module-move detection
5. richer shared-chunk role signatures
6. corpus expansion and threshold tuning

Likely highest-value wins:

- moved helpers that keep the same graph role
- renamed SVG and image assets with unchanged bytes
- moved shared CSS with stable importer lineage
- shared chunks whose module paths changed but whose package and owner context stayed stable

## Draft: Squash Merge Bridging

This section is a draft, untested idea.

It is not part of the current validated V1 stable-identity design.
It is a possible future solution for preserving graceful continuity when a long-lived feature branch is squash-merged into `main`.

### Problem

On a feature branch, the matcher can often track chunk evolution cleanly from one small commit to the next.

After a squash merge, that same work may appear on `main` as one large commit.
If stable identity is computed only by comparing `main_before` to `main_after`, continuity may degrade because the system no longer sees the small intermediate steps that existed on the feature branch.

### Draft idea

Decouple:

- the baseline used for metric comparison
- the anchor used for stable identity continuity

In this model:

- the previous successful `main` run is still the metric baseline for answering what changed on `main`
- the latest matching PR head or PR merge-ref run becomes the identity anchor for answering what this chunk or asset is the same as

### Proposed flow

1. Store normal bundle runs for the PR as the branch evolves.
2. Ideally also store a run for the GitHub PR merge ref.
3. When the squash-merged commit lands on `main`, detect the associated PR through GitHub metadata.
4. Look up the latest successful PR head or merge-ref run.
5. If the resulting `main` tree matches that PR run closely enough, inherit stable identities from the PR lineage instead of recomputing identity only from `main_before -> main_after`.
6. Still use `main_before -> main_after` as the metric baseline diff.

### Core idea

The key separation is:

- metric baseline answers: what changed on `main`
- identity anchor answers: what is this logically the same as

That lets a squash-merged `main` commit inherit the lineage already discovered gradually on the PR branch.

### Why this could work

- squash merge destroys commit topology, but usually not the resulting tree content
- the hard continuity work has already been observed incrementally on the PR branch
- a later `main` run can reuse that lineage instead of starting from scratch

### Draft matching order

For a new `main` run after squash merge, a future system could try identity anchoring in this order:

1. exact tree match to the PR merge-ref run
2. exact tree match to the PR head run
3. near-exact artifact fingerprint match
4. composed lineage through prior PR runs
5. only then fallback to direct `main_before -> main_after` identity matching

### Data this would likely need

- commit SHA
- tree SHA if available
- PR number
- branch
- base SHA or merge base
- enough artifact fingerprinting to detect near-exact equivalence
- persistent canonical lineage IDs, not only pairwise matches

### Important caveats

- this is not validated by the current research lab
- this would need architecture work as well as stable-identity work
- this may interact with the current V1 boundary that repeated separate-build grouping is out of scope for the public contract
- this should not be used as a reason to weaken normal conservative matching thresholds

### Current status

Treat this as a promising future direction, not an adopted part of the V1 design.

## Follow-On Work

Stable identity is no longer a major technical unknown, but follow-on work remains:

- map this design onto the final plugin artifact contract
- map this design onto the normalization and derived-data stages in the broader architecture
- encode degraded warnings and evidence clearly in product UX
- decide how much lineage evidence should be stored versus recomputed

Those are architecture and artifact-contract tasks, not remaining core algorithm uncertainty.
