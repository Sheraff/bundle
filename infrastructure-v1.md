# Infrastructure V1

## Summary

- V1 uses one hosted product origin for both authenticated product pages and public dashboards.
- GitHub App installation is the required trust anchor for repository onboarding.
- The Vite plugin still writes a local artifact and the GitHub Action still uploads it, but the Action should authenticate with short-lived repo-scoped credentials rather than long-lived manual upload secrets.
- The synchronous ingest path stays narrow: authenticate, validate, persist the raw artifact, create or attach the run and commit group, enqueue work, and publish immediate pending state plus a deep link.
- Raw artifacts are immutable, retained indefinitely, and are the only durable source-of-truth layer for reprocessing.
- Normalized snapshots are rebuildable cache, not the long-term durability boundary.
- Repository, scenario, commit-group, comparison, acknowledgement, and dashboard summary read models live in a relational store.
- Heavy raw and derived payloads such as uploaded artifacts, normalized graph payloads, and cached treemap or graph diffs live in object storage.
- PR comparisons, same-branch history comparisons, landing-page summary rows, and history series points should be precomputed asynchronously.
- Treemap diff, graph diff, and waterfall detail payloads should be generated lazily on first open and then cached.
- Commit-group summaries, PR comments, checks, and public dashboard state should update incrementally as scenario runs finish.
- V1 assumes low-to-moderate public dashboard traffic, so CDN and HTTP caching in front of one hosted app is sufficient.

## Goals

This document resolves the V1 infrastructure questions around:

- storage split between raw artifacts, normalized snapshots, and derived views
- job model for ingest, normalization, and comparison work
- what should stay synchronous vs asynchronous
- caching and precomputation strategy
- public dashboard hosting model
- the trust anchor for GitHub-only public-repo onboarding

## Core Deployment Model

### One hosted product

V1 should run as one hosted product serving:

- authenticated product pages
- public repository, scenario, history, and compare pages
- upload and webhook APIs
- GitHub App callbacks and GitHub publication workers

Important V1 rule:

- public dashboards should not require a separate read-only product surface or a separate public deployment plane

Why this is the V1 cut:

- the product is already GitHub-first and dashboard-second, so one origin keeps onboarding, links, acknowledgements, and public deep links coherent
- public traffic expectations are modest enough that read caching is sufficient
- separate public and private stacks add operational cost before the product has proven the need

### Trust and onboarding model

V1 should require:

- GitHub App installation for a repository to connect to the product

Upload trust should work like this:

- the GitHub Action remains the upload client
- the Action authenticates as a connected repository using short-lived repo-scoped credentials
- users should not have to provision long-lived manual upload secrets for the normal GitHub Actions path

Important V1 rule:

- GitHub App installation is the trust anchor
- a direct non-App onboarding path should not be first-class in V1

Implementation note:

- GitHub OIDC may still be useful internally as part of the short-lived credential exchange, but it should support the GitHub App flow rather than replace it as a separate product path

## Storage Model

### 1. Relational control and read-model store

Use a relational store for:

- repository and scenario catalog records
- commit groups and scenario runs
- upload metadata and processing state
- stable series keys
- baseline selections and comparison summaries
- budget outcomes and acknowledgement records
- GitHub check and PR comment read models
- repository and scenario landing-page summary rows
- history series points and lightweight dashboard aggregates

Why relational is the V1 default:

- these objects are highly connected
- they need transactional updates around run activation, commit-group recompute, and acknowledgement overlay
- public summary pages benefit from predictable indexed reads

### 2. Durable raw artifact storage

Store raw uploaded artifacts immutably in durable object storage.

Raw storage should keep:

- the uploaded plugin artifact payload
- any upload envelope needed to reprocess later
- integrity metadata and storage pointer records

Chosen rule:

- raw artifacts are retained indefinitely in V1

Why:

- raw is already the source of truth and reprocessing boundary in `architecture-v1.md`
- this product depends on future normalization and stable-identity improvements
- public historical dashboards lose value if older evidence cannot be replayed

### 3. Rebuildable normalized cache

Normalized snapshots should be treated as rebuildable cache on top of raw artifacts, not as the durability anchor.

This layer may persist:

- normalized environments and entrypoints
- canonical asset, chunk, module, package, and graph records
- stable-identity evidence inputs
- warnings and degraded-state records

Storage rule:

- normalized snapshots may be stored for speed, but they must be disposable and reproducible from raw artifacts

This means:

- normalization schema or logic can evolve without turning normalized storage into a migration bottleneck
- old normalized payloads may be evicted and recomputed
- backfills and reprocessing jobs remain a first-class operational tool

### 4. Derived and detail payload storage

Split derived storage into two kinds:

Lightweight derived and read-model data:

- stays in the relational store
- powers GitHub surfaces and public overview and history pages

Heavy derived detail payloads:

- live in object storage and are keyed from relational lookup records
- include treemap diff nodes, graph diff payloads, waterfall detail payloads, and other large cached comparison artifacts

Why:

- it keeps the main database focused on indexed product reads
- it avoids bloating relational storage with large JSON payloads that are opened less frequently
- it matches the product split between fast summary surfaces and deeper inspection surfaces

## Concrete Schema Direction

The V1 schema should stay intentionally split between:

- relational identity, status, metrics, and read models
- blob-backed raw, normalized, and heavy detail payloads

### First-class relational entities

The main first-class relational records in V1 should be:

- repositories
- pull requests
- scenarios
- commit groups
- scenario runs
- series
- comparisons
- budget results
- acknowledgements
- GitHub publication state
- repository, scenario, commit-group, and PR review summary caches

Important V1 decision:

- `pull_requests` should be first-class rather than only inline metadata on commit groups

Why:

- acknowledgements are PR-scoped in V1
- GitHub publication and retry behavior becomes simpler
- PR-specific review summaries need a stable parent object

### Blob-first payload strategy

V1 should keep these primarily as blob-backed payloads with only small relational projections where needed:

- raw uploaded artifacts
- normalized snapshots
- full measurement payloads used for deep comparison work
- treemap, graph, and waterfall detail caches

Important V1 decision:

- normalized snapshots stay blob-first in V1 rather than becoming a wide relational package, module, and graph schema

Why:

- raw remains the durable source of truth
- normalized data is rebuildable cache
- this avoids locking V1 into a large relational graph model before usage proves the need

### Relational comparison and review model

Relational comparison storage should stay summary-sized.

That means SQL should hold:

- series-level current, baseline, and delta summaries
- budget and blocker outcomes
- compact compare-page rows
- top changed package and asset rows
- commit-group and PR review summary objects

That means SQL should not try to hold:

- full module-level diff inventories
- every heavy detail payload needed for treemap or graph views

Important V1 decision:

- module-level diff detail stays blob-backed in V1

### Neutral commit summaries and PR-specific review summaries

V1 should keep two separate summary layers:

- commit-group summary as the neutral commit-level truth
- pull-request review summary as the PR-specific acknowledgement overlay

Rules:

- commit-group summaries remain acknowledgement-neutral
- PR review summaries are stored, not rebuilt from scratch on every GitHub publish
- PR acknowledgement overlay should appear only on PR-scoped routes and surfaces
- generic repository, scenario, branch, commit, and non-PR compare pages stay neutral
- PR-scoped compare pages may be public-read for public repositories while still requiring auth and repo permission for acknowledgement actions

Why:

- the same commit should not tell different stories on neutral public routes based on unrelated PR context
- GitHub comment and check publishing benefits from a stored PR-shaped review object

## Processing Model

### Queue-backed async pipeline

V1 should use idempotent asynchronous jobs with queue-backed workers.

Core job families:

- normalize one scenario run
- derive stable identity and lens measurements for one run
- materialize PR and same-branch comparisons for impacted series
- recompute commit-group summary state
- publish GitHub check and maintained PR comment updates
- build or refresh dashboard read models
- generate heavy comparison detail payloads on demand

Important V1 rule:

- jobs should be keyed so reruns and duplicate uploads can recompute safely without manual cleanup

### Commit-group recompute model

Commit groups should not rely on a public finalization step.

Instead:

- each newly processed scenario run triggers recomputation of the affected commit-group summary
- the latest successful processed run for a scenario becomes the active run for that commit group
- GitHub and dashboard surfaces update incrementally as the active state changes
- if no scenario runs are still queued or processing and expected scenarios are still absent, a short internal quiet window determines when the commit group settles into inherited or missing partial state
- if every expected scenario has an active fresh run and nothing is still processing, settlement can happen immediately without waiting for that quiet window
- a later upload for the same commit group reopens the summary to pending and restarts recomputation

This matches the already chosen architecture:

- one build invocation equals one scenario run
- sparse scenario execution is allowed
- duplicate uploads are retained for auditability
- no public multipart upload protocol exists in V1

### Worker pipeline direction

The V1 worker system should separate summary freshness from heavy detail generation.

The intended flow is:

1. synchronous ingest acknowledges receipt and enqueues work
2. normalization and measurement jobs derive the run's canonical data and series points
3. a scheduler job determines which standard comparisons are needed for the processed run
4. comparison jobs materialize per-series PR and same-branch comparison summaries
5. commit-group summary jobs recompute active scenario state and partial or inherited status
6. PR review summary jobs apply acknowledgement overlay for PR-scoped surfaces
7. GitHub publication updates the maintained PR comment and aggregate check with a short debounce
8. heavy treemap, graph, and waterfall detail generation happens lazily on first open and is then cached

Important V1 decisions:

- standard comparison work should use a hybrid job model: one scheduler per processed run, then one comparison job per affected series
- GitHub publish should update incrementally, but with a short debounce to avoid comment and check churn when many scenario runs complete close together
- fresh upload to PR-summary work must keep protected capacity even when heavy detail jobs or backfills exist
- the exact queue and worker topology can remain technology-dependent, but the priority separation is a product requirement

### Idempotency and retry posture

Worker jobs should be idempotent and version-keyed.

Operational rules:

- reruns and duplicate uploads must be safe to recompute
- older duplicate scenario runs are retained for debugging and auditability
- the latest successful processed run becomes the active one for commit-group summary purposes
- acknowledgement changes should trigger only PR review summary and GitHub publication refresh, not full comparison recomputation

## Synchronous And Asynchronous Boundaries

### Synchronous ingest path

The synchronous upload path should do only the minimum needed to acknowledge safe receipt:

- authenticate the upload
- validate artifact schema and required GitHub or CI context
- persist the raw artifact immutably
- create or attach the scenario run
- create or attach the commit group
- enqueue async processing jobs
- publish immediate pending state and a deep link target
- optionally update a pending aggregate check

The synchronous path should not:

- normalize the artifact
- derive stable identity
- compute comparisons
- build treemap or graph payloads
- wait for commit-group completeness

### Asynchronous processing target

After upload succeeds, the async path should aim for:

- immediate pending plus deep link availability
- useful summary surfaces in under one minute under normal operating conditions

The under-one-minute target applies to:

- commit-group summary state
- aggregate GitHub check content
- maintained PR comment summary content
- repository and scenario overview summary rows
- history series updates
- standard PR and same-branch comparison summaries

The target does not require:

- treemap diff readiness
- graph or waterfall diff readiness
- all heavy detail payloads to be built before any summary surface updates

## Precomputation And Caching

### Precompute by default for common summary reads

V1 should precompute these after successful async processing:

- PR-base comparison summaries for impacted series
- same-branch previous-success comparison summaries
- repository landing-page summary rows
- scenario landing-page summary rows
- commit-group summary read models
- lightweight GitHub check and PR comment read models
- history series points and small trend aggregates

Why:

- these power the public and GitHub surfaces users will open most
- they must feel fresh quickly
- they are small enough to materialize without turning writes into heavy batch jobs

### On-demand computation for uncommon or heavy reads

V1 should compute these lazily when requested:

- arbitrary run-to-run comparisons outside the standard PR and branch flows
- treemap diff payloads
- graph diff payloads
- waterfall detail payloads
- other large per-series inspection artifacts

Chosen rule:

- build heavy detail payloads on first open, then cache them

Why:

- the product wants fast summary freshness more than universal eager detail generation
- many uploaded runs will never receive deep visual inspection
- the visual payloads are the least suitable part of the system to force under the summary freshness target

### Public caching model

Public pages should be cache-friendly.

V1 should use:

- CDN and HTTP caching in front of the hosted app
- read models shaped for predictable cacheable public responses
- revalidation or purge on derived read-model updates rather than separate static export

Important V1 rule:

- public dashboards should stay live product pages backed by read models
- they should not depend on fully static site generation as the primary data delivery model

## Dashboard Read Model Strategy

### Overview and history bias

V1 should bias toward fast consistent reads for overview and history pages.

That means:

- write small summary records after processing
- append or update series points during run processing
- avoid rebuilding repository and scenario landing pages from lower-level measurements on every request

This is the right V1 trade:

- write amplification stays modest because the summary objects are small
- public pages remain predictable and CDN-friendly
- the product avoids doing repeated live aggregations for anonymous traffic

### Shared consumption rule

GitHub surfaces and web pages must keep reading from the same derived comparison and summary objects.

Infrastructure implication:

- do not create one pipeline for GitHub and another for dashboard pages
- write one shared set of comparison, budget, and summary read models
- let GitHub comment generation, check generation, repository pages, scenario pages, and compare pages all consume those same records

## Retention And Reprocessing

### Durable layers

The only layer that must be treated as permanently durable in V1 is:

- raw uploaded artifacts plus the relational metadata needed to find them

### Disposable layers

These layers should be treated as rebuildable:

- normalized snapshots
- derived comparisons
- heavy detail payload caches
- some summary read models when backfill or recompute is needed

Operational implication:

- V1 should include reprocessing and backfill jobs as normal maintenance tools, not as emergency-only paths

### Cost posture

Because raw artifacts are kept indefinitely:

- storage cost should be absorbed first at the raw layer
- normalized and heavy detail caches are the layers we can evict, compact, or regenerate if costs rise later

## Why This Shape Fits V1

- It follows the already chosen architecture instead of inventing a competing product shape.
- It preserves fast CI acknowledgement by keeping upload synchronous work narrow.
- It supports zero-secrets GitHub onboarding through GitHub App anchored trust instead of long-lived manual upload tokens.
- It gives public dashboards predictable reads without prematurely splitting the system into separate public and private stacks.
- It keeps long-term reprocessing power by making raw uploads the durable evidence layer.
- It meets the freshness bar where it matters most: pending immediately, useful summaries soon after.
- It avoids wasting compute on heavy treemap and graph payloads that many runs will never need.
- It keeps GitHub, compare pages, and history pages consistent because they share the same derived objects.

## Explicit V1 Limits

- No separate public read-only deployment plane.
- No mandatory long-lived manual upload secret for the main GitHub Actions onboarding path.
- No public uploader or standalone upload CLI.
- No public multipart upload finalization protocol.
- No promise that heavy treemap, graph, or waterfall payloads are ready within the first summary-minute target.
- No assumption of high anonymous traffic that would justify a specialized analytical or public-serving stack from day one.
- No vendor-specific commitment to a particular cloud, queue, CDN, or database product in this decision document.

## Follow-On Work

This infrastructure decision resolves the V1 product shape, but follow-on work remains:

- map the storage split onto the final schema and storage keys
- define the exact short-lived upload authentication exchange for GitHub Actions
- define queue partitioning, retry policy, and worker concurrency
- define cache invalidation and revalidation behavior for public routes
- define reprocessing and backfill operational controls
- revisit retention and compaction policy only after real public-repo volume is observed
