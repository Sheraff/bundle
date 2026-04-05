# Plugin Artifact Contract V1

## Summary

- One build invocation produces one plugin artifact file and one scenario run.
- The artifact is one JSON file at `.<product-name>/artifact.json`, rooted under the GitHub Action `working-directory`.
- The artifact is a build-inspection boundary, not an upload envelope.
- The plugin auto-enables manifest generation and embeds the full Vite manifest block for every captured environment.
- The artifact carries full raw graph evidence: manifest data, emitted chunks and assets, import edges, module membership, per-module rendered lengths, and Vite `importedCss` and `importedAssets` metadata.
- The artifact does not carry sourcemaps, package aggregates, synthetic-import source text, or GitHub and CI metadata.
- Validation is strict for required evidence and must fail in the plugin build step.
- Opportunistic fields such as asset `originalFileNames` remain optional when Rollup or Vite truly do not expose them.
- Versioning is explicit via separate `schemaVersion` and `pluginVersion` fields.

## Goals

This document resolves the V1 plugin artifact questions around:

- artifact file format and discovery
- artifact schema versioning
- required versus optional raw evidence
- validation and degraded-state behavior
- how much graph, module, and package data belongs in the artifact
- what belongs in the plugin artifact versus the Action upload envelope

## Core Boundary

The plugin artifact is the local raw evidence produced by one Vite build invocation for one scenario run.

Important V1 rules:

- The plugin owns bundle inspection only.
- The plugin writes one local artifact file.
- The GitHub Action discovers that file at a fixed path, reads it, and uploads it.
- The Action, not the plugin artifact, owns GitHub and CI context such as commit SHA, branch, PR metadata, and repository identity.
- The Action, not the plugin artifact, owns synthetic-import source text and hosted-versus-repository source-of-truth metadata.

This keeps the plugin contract focused on raw build evidence while keeping upload and GitHub concerns outside the bundler-facing boundary.

## One File Per Scenario Run

V1 keeps the rule already established in `scenario-environment-runid-v1.md`:

- one build invocation equals one scenario run
- repeated separate-build grouping is out of public V1

That means the artifact file is per scenario run, not per environment.

Important implication:

- one artifact file may contain one or more environments when a native multi-environment Vite build emits more than one environment in a single invocation

This is the only V1 shape that preserves both:

- one build invocation equals one scenario run
- native Vite multi-environment builds remain first-class

## File Discovery And Location

The plugin writes the artifact to a fixed known path:

- `.<product-name>/artifact.json`

Location rule:

- the path is rooted under the Action `working-directory`

Why this is the V1 cut:

- the Action can discover the artifact without globs or custom path inputs
- artifact discovery stays independent from Vite `outDir` naming
- the artifact is clearly tool-owned rather than user build output
- the artifact path remains stable even if emitted bundle layout changes

Naming note:

- the product name is not final yet, so this document uses the placeholder `.<product-name>/artifact.json`
- the final product name should replace that placeholder without changing the rest of the contract

Operational behavior:

- the plugin should create the `.<product-name>/` directory if needed
- the plugin should overwrite the artifact file for the current build invocation
- the plugin should only write the file after all required evidence has been captured and validated

## Manifest Contract

V1 requires manifest data.

Chosen rule:

- the plugin must auto-enable Vite manifest generation for the environments it captures

This means V1 does not depend on repositories remembering to set `build.manifest: true` themselves.

Why manifest is required in V1:

- entry and dynamic-entry identity relies first on manifest key and `src`
- manifest relationships are the cleanest raw evidence for entrypoint, CSS, imported asset, and static and dynamic import continuity
- the manifest payload is usually small compared with sourcemaps and is worth preserving as raw evidence

Manifest representation in the artifact:

- each environment section embeds the full Vite manifest block
- the artifact should preserve the full manifest shape semantically, not only a narrowed derived subset
- the plugin may sort manifest keys before serialization for deterministic output, but the manifest content should remain a full raw block

## Versioning

The artifact stores two separate versions:

- `schemaVersion`
- `pluginVersion`

Meaning:

- `schemaVersion` is the parser and compatibility boundary for the JSON contract
- `pluginVersion` is diagnostic producer metadata and does not define parsing rules by itself

V1 rule:

- incompatible schema changes must bump `schemaVersion`
- additive backward-compatible fields may remain within the same `schemaVersion`

## Schema Shape

The artifact should use one top-level JSON object with this logical shape:

```ts
interface PluginArtifactV1 {
  schemaVersion: 1
  pluginVersion: string
  generatedAt: string
  scenario: {
    id: string
    kind: 'fixture-app' | 'synthetic-import'
  }
  build: {
    bundler: 'vite'
    bundlerVersion: string
  }
  environments: EnvironmentArtifactV1[]
}

interface EnvironmentArtifactV1 {
  name: string
  build: {
    outDir: string
  }
  manifest: Record<string, ViteManifestEntry>
  chunks: ChunkArtifactV1[]
  assets: AssetArtifactV1[]
  warnings: ArtifactWarningV1[]
}

interface ViteManifestEntry {
  src?: string
  file: string
  css?: string[]
  assets?: string[]
  isEntry?: boolean
  name?: string
  isDynamicEntry?: boolean
  imports?: string[]
  dynamicImports?: string[]
}

interface ChunkArtifactV1 {
  fileName: string
  name: string
  isEntry: boolean
  isDynamicEntry: boolean
  facadeModuleId: string | null
  imports: string[]
  dynamicImports: string[]
  implicitlyLoadedBefore: string[]
  importedCss: string[]
  importedAssets: string[]
  modules: ChunkModuleArtifactV1[]
  sizes: FileSizesV1
}

interface ChunkModuleArtifactV1 {
  rawId: string
  renderedLength: number
  originalLength: number
}

interface AssetArtifactV1 {
  fileName: string
  names: string[]
  originalFileNames?: string[]
  needsCodeReference: boolean
  sizes: FileSizesV1
}

interface FileSizesV1 {
  raw: number
  gzip: number
  brotli: number
}

interface ArtifactWarningV1 {
  code: string
  message: string
}
```

Important V1 note:

- this is the contract shape, not the final normalized storage model
- normalization still happens later, after upload

## Required Raw Evidence

The artifact must carry enough raw evidence to support later normalization, stable identity, PR diffs, treemaps, graph views, and measurement derivation.

Required top-level fields:

- `schemaVersion`
- `pluginVersion`
- `generatedAt`
- `scenario.id`
- `scenario.kind`
- `build.bundler`
- `build.bundlerVersion`
- `environments`

Required per-environment evidence:

- `name`
- `build.outDir`
- full `manifest`
- emitted `chunks`
- emitted `assets`
- `warnings` as an array, empty when there are no warnings

Required per-chunk evidence:

- `fileName`
- `name`
- `isEntry`
- `isDynamicEntry`
- `facadeModuleId`
- `imports`
- `dynamicImports`
- `implicitlyLoadedBefore`
- `importedCss`
- `importedAssets`
- `modules`
- `sizes.raw`
- `sizes.gzip`
- `sizes.brotli`

Required per-module evidence inside each chunk:

- raw module id
- `renderedLength`
- `originalLength`

Required per-asset evidence:

- `fileName`
- `names`
- `needsCodeReference`
- `sizes.raw`
- `sizes.gzip`
- `sizes.brotli`

This is the V1 answer to how much graph data belongs in the artifact:

- full raw graph evidence belongs in the artifact
- package aggregates do not

## Optional Evidence

Some raw evidence is useful but not guaranteed by Rollup or Vite in every case.

V1 optional fields:

- asset `originalFileNames`

Rule:

- if Vite or Rollup exposes those fields, the plugin should preserve them
- if they are truly unavailable, the artifact may omit them without failing validation

Important constraint:

- optional means truly opportunistic
- V1 does not allow a broad degraded state where obviously expected core graph data is missing

## Validation And Failure Model

V1 validation is strict.

Hard failure rule:

- if required artifact evidence is missing or unreadable, the plugin build step must fail

Examples of hard failures:

- missing or invalid scenario id
- missing scenario kind
- no captured environments
- missing manifest for a captured environment
- missing chunk or asset sections
- missing chunk import graph fields
- missing module membership or module size fields
- inability to read emitted files needed to measure raw, gzip, or brotli sizes

Important V1 rule:

- the plugin should not write a partial artifact and rely on ingest to reject it later

This is the answer to degraded-state behavior in V1:

- degraded states are allowed only for optional evidence and later normalization uncertainty
- degraded states are not allowed for missing required raw artifact evidence

## Warning Model

Warnings remain useful, but only for non-fatal gaps.

Warnings may cover cases like:

- optional provenance fields were unavailable
- the plugin captured a weaker-than-ideal but still valid piece of evidence

Warnings should not cover cases like:

- missing manifest
- missing chunk graph fields
- missing module membership
- missing required file sizes

Those are build failures, not warnings.

## What Stays Out Of The Artifact

These do not belong in the V1 plugin artifact:

- sourcemaps
- package aggregates
- duplicate package summaries
- duplicate module summaries
- normalized stable IDs
- derived lens measurements
- baseline and comparison outputs
- GitHub and CI metadata
- repository slug and commit metadata
- synthetic-import source text
- synthetic-import source hash

Reason:

- these belong either to the Action upload envelope or to later normalization and derived-data stages

## Why Packages Are Not In The Artifact

The plugin should preserve raw module evidence and let the platform derive packages later.

Why this is the V1 cut:

- package attribution is a derived view over module IDs
- keeping packages out of the artifact avoids duplicating raw and derived concepts at the boundary
- it keeps the plugin focused on preserving emitted evidence instead of baking in normalization choices too early

## Why Sourcemaps Stay Out Of V1

Sourcemaps remain explicitly out of the V1 artifact contract.

Why:

- sourcemaps are not required for stable identity in the chosen V1 design
- they are the obvious payload-size and operational-complexity cliff
- excluding them keeps the artifact boundary smaller while still preserving the core product value

This does not prevent later sourcemap-enhanced attribution work, but it keeps that as a future extension instead of a V1 prerequisite.

## Adjacent Upload Boundary

The Action upload envelope still needs to provide metadata that the plugin artifact intentionally excludes.

Examples:

- repository identity
- commit SHA
- branch and PR context
- scenario source-of-truth metadata such as repository-defined versus hosted synthetic-import

Important V1 rule:

- the uploaded raw record is the combination of plugin artifact plus Action-side upload metadata
- the plugin artifact alone is not the full public ingestion contract

## Why This Cut Fits V1

- It preserves one build invocation equals one scenario run.
- It supports native multi-environment Vite builds without reintroducing public `runId` grouping.
- It keeps the plugin boundary focused on raw build evidence.
- It preserves the strongest stable-identity inputs without pulling normalization into the plugin.
- It keeps discovery and upload simple for the GitHub Action.
- It avoids sourcemap and package-attribution complexity in the initial contract.

## Explicit Non-Goals

These stay out of the V1 plugin artifact contract:

- public repeated-build staging and finalization
- public uploader or standalone upload CLI
- sourcemap ingestion
- plugin-owned GitHub or CI metadata
- plugin-owned package attribution summaries
- embedding hosted or workflow synthetic-import source definitions into the artifact
