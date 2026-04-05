# Architecture V1

## Summary

- The Vite plugin writes a local artifact.
- The GitHub Action uploads that artifact.
- One build invocation produces one scenario run.
- The platform adds an internal commit-group layer above scenario runs so one repository commit can power one maintained PR comment, one aggregate GitHub check, and repository-level dashboards.
- Raw uploads, normalized snapshots, and derived views are separate layers.
- Upload stays fast and synchronous. Normalization, comparison, budget evaluation, and GitHub publication happen asynchronously.
- PR comments, GitHub checks, and dashboards read from the same derived comparison objects.
- Acknowledgements attach to a single PR diff item only.
- Sparse commit groups are allowed in V1. Skipped scenarios may inherit the latest successful comparable result for completeness, but only as informational state.
- History remains fresh-only. Inherited results do not become normal series datapoints.

## Goals

This document resolves the V1 architecture questions around:

- ingestion from uploaded artifact to persisted run data
- normalization and derivation stages
- baseline and comparison computation
- where acknowledgements live
- how GitHub surfaces and dashboards share the same underlying data
- how raw snapshot data, derived series, and diff views relate

## Core Entity Model

### Repository

- The connected GitHub repository.
- Owns scenarios, commit groups, runs, comparisons, acknowledgements, and dashboards.

### Scenario Catalog

- The repository's known active scenarios.
- Entries are created when a scenario is first seen in a successful upload, or when a hosted synthetic-import scenario is defined.
- The catalog is the source for what scenarios are expected when a commit group is summarized.
- Scenarios remain expected until manually archived.
- V1 does not auto-retire scenarios.

### Commit Group

- Internal parent record for all scenario runs observed for the same repository commit.
- Stores commit SHA plus the branch and PR contexts seen from uploads.
- Exists to power commit-level summaries and GitHub surfaces.
- Is not a public upload-finalization protocol.
- Does not change the rule that one build invocation equals one scenario run.

### Scenario Run

- One uploaded result for one scenario from one build invocation.
- Carries scenario identity, source-of-truth kind, CI metadata, upload metadata, and processing state.
- A commit group may contain many scenario runs.

### Raw Artifact

- Immutable persisted copy of the uploaded plugin artifact.
- Raw evidence remains separate from normalized identities and derived outputs.
- This is the reprocessing boundary.

### Normalized Snapshot

- Canonical product-shaped representation derived from one raw artifact.
- Stores normalized environments, entrypoints, assets, chunks, modules, packages, graph edges, and warnings.
- Keeps raw evidence references so normalization can improve later without losing the original source.

### Lens Measurement

- One run-specific measurement for one normalized `scenario + environment + entrypoint + lens` subject.
- Stores metric totals, asset sets, graph payloads, and links to deeper diff and treemap inputs.

### Series

- Stable comparable subject keyed by:
  - repository
  - scenario
  - environment
  - entrypoint
  - lens
- Used for baseline lookup, trend lines, and arbitrary comparisons.

### Comparison

- Derived relation between two comparable lens measurements.
- Stores current, baseline, delta, budget outcomes, stable-identity relations, and diff-oriented read models.

### Budget Result

- Derived policy outcome for one comparison item.
- Feeds GitHub checks, PR summaries, and dashboard alerting.

### Acknowledgement

- V1 acknowledgement attached to one PR diff item only.
- References a specific PR comparison plus the failing metric or diff item.
- Optional note.
- Stops that PR item from blocking while staying visible.

## Data Layers

### Raw Layer

Store the upload exactly enough to reprocess later.

Includes:

- uploaded artifact payload
- upload metadata and processing metadata
- commit, branch, and PR context
- scenario and scenario-kind identity
- emitted asset list and output metadata
- manifest and Vite relationship data when available
- module membership and rendered lengths
- static and dynamic import edges
- warnings about missing or partial evidence

### Normalized Layer

Store the canonical product model for one scenario run.

Includes:

- normalized scenario, environment, entrypoint, and lens partitions
- normalized module IDs and package IDs
- normalized output labels and roles
- canonical asset, chunk, module, package, and graph records
- owner-entry and importer-lineage inputs needed for stable identity
- normalized warning and degraded-state records

### Derived Layer

Store reusable comparison and presentation outputs.

Includes:

- stable identity relations and evidence
- lens measurements
- series records
- baseline selections
- current/baseline/delta comparisons
- budget evaluations
- commit-group summary state
- PR comment and GitHub check read models
- treemap and graph diff nodes
- acknowledgement overlays

Important rule:

- Raw is the source of truth.
- Normalized is a derived canonical model.
- Derived data is disposable and re-computable.

## Processing Pipeline

### 1. Collection

- The plugin inspects the Vite build and writes a local artifact.
- The Action uploads the artifact with GitHub and CI context.

### 2. Ingest

Synchronous responsibilities:

- authenticate the upload
- validate artifact schema and required metadata
- persist the raw artifact immutably
- create or attach the scenario run
- create or attach the commit group
- mark processing as queued
- optionally publish a pending aggregate check

The synchronous ingest path should stay lightweight.

### 3. Normalize

Asynchronous worker responsibilities:

- parse the raw artifact
- normalize environments and entrypoints
- normalize module, package, asset, and chunk identities
- build canonical graph records
- record degraded states and validation warnings

### 4. Derive Stable Identity

Asynchronous worker responsibilities:

- apply `stable-identity-v1.md`
- derive chunk, CSS, asset, package, and module continuity
- keep explicit evidence and degraded states

### 5. Derive Measurements And Series

Asynchronous worker responsibilities:

- materialize lens measurements
- assign or create stable series keys
- update fresh series history for this run

### 6. Materialize Comparisons

V1 uses a hybrid strategy:

- precompute PR comparisons after ingest when PR context exists
- precompute branch comparisons after ingest for same-branch history
- compute arbitrary run-to-run comparisons on demand

### 7. Publish Read Models

Asynchronous worker responsibilities:

- update commit-group summary state
- update one maintained PR comment
- update one aggregate GitHub check
- update dashboard read models

## Commit Groups And Sparse Scenario Runs

### Why commit groups exist

- A repository commit may produce many scenario runs.
- Some scenarios may be intentionally skipped by Nx, Turborepo, or similar tooling.
- GitHub and dashboard surfaces still need one commit-level story.

### Expected scenario set

- Expected scenarios come from the repository scenario catalog.
- This avoids requiring a central root config for fixture-app scenarios.
- Hosted synthetic-import scenarios also enter the catalog when defined.

### Skipped scenario behavior

If an expected scenario does not upload on a commit group:

- look up the latest successful comparable fresh result
- if found, expose it as `skipped` or `inherited`
- show it for completeness in commit-group summaries
- exclude it from blocking budgets and aggregate check failure
- attach a source-run pointer so the inheritance is explicit

If no comparable fresh result exists:

- surface the scenario as missing rather than inherited
- keep the state non-blocking in V1
- explain why no inherited value is available

### Partial commit-group state

- A commit group with any inherited or missing expected scenario is marked partial.
- This is a non-blocking warning shown in PR comment details, check details, and dashboards.

### Reruns and duplicate uploads

If the same scenario uploads multiple times for the same commit group:

- keep all attempts for debugging and auditability
- use the latest successful processed scenario run as the active one
- surface a warning that multiple uploads were received for the same scenario on one commit group

## Baselines And Comparisons

### Comparable unit

- Baselines are selected per series.
- Comparisons are always like-for-like on `scenario + environment + entrypoint + lens`.

### PR baseline rule

- Use the latest successful comparable fresh series result on the PR base branch.

### Branch baseline rule

- Use the previous successful comparable fresh series result on the same branch.

### Arbitrary comparison rule

- Support arbitrary run-to-run comparison on demand for the same series.

### Fresh-only baseline candidates

- Only fresh measured scenario runs can become normal baseline candidates.
- Inherited skipped results never become future baseline anchors.

### History semantics

- Fresh measured scenario runs create normal series history points.
- Inherited skipped results do not create normal datapoints.
- V1 may show skipped markers in history views, but not as real measured points.

## Acknowledgements

### Scope

- V1 acknowledgements attach to one PR diff item only.
- They do not create durable series-wide or repository-wide policy exceptions.

### Stored references

An acknowledgement should point at:

- repository
- pull request
- comparison
- series
- specific metric or diff item key
- actor and timestamp
- optional note

### Effect

- Acknowledged items remain visible.
- They stop blocking that PR's aggregate check.
- A future PR must acknowledge again if the issue still exists.

## GitHub And Dashboard Consumption

PR comments, GitHub checks, and dashboards should not have separate business logic pipelines.

They should read from the same derived objects:

- commit-group summary
- scenario comparison summary
- comparison detail
- budget outcomes
- acknowledgement overlay state

### GitHub checks

- One aggregate check per repository commit or PR in V1.
- The check details list the failing scenario, entrypoint, lens, and metric items.
- Inherited skipped scenarios contribute warnings, not failures.

### PR comments

- One maintained comment.
- Summarize regressions and improvements by scenario.
- Reuse the same comparison records and detail links as the check.

### Dashboards

- Repository, scenario, branch, history, and diff views all consume the same stored measurements and comparisons.
- Treemap and graph views hang off normalized snapshots and derived comparison artifacts rather than reparsing uploads.

## Why This Shape Fits V1

- Keeps the plugin and Action contract minimal.
- Preserves the rule that one build invocation equals one scenario run.
- Adds commit-level aggregation without introducing a public multipart-finalization API.
- Supports sparse scenario execution without pretending skipped scenarios were freshly measured.
- Keeps raw evidence available for reprocessing and future normalization improvements.
- Lets GitHub and web surfaces stay consistent because they consume shared derived objects.

## Explicit V1 Limits

- No public upload finalization protocol.
- No repeated separate-build grouping into one logical scenario run.
- No automatic scenario retirement. Manual archive only.
- Inherited skipped results are informational only.
- Aggregate GitHub check only. Finer-grained required checks can come later.

## Follow-On Work

This architecture resolves the core system shape, but follow-on work remains:

- map the design onto the final plugin artifact contract
- define concrete storage, job, and caching infrastructure
- define final web app information architecture on top of these read models
- define final GitHub comment and check presentation details
