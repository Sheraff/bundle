# Technology Stack V1

## Summary

- V1 should use `TanStack Start + React + TypeScript` for the main web product, with `TanStack Router`, `TanStack Query`, `TanStack Table`, `TanStack Virtual`, `TanStack Form`, `TanStack Hotkeys`, and `TanStack Devtools` in development.
- Supporting implementation choices should use `GitHub OAuth`, `Drizzle ORM`, `drizzle-kit`, `Valibot`, `D3`, `Vitest`, `React Testing Library`, `Playwright`, `Sentry`, and `pnpm workspaces + Changesets`.
- The hosted product should run on `Cloudflare Workers`.
- `Cloudflare D1` should be the V1 relational store for control data and read models.
- `Cloudflare R2` should store immutable raw artifacts plus rebuildable heavy payloads.
- `Cloudflare Queues` should be the default async job transport for background processing.
- `Cloudflare Workflows` should orchestrate long-running or waiting flows such as quiet-window settlement, publish debounce, and backfills.
- `GitHub App + GitHub Actions` remain the onboarding and CI integration model.
- Public dashboards should use the same hosted app origin with Cloudflare CDN and HTTP caching in front.
- The main app, upload APIs, webhook handlers, queue consumers, and workflow orchestration should all stay in one Cloudflare-centered deployment model for V1.

## Goals

This document resolves the concrete V1 implementation-stack questions that earlier docs intentionally left vendor-neutral:

- frontend framework choice
- runtime and hosting choice
- relational database choice
- object storage choice
- queue and worker choice
- durable orchestration choice
- how those choices map onto the existing architecture and infrastructure decisions

This document should be read alongside:

- `infrastructure-v1.md`
- `architecture-v1.md`
- `remaining-unknowns.md`

## Decision Framing

`infrastructure-v1.md` deliberately stops short of naming specific vendors.

This document makes the concrete V1 recommendation:

- prefer one primary platform vendor where possible
- avoid `Next.js`
- keep `React` rather than switching to `Solid`
- keep the product compatible with the existing Vite-first and GitHub-first direction

## Core Stack

### Web app

Use:

- `TanStack Start`
- `React`
- `TypeScript`

Why:

- it stays aligned with the Vite-first direction already chosen in the product docs
- it avoids adopting `Next.js`
- it supports SSR, server functions, and URL-shaped application state cleanly enough for the repository, scenario, history, and compare flows
- `React` keeps the UI ecosystem broad for charts, grids, filters, and inspect-heavy dashboard surfaces

Important V1 note:

- `TanStack Start` should be treated as a fast-moving framework choice, so dependencies should be pinned tightly in V1

### TanStack app libraries

Use:

- `TanStack Router`
- `TanStack Query`
- `TanStack Table`
- `TanStack Virtual`
- `TanStack Form`
- `TanStack Hotkeys`
- `TanStack Devtools` in development

Recommended role split:

- `TanStack Router` should own route structure and URL-shaped state such as repository, branch, scenario, environment, entrypoint, lens, and compare selections
- `TanStack Query` should own async server-state fetching, caching, refresh, and mutations for read models, compare pages, and acknowledgement actions
- `TanStack Table` should power scenario catalogs, compare tables, history tables, budget tables, and diff-summary tables
- `TanStack Virtual` should support large compare tables, long diff lists, and any catalog or history surface that grows large enough to threaten UI performance
- `TanStack Form` should power authenticated edit surfaces such as budgets, synthetic-scenario management, acknowledgement notes, and repository settings
- `TanStack Hotkeys` should be treated as a first-class product primitive for keyboard-driven review and navigation workflows across the app
- `TanStack Devtools` should be enabled in development to debug router state, query state, and related TanStack integrations

Why this library set fits the product:

- the product is route-heavy and URL-state-heavy
- the product is read-model-heavy and mutation-light, which fits `TanStack Query` well
- the main inspection surfaces naturally center on dense, filterable, sortable tables
- virtualization is likely to become necessary once real repository and diff data arrives
- keyboard navigation is a real product requirement rather than a nice-to-have
- these libraries stay headless enough to preserve a custom product UI instead of forcing a generic design system

### Runtime and main app hosting

Use:

- `Cloudflare Workers`

The main hosted product on Workers should serve:

- authenticated product pages
- public repository, history, scenario, and compare pages
- upload APIs
- GitHub webhook and callback handlers
- workflow triggers and internal control endpoints where needed

Why:

- it preserves the one-hosted-product rule from `infrastructure-v1.md`
- it keeps the public dashboards and authenticated product pages on one origin
- it avoids introducing a separate app host plus a separate worker host in V1

### Relational database

Use:

- `Cloudflare D1`

Use D1 for:

- repositories
- pull requests
- scenarios
- commit groups
- scenario runs
- series
- comparison summaries
- budget outcomes
- acknowledgements
- GitHub publication state
- repository and scenario summary rows
- history points and lightweight dashboard aggregates

Important V1 rules:

- D1 should hold relational and summary-sized data only
- heavy normalized payloads and deep diff payloads should not live in D1
- schema design should stay read-model-oriented rather than trying to build one giant fully normalized graph database inside D1

Why this is acceptable in V1:

- the product's durable truth boundary is raw uploaded artifacts, not the derived relational layer
- the main relational need is connected metadata plus predictable read models, not large analytical scans over raw payloads
- the single-vendor Cloudflare goal is worth a deliberate database compromise in V1

### Object storage

Use:

- `Cloudflare R2`

Use R2 for:

- immutable raw uploaded artifacts
- upload envelopes needed for reprocessing
- rebuildable normalized snapshots
- cached treemap, graph, and waterfall detail payloads
- other large comparison artifacts that should stay out of D1

Recommended bucket posture:

- one immutable raw bucket or raw prefix for source-of-truth artifacts
- one rebuildable cache bucket or cache prefix for normalized and heavy derived payloads

Why:

- it matches the raw-versus-cache split already chosen in the architecture and infrastructure docs
- it keeps the database focused on indexed product reads instead of large JSON blobs

### Async jobs and workers

Use:

- `Cloudflare Queues`

Queues should be the default mechanism for background work such as:

- normalize one scenario run
- derive stable identity and lens measurements for one run
- materialize per-series PR and same-branch comparisons
- refresh commit-group and dashboard summaries
- publish GitHub comments and checks
- generate heavy detail payloads on demand

Why:

- queues are the simplest fit for retryable fan-out background jobs
- the product already wants a queue-backed async pipeline
- this keeps summary freshness work separate from request-response traffic

### Durable orchestration

Use:

- `Cloudflare Workflows`

Workflows should coordinate flows that are multi-step, time-aware, or wait-aware, such as:

- commit-group quiet-window settlement
- debounced PR comment and aggregate-check publication
- reprocessing and backfill runs
- any flow that must pause, retry over time, or wait for an external event

Important V1 rule:

- Workflows should orchestrate long-running control flow, not replace queues as the primary job transport for all background work

Why:

- queue transport and durable orchestration solve different problems
- the product has both high-volume fan-out work and a smaller number of durable coordination flows

## Recommended Cloudflare Split

The recommended V1 Cloudflare deployment shape is:

- one main Workers app for TanStack Start pages, APIs, upload endpoints, and GitHub webhooks
- one or more queue-consumer Workers for background job execution
- Workflow classes running on Workers for durable orchestration
- D1 bound into the app and worker runtimes for relational reads and writes
- R2 bound into the app and worker runtimes for raw and cached blob access

This still counts as one Cloudflare-centered product deployment model even if the codebase uses multiple Worker entrypoints.

## Recommended Async Boundary

Use `Queues` for:

- ingest-to-normalize handoff
- per-run normalization work
- per-run measurement derivation
- per-series comparison fan-out
- summary read-model refresh
- GitHub publish execution
- on-demand heavy detail generation

Use `Workflows` for:

- commit-group settlement after the quiet window
- PR publication debounce across closely arriving scenario runs
- repo-wide reprocessing and backfill orchestration
- other durable multi-step operations that need sleeps, waits, or externally triggered continuation

Do not use `Workflows` as the only worker system in V1.

## Caching and Delivery

Use:

- Cloudflare CDN and HTTP caching in front of the hosted app

Public route behavior should be:

- live product pages backed by read models
- cacheable responses for public repository, history, scenario, and compare pages where appropriate
- revalidation or targeted purge when summary read models change

Important V1 rule:

- public dashboards should not depend on full static export as the primary delivery model

## GitHub Integration

Keep the already chosen GitHub-native shape:

- `GitHub App` as the repository trust anchor
- `GitHub Actions` as the CI upload client
- short-lived repo-scoped upload credentials for the normal Actions path
- maintained PR comment plus one aggregate GitHub check

Concrete platform mapping:

- GitHub App callbacks land on Workers endpoints
- the upload API lands on Workers endpoints
- successful ingest writes metadata to D1, blobs to R2, and follow-up jobs to Queues
- publication refresh may be triggered directly by queue jobs and coordinated by Workflows when debounce or quiet-window logic is required

## Supporting Stack

### Authentication and sessions

Use:

- `GitHub OAuth` for user login
- `GitHub App` for repository installation and trust
- secure signed cookie sessions

V1 session rule:

- default to stateless signed cookies
- add D1-backed session records only if revocation, device visibility, or audit requirements become a real need

Why:

- GitHub is already the trust boundary for repository onboarding and publication
- the product is GitHub-centered enough that GitHub login is the simplest coherent user identity model
- signed cookies keep session handling simple on Workers in V1

### Database access and migrations

Use:

- `Drizzle ORM`
- `drizzle-kit`

V1 rules:

- use Drizzle for schema definitions, routine queries, and migrations
- use raw SQL selectively for D1-specific or performance-sensitive queries when it is the simpler or safer option

Why:

- it is a practical fit for `Cloudflare D1`
- it gives strong TypeScript ergonomics without forcing a heavyweight abstraction
- it keeps migrations explicit and reviewable

### Validation and shared contracts

Use:

- `Valibot`

Use it for:

- route params and search params
- form inputs
- server function inputs and outputs where appropriate
- upload payloads and internal API payloads
- queue message payloads
- Workflow inputs and continuation payloads
- shared contracts between the app, Vite plugin, and GitHub Action

Why:

- runtime validation should stay centralized and explicit
- the same schema layer should be reused across routes, Workers, jobs, and shared package boundaries

### Charts and custom visualization

Use:

- `D3` as the core visualization engine

Recommended posture:

- build custom React wrappers around `D3` rather than adopting a generic charting library as the main visualization layer

Use D3 for:

- treemaps
- graph and dependency views
- custom history visualizations
- waterfall and diff-inspection views

Why:

- this product needs inspection-heavy custom visuals more than commodity dashboard charts

### Testing

Use:

- `Vitest`
- `React Testing Library`
- `Playwright`
- Wrangler-backed integration tests for Workers, D1, R2, Queues, and Workflows

Recommended test split:

- unit tests for parsing, transforms, comparison logic, and helpers
- component tests for tables, filters, forms, and hotkey-driven interactions
- integration tests for server functions and Worker endpoints
- end-to-end tests for upload, repository, scenario, and compare flows

### Observability

Use:

- `Sentry`
- Cloudflare logs and metrics

V1 observability rules:

- capture errors from app routes, uploads, webhooks, queue consumers, and Workflows
- keep structured logs for ingest, comparison, and publication flows
- make repository, run, commit-group, PR, and scenario identifiers easy to correlate across logs and errors

### App API boundary

Use:

- `TanStack Start server functions` for app-internal reads and mutations
- explicit Worker route handlers for uploads, GitHub callbacks, and other machine-facing endpoints

V1 rule:

- do not introduce a separate `GraphQL`, `tRPC`, or broad REST abstraction unless a concrete need appears

Why:

- this keeps product-facing app code simple while preserving explicit integration endpoints for GitHub and upload traffic

### Monorepo and package management

Use:

- `pnpm workspaces`
- `Changesets`

Recommended package split:

- web app
- Vite plugin
- GitHub Action
- shared contracts and schemas
- shared UI or visualization packages only if they become truly reusable

Why:

- this matches the likely multi-package product shape without adding heavier release machinery

### UI layer

- UI primitives and styling remain intentionally undecided for now and are not part of this document's locked V1 choices.

## Concrete V1 Resource Direction

Recommended initial resource shape:

- one D1 database for relational control and read models
- one R2 raw store for immutable upload artifacts
- one R2 cache store for normalized snapshots and heavy detail payloads, or one shared bucket with strongly separated prefixes
- queue families for normalization, comparison, summary refresh, GitHub publish, and heavy detail generation
- workflow families for commit-group settlement, PR publish debounce, and repo backfill

The exact resource names can change during implementation, but the split should stay the same.

## Risks and Tradeoffs

### TanStack Start

- it is still an evolving framework choice, so version drift is a real V1 risk
- pin versions tightly and upgrade intentionally

### D1

- D1 is the main compromise in the Cloudflare-only plan
- it is a better fit for summary-sized relational data than for large payload storage or highly complex analytical querying
- if one major platform choice changes after V1, the first likely change should be the relational database, not Workers, R2, or the queue and workflow model

### Overusing Cloudflare primitives

- do not treat `D1`, `R2`, `Queues`, `Workflows`, `KV`, and `Durable Objects` as interchangeable tools
- use each service for the storage or execution shape it actually fits
- avoid introducing `Durable Objects` into the core design unless per-repository or per-commit-group serialization becomes a proven need

## Why This Shape Fits V1

- it respects the existing one-hosted-product decision
- it keeps the stack close to the Vite-first product direction
- it avoids `Next.js` without giving up a full-stack React framework
- it satisfies the preference for one primary platform vendor where practical
- it maps cleanly onto the existing split of relational read models, durable raw artifacts, rebuildable caches, queue-backed async jobs, and cached public dashboard delivery
- it keeps the main migration escape hatch obvious if V1 database limits are reached later

## Follow-On Work

This stack decision should be followed by:

- defining the first D1 schema for repositories, runs, commit groups, comparisons, acknowledgements, and summary rows
- defining the R2 key layout for raw artifacts, normalized snapshots, and cached detail payloads
- defining queue families, retry posture, and priority classes
- defining Workflow classes for settlement, publish debounce, and backfill orchestration
- defining the Wrangler configuration and environment binding layout for local dev, preview, and production
