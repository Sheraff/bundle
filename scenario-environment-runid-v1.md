# Scenario, Environment, and `runId` V1 Findings

## Summary

The clean v1 cut is:

- Fixture-app `scenario` is plugin-owned.
- `scenario` ids are slug-like stable identifiers.
- `environment` is auto-detected from Vite, with a defined fallback.
- Public `runId` support is out of v1.
- One build invocation maps to one scenario run.
- Repeated separate-build grouping is out of v1.
- The Vite plugin writes a local result artifact.
- The GitHub Action uploads that artifact.
- No public uploader is needed in v1.

## Vite Plugin Contract

For v1, keep the plugin contract minimal:

```ts
bundleTracker({
  scenario: 'minimal-react-app',
})
```

Behavior:

- `scenario` is required.
- `scenario` must be a stable slug like `minimal-react-app`.
- Plugin-defined scenarios are implicitly `fixture-app`.
- Environment names come from `this.environment.name` when available.
- If `this.environment.name` is unavailable, the captured environment is `default`.
- A single build invocation produces one scenario run in v1.
- There is no public `runId` in plugin config.
- The action cannot override a plugin-declared fixture-app scenario.
- The plugin writes a standard local result artifact for the action to upload.

Possible later extension, but not v1:

```ts
bundleTracker({
  scenario: 'minimal-react-app',
  environments: {
    client: { classification: 'client' },
    ssr: { classification: 'server' },
  },
})
```

That should stay out of v1 unless a real need appears.

## GitHub Action Contract

For the public v1 GitHub Action, keep the inputs small:

```yaml
inputs:
  command:
    description: Existing build command for fixture-app scenarios
    required: false

  source:
    description: Virtual ESM entry source for action-defined synthetic-import scenarios
    required: false

  working-directory:
    description: Directory to run the command in
    required: false

  scenario:
    description: Stable scenario id only for action-defined synthetic-import scenarios
    required: false
```

Mode rules:

- If `scenario` is omitted, the action is in fixture-app mode. `command` is required, `source` must be omitted, and the plugin declares the scenario.
- If `scenario` is provided, the action is in synthetic-import mode. `source` is required, `command` must be omitted, and the action owns the scenario id.
- Providing both `command` and `source` should be a hard validation error.
- In both modes, one action invocation produces one scenario run in v1.

Example fixture-app flow:

```yaml
- uses: bundle/action@v1
  with:
    command: pnpm --filter examples/minimal-react-app build
```

Example action-defined synthetic-import flow:

```yaml
- uses: bundle/action@v1
  with:
    scenario: export-foo-from-core
    source: |
      export { Foo } from '@acme/core'
      export * as Bar from '@acme/client'
```

In this example:

- The action owns the `scenario` id because this is a synthetic-import scenario, not a plugin-declared fixture app.
- `scenario` is still only the stable id.
- The source of truth for the synthetic import shape is plain ESM in a virtual file, not ad hoc CLI flags.
- The action is responsible for materializing that virtual entry and bundling it for measurement.

Meaning:

- For fixture apps, the action does not take `environment`.
- For fixture apps, the action does not take `run-id`.
- For fixture apps, the action does not override plugin `scenario`.
- The action is responsible for upload in v1.
- There is no separate public uploader contract in v1.

## Operational Model

The public v1 story is:

- The plugin declares the fixture scenario.
- The action runs the existing build command.
- The plugin captures the Vite environment automatically.
- The plugin writes a local result artifact.
- The action reads that artifact and uploads it.
- One build invocation equals one scenario run.

## Why This Cut Fits V1

- Vite already exposes real per-environment build context via `this.environment.name`.
- The plugin can capture bundle graph data directly from the output bundle without requiring `build.manifest`.
- GitHub Action inputs are string-only and weakly validated, so extra orchestration inputs add cost quickly.
- Keeping upload in the GitHub Action keeps GitHub context and secrets out of the plugin contract.
- Repeated-build support was starting to dominate the public API despite being an edge case.
- This keeps the main path aligned with a Vite-first, scenario-first product.

## Explicitly Deferred

These should be out of public v1:

- `run-id`
- public `environment` override
- repeated separate-build staging and finalization
- public repeated-build compatibility workflows
- public uploader or standalone upload CLI

## Adjacent Boundary

For action-defined synthetic-import scenarios, keep `scenario` as only the stable id in v1.

The richer synthetic-import definition format should be designed separately, not folded into this contract.

## Explicit Non-Goals

- V1 does not support combining several separate `vite build` executions into one logical scenario run.
- Repositories that need several separate builds to represent one scenario are out of scope for this contract.
