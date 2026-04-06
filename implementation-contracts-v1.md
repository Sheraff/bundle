# Implementation Contracts V1

## Purpose

This document is the short implementation contract pass that turns the V1 product decisions into first-build engineering boundaries.

It is intentionally more concrete than the product docs.

It should be read alongside:

- `technology-stack-v1.md`
- `product-functionality.md`
- `scenario-environment-runid-v1.md`
- `plugin-artifact-contract-v1.md`
- `architecture-v1.md`
- `web-app-shape-v1.md`
- `github-ux-details-v1.md`

## Locked V1 Implementation Decisions

- One build invocation equals one scenario run.
- The Vite plugin writes one artifact file.
- The GitHub Action uploads the artifact plus Action-owned metadata.
- Manifest is required and auto-enabled by the plugin.
- Public repository pages and compare pages are public-read in V1.
- PR-scoped compare views remain public-read for public repos.
- Acknowledgement writes require auth plus repository permission.
- D1 stores relational and summary-sized data.
- R2 stores raw artifacts, normalized snapshot blobs, and heavy derived payloads.
- Queues are the default async transport.
- Workflows orchestrate settlement, debounce, and backfill.

## Workspace Layout

Use this initial `pnpm` workspace split:

- `apps/web`
  - TanStack Start app
  - public dashboards
  - authenticated management UI
  - server functions for app-facing reads and mutations
  - Worker handlers for upload and GitHub endpoints
- `packages/contracts`
  - Valibot schemas
  - inferred TypeScript types
  - shared constants, enums, and key helpers
- `packages/vite-plugin`
  - `bundleTracker()` plugin
  - artifact generation and validation
- `packages/github-action`
  - fixture-app runner wrapper
  - synthetic-import materialization
  - artifact discovery and upload client

Do not add more packages in V1 unless reuse becomes real.

## Shared Contract Package

`packages/contracts` should be the source of truth for machine-facing schemas.

It should export Valibot schemas and inferred TS types for:

- plugin artifact
- upload envelope
- queue messages
- workflow inputs
- public route params
- public route search params
- authenticated mutation inputs

Rule:

- infer TS types from Valibot schemas instead of maintaining parallel hand-written interfaces

## ID And Key Conventions

Use string ULIDs for internal primary keys.

Use GitHub-native identifiers as external uniqueness anchors.

Key rules:

- `repository`
  - internal `id`
  - unique `github_repo_id`
  - current public slug from `owner/name`
- `pull_request`
  - internal `id`
  - unique on `repository_id + pr_number`
  - also store GitHub node id when available
- `scenario`
  - internal `id`
  - unique on `repository_id + scenario_slug`
- `commit_group`
  - internal `id`
  - unique on `repository_id + commit_sha`
- `scenario_run`
  - internal `id`
  - many runs may exist for one `commit_group + scenario`
  - latest successful processed run becomes active
- `series`
  - internal `id`
  - unique on `repository_id + scenario_id + environment + entrypoint_key + lens`

Do not expose internal ULIDs in public repository URLs when a stable repo slug or scenario slug already exists.

## Public Route Contract

Use an explicit public prefix to avoid collisions with app/auth routes.

Public pages:

- `/r/$owner/$repo`
- `/r/$owner/$repo/history`
- `/r/$owner/$repo/scenarios/$scenario`
- `/r/$owner/$repo/compare`

Authenticated management pages:

- `/app/repositories/$repositoryId/settings`
- `/app/repositories/$repositoryId/synthetic`
- `/app/repositories/$repositoryId/synthetic/$scenarioId`

PR-scoped compare remains the same public compare route with `pr` in search params, not a separate page type.

## URL Search Param Contract

Repository overview:

- `branch?`
- `lens`

Repository history:

- `branch`
- `scenario?`
- `env?`
- `entrypoint?`
- `lens`

Scenario page:

- `branch`
- `env`
- `entrypoint`
- `lens`
- `tab?`

Compare page:

- `base`
- `head`
- `pr?`
- `scenario?`
- `env?`
- `entrypoint?`
- `lens?`
- `tab?`

Rules:

- `lens` is required on chart-bearing routes
- `lens` may be omitted on the top compare table when showing many series rows with a visible lens column
- `env` and `entrypoint` may use `all` on scenario/history pages
- compare detail tabs only activate once one full series context is selected

## First Server Function Boundary

App-facing reads should start with these server functions:

- `getRepositoryOverview`
- `getRepositoryHistory`
- `getScenarioPage`
- `getComparePage`
- `getPrComparePage`
- `listSyntheticScenarios`
- `getSyntheticScenario`

App-facing mutations should start with:

- `acknowledgeComparisonItem`
- `createHostedSyntheticScenario`
- `updateHostedSyntheticScenario`
- `archiveHostedSyntheticScenario`

Machine-facing HTTP endpoints should start with:

- `POST /api/v1/uploads/scenario-runs`
- `POST /api/v1/github/webhooks`

Do not add GraphQL or tRPC.

## Plugin Artifact Contract

The source of truth is `plugin-artifact-contract-v1.md`.

Implementation rules:

- artifact path is `.<product-name>/artifact.json` under Action `working-directory`
- plugin writes exactly one file per build invocation
- plugin writes only after validation succeeds
- plugin must auto-enable manifest generation
- environment names must be unique within the artifact
- if Vite gives no environment name, emit `default`
- `build.rootDir` is required and preserved raw

Synthetic-import continuity rule:

- the Action must materialize synthetic input to a deterministic generated file path derived from `scenario`
- do not use an ephemeral virtual entry as the primary V1 synthetic entry mechanism

## Upload Envelope Contract

Use one JSON upload envelope schema in `packages/contracts`.

Initial logical shape:

```ts
type UploadScenarioRunEnvelopeV1 = {
  schemaVersion: 1
  artifact: PluginArtifactV1
  repository: {
    githubRepoId: number
    owner: string
    name: string
    installationId: number
  }
  git: {
    commitSha: string
    branch: string
  }
  pullRequest?: {
    number: number
    baseSha: string
    baseRef: string
    headSha: string
    headRef: string
  }
  scenarioSource: {
    kind: 'fixture-app' | 'repo-synthetic' | 'hosted-synthetic'
    hostedScenarioId?: string
  }
  syntheticDefinition?: {
    displayName?: string
    source: string
  }
  ci: {
    provider: 'github-actions'
    workflowRunId: string
    workflowRunAttempt?: number
    job?: string
    actionVersion?: string
  }
}
```

Rules:

- `artifact` remains the raw build-evidence boundary
- GitHub and CI context stays outside the artifact
- `syntheticDefinition` is present only for Action-defined synthetic-import runs
- hosted synthetic source text still lives in product-managed storage as well; the upload copy is for the measured run record

## D1 Schema Direction

Start with these tables:

- `repositories`
- `pull_requests`
- `scenarios`
- `hosted_synthetic_scenarios`
- `commit_groups`
- `scenario_runs`
- `series`
- `series_points`
- `comparisons`
- `budget_results`
- `acknowledgements`
- `commit_group_summaries`
- `pr_review_summaries`
- `github_publications`
- `repository_summary_rows`
- `scenario_summary_rows`

Important implementation rule:

- do not try to store full normalized snapshots or heavy diff payloads in D1

Important uniqueness rules:

- `repositories.github_repo_id` unique
- `pull_requests (repository_id, pr_number)` unique
- `scenarios (repository_id, slug)` unique
- `hosted_synthetic_scenarios (repository_id, scenario_id)` unique
- `commit_groups (repository_id, commit_sha)` unique
- `series (repository_id, scenario_id, environment, entrypoint_key, lens)` unique

Activation rule:

- do not encode active-run state as a fragile boolean on `scenario_runs`
- store active run selection in commit-group summary/read-model rows

## R2 Key Layout

Use one raw namespace and one cache namespace.

Recommended prefix layout:

- `raw/scenario-runs/{scenarioRunId}/artifact.json`
- `raw/scenario-runs/{scenarioRunId}/envelope.json`
- `normalized/scenario-runs/{scenarioRunId}/snapshot.json`
- `detail/comparisons/{comparisonId}/treemap.json`
- `detail/comparisons/{comparisonId}/graph.json`
- `detail/comparisons/{comparisonId}/waterfall.json`

Rules:

- `raw/` objects are immutable source-of-truth inputs
- `normalized/` and `detail/` objects are rebuildable caches
- D1 rows should store object keys and version markers, not large JSON payloads

## Queue Contract

Start with these queue families:

- `normalize-run`
- `derive-run`
- `schedule-comparisons`
- `materialize-comparison`
- `refresh-summaries`
- `publish-github`
- `generate-detail`

Every queue message should include:

- `schemaVersion`
- `kind`
- `repositoryId`
- primary target id such as `scenarioRunId`, `comparisonId`, or `commitGroupId`
- a dedupe or version key

Every queue payload must be Valibot-validated.

## Workflow Contract

Start with these Workflow classes:

- `CommitGroupSettlementWorkflow`
- `PrPublishDebounceWorkflow`
- `RepositoryBackfillWorkflow`

Required inputs:

- workflow `schemaVersion`
- `repositoryId`
- target id such as `commitGroupId`, `pullRequestId`, or repository backfill scope
- orchestration version or reason key

Rules:

- settlement uses the internal quiet window
- publish debounce coalesces closely arriving scenario runs
- workflows orchestrate waits and coordination only
- queues remain the main fan-out job system

## Commit-Group Settled Rule

Implement exactly this V1 behavior:

- pending while any scenario run for the commit group is queued or processing
- settle immediately if all expected scenarios have active fresh runs
- otherwise settle after a short internal quiet window since the latest upload
- on settlement, absent expected scenarios become `inherited` or `missing`
- a later upload for the same commit group reopens pending state

The quiet window is an internal constant, not a repo setting in V1.

## Public Versus PR-Scoped Compare Reads

Use two compare read shapes:

- neutral compare read model
- PR review compare read model

Rules:

- neutral compare stays acknowledgement-neutral
- PR review compare overlays acknowledgements and blocker state for one PR
- both may be public-read for public repos
- acknowledgement mutations require auth and repo permission

## First Implementation Order

Build in this order:

1. `packages/contracts` - done with noted remaining contract gaps below
2. `packages/vite-plugin` - done
3. `packages/github-action` - done for fixture-app and public `repo-synthetic` flows
4. upload endpoint plus raw persistence - remaining
5. normalization worker plus snapshot blob write - remaining
6. stable identity plus measurement derivation - remaining
7. comparison and budget jobs - remaining
8. commit-group summary and PR review summary jobs - remaining
9. GitHub publication - remaining
10. repository, scenario, and compare pages - remaining

## Small Remaining Follow-Ons

These are still implementation details, but they are no longer product-definition blockers:

- define the hosted synthetic `budgets` contract and add it to `createHostedSyntheticScenario` and `updateHostedSyntheticScenario`; the current first pass intentionally omits `budgets`
- lock the compare-detail `tab` enum and encode the `tab` activation rule that requires one full series context (`scenario + env + entrypoint + lens`); the current first pass keeps `tab` as a loose optional string
- exact D1 column sets and indexes
- exact cookie/session helper choice
- exact Cloudflare binding names
- exact quiet-window duration
- exact GitHub upload auth exchange steps
- wire `packages/github-action` to the final short-lived GitHub App upload auth flow instead of temporary runtime env inputs
- add the hosted-synthetic fetch or resolution path once the auth and onboarding flow is defined; the current public action cut is fixture-app plus `repo-synthetic`
- finalize publish-ready GitHub Action packaging for the bundled Vite runtime and native dependency edge cases
- exact Sentry tagging fields
- final product package names and npm scopes
