# Stable Identity Lab

This lab is the implementation side of `remaining-unknowns.md` task 1.

It is intentionally research-first:

- real Vite apps live under `apps/`
- raw bundle snapshots live under `artifacts/`
- matcher expectations live under `expectations/`
- the fast loop runs from stored artifacts without rebuilding apps

## Commands

Install workspace dependencies once:

```bash
pnpm install
```

Run the slow loop and refresh stored artifacts:

```bash
pnpm stable-identity:build-fixtures
```

Run the fast loop against stored artifacts:

```bash
pnpm stable-identity:test
```

Run both loops together:

```bash
pnpm stable-identity:refresh
```

Inspect one stored artifact:

```bash
pnpm stable-identity:inspect research/stable-identity/artifacts/react-routes/v2.json
```

## Iteration Model

The lab is built around two loops.

Slow loop:

1. build real fixture apps
2. capture raw Vite and Rollup output metadata
3. commit compact JSON artifacts

Fast loop:

1. load stored artifacts
2. run the matcher
3. score expected continuity, split, and merge cases

The matcher should change more often than the fixtures.

## Current Corpus

Phase 1 currently uses two real app families with CSS and static assets included:

- `react-routes`
- `multi-entry-manifest`
- `css-assets`
- `client-ssr`
- `ambiguous-shared`
- `auto-chunk-routes`
- `rename-moves`

Each family has `v1`, `v2`, and `v3` variants so the matcher can be tested on:

- stable entry continuity across hash churn
- shared chunk continuity
- explicit split detection
- explicit merge detection
- CSS continuity
- static asset continuity
- degraded and low-confidence shared-chunk lineage
- continuity under natural Rollup chunking without `manualChunks`
- rename and move cases across routes, shared modules, CSS, and static assets

Notes:

- `css-assets` is the harder CSS corpus. It includes a shared CSS split in `v1 -> v2` and a shared CSS merge in `v2 -> v3`, plus static SVG assets imported from CSS.
- `client-ssr` is the environment corpus. It captures separate `client` and `ssr` artifacts for the same fixture versions.
- The `client-ssr` package uses Vite's Environment API and builds all configured environments via `vite build --app`.
- `ambiguous-shared` is the degraded-state corpus. It intentionally creates one old shared chunk that partially overlaps two new shared chunks strongly enough to be interesting, but not strongly enough to claim either `same` or `split`.
- `auto-chunk-routes` is the no-`manualChunks` corpus. Its shared chunk names come from natural Rollup chunking, and the matcher is expected to preserve continuity across content changes and output-layout changes.
- `rename-moves` is the rename-and-move corpus. It mixes positive and negative cases: route renames should degrade to add/remove, while some shared CSS and static assets should still match when the emitted role and importer lineage remain uniquely aligned.

## Treemap Keys

The lab now derives a logical treemap diff layer rather than keying treemap updates directly on emitted filenames.

- module nodes are keyed by stable module ID
- package nodes are keyed by package name
- shared chunk diff nodes use lineage keys derived from owner-entry context plus module composition
- generated shared CSS diff nodes use lineage keys when no stable source path exists
- static assets prefer stable source paths and fall back to lineage keys only when necessary

This keeps lower-level composition nodes stable even when chunk grouping changes.

## Success Criteria

The harness is designed to support these working criteria:

- no false positive entry continuity in the fixture corpus
- no false positive one-to-one shared chunk continuity in known split and merge cases
- known degraded cases surface as `ambiguous` instead of fake `same`, `split`, or `merge`
- treemap diff nodes key on stable logical identity instead of hashed emitted filenames
- unchanged module IDs are preserved exactly across versions
- stored artifacts are sufficient to run the fast loop without rebuilding apps
- matcher output carries evidence for each claimed relationship

The current `run-expectations` command gates on explicit expected relationships.
When the corpus grows, stricter metric thresholds can be added without changing the capture format.
