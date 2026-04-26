# UI Redesign Execution 07: Expert Visualizer Experience

## Position In Chain

Start only after `06-history-experience` acceptance checks pass.

## Goal

Redesign the expert visualizer as a contextual analysis mode while preserving existing treemap/graph/waterfall/assets/packages functionality.

## Non-Goals

- Do not require sourcemaps.
- Do not claim source-line attribution.
- Do not build generic frame scrubbers before frame contracts exist.
- Do not make Expert Visualizer a top-level nav item.

## Entry Points

Expert Visualizer opens from a selected output row in:

- Scenario Page
- Review Mode
- Compare Mode
- History Mode

It must receive full context:

- scenario
- environment
- entrypoint
- What's counted
- Size
- current run/ref
- optional baseline run/ref
- selected node/asset/module where applicable

## UI Layout

Full-screen contextual mode.

Header:

```text
Marketing app · client / index.html · Entry JS + direct CSS · gzip · main -> PR #42
```

Intent rail:

| Intent | View |
| --- | --- |
| Where size lives | Treemap |
| What changed | Bundle waterfall |
| How modules connect | Module graph |
| Which assets/packages changed | Tables |

Mode views:

- Treemap
- Bundle waterfall
- Module graph
- Assets
- Packages

## History Scrubber

Only show scrubber when frame data exists.

Scrubber context is the same output + `What's counted` over valid runs.

Do not show broken controls for graph/waterfall until frame loaders exist.

## Compatibility / Attribution Banner

Show one of:

- full attribution
- partial attribution
- not applicable

Attribution labels:

- asset
- chunk
- module
- package
- unknown
- unavailable

Required copy when relevant:

```text
Module-level attribution only. Source-line attribution is unavailable because sourcemaps are not uploaded in V1.
```

## Tests

Add regression tests for existing visualizations before refactor.

Add tests for:

- context preservation from row to visualizer
- unsupported visualization state
- unavailable evidence state
- treemap still works
- graph/waterfall still work where currently supported
- no sourcemap/source-line claims

## Acceptance Criteria

- Existing expert visualizations are preserved.
- Expert Visualizer opens with full scenario/output/what-counted/size context.
- Intent rail makes expert modes understandable.
- Scrubber is shown only when supported.
- Attribution limits are explicit.

## Handoff To Plan 08

Plan 08 may start only after:

- Expert context contracts are stable.
- Visualizer no longer depends on old tab-first mental model.
