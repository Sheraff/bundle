# Synthetic-Import Product Shape V1

## Summary

- Synthetic-import scenarios should grow as a saved CI checks product area, not as a general hosted bundler or sandbox.
- The product shape should sit closer to `size-limit` than to `bundlejs`.
- Raw ESM remains the canonical saved definition.
- The long-term saved model is `ESM source + metadata`, not a separate structured scenario schema.
- The main synthetic-import management surface in the hosted app should be a scenario catalog, not a one-off editor.
- Core saved fields are stable scenario id, display name, raw ESM source, and budgets.
- Workflow YAML remains the repo-owned definition path. A dedicated repo config file is not needed.
- Hosted UI and workflow YAML should support mostly the same synthetic-import shape over time.
- The hosted UI should validate definitions, but real measurement still happens in CI.
- If a repo-defined and hosted synthetic scenario share an id, the repo-defined scenario is the effective one and the UI should show one row with an override notice.
- Hosted synthetic scenarios follow the same manual archive-only lifecycle as other scenarios.
- If richer synthetic settings are added later, they should live behind a hidden advanced panel rather than in the normal authoring flow.
- `aliases` is the most sandbox-like advanced knob and should likely wait until after V1 unless a strong recurring repo need appears.

## Goals

This document resolves the V1 product-shape questions around:

- how far synthetic-import scenarios should grow as a product area
- whether richer configuration should replace raw inline ESM
- how multiple synthetic scenarios should be authored and managed over time
- whether repo-versioned config should move outside workflow YAML
- what the hosted UI should expose beyond `scenario` plus `source`

## Product Positioning

Synthetic-import scenarios should be a maintained repository checks surface.

They are for questions like:

- what is the bundled cost of importing a specific public API shape
- how does that cost change over time
- did a pull request regress a known import path or package entry

They should not become a generic hosted playground for arbitrary bundler experiments.

Important product rules:

- optimize for repeatable saved checks, not one-off experiments
- keep scenarios understandable months after they were created
- prefer a small durable definition surface over a broad bundler configuration surface
- keep synthetic-import scenarios inside the same scenario-first product model as fixture-app scenarios

## Canonical Definition Model

### Saved definition

The canonical saved definition should stay:

- stable scenario id
- metadata
- raw ESM source

Example:

```js
export { Button } from '@acme/ui'
```

This means:

- raw ESM remains the one real measurement definition
- the product should not introduce a separate structured synthetic scenario schema in V1
- later helper UI, if ever added, should generate or edit that same ESM rather than replace it

### Core saved metadata

The main saved metadata for synthetic-import scenarios should be:

- stable scenario id
- display name
- budgets

No additional helper layer is required by default.

The product does not need a package/export picker, starter template library, or builder-style flow as part of the default model.

## Authoring Surfaces

### Repository-defined scenarios

Repository-defined synthetic-import scenarios should continue to live in workflow YAML or equivalent action inputs.

V1 should not introduce a separate mandatory repo config file for them.

This is the chosen repo-owned path even if repositories eventually carry many synthetic scenarios.

### Hosted scenarios

The hosted app should support defining synthetic-import scenarios directly.

Hosted definitions are useful for:

- adding quick checks without a repository change
- trying a new maintained check before deciding whether to version it in the repo
- managing a repository's synthetic scenario catalog in one product surface

Hosted definitions are still saved checks, not temporary sandbox sessions.

### Shape parity

Hosted UI and workflow YAML should support mostly the same synthetic-import shape over time.

Repo-owned scenarios should not become materially weaker than hosted ones.

## Hosted UI Model

### Scenario catalog

The main hosted UI surface should be a synthetic scenario catalog.

Important V1 distinction:

- this is an authenticated management surface for synthetic scenarios
- it is not a second competing public repository scenario catalog
- the public repository overview continues to show one repository-wide scenario catalog across all scenario kinds

It should support:

- listing synthetic-import scenarios
- creating a new scenario
- editing an existing scenario
- archiving a scenario
- finding and filtering scenarios as the set grows

The product should not center the hosted synthetic flow on a single freeform code editor page with weak long-term management.

### Core hosted fields

The hosted UI should expose these main fields:

- scenario id
- display name
- raw ESM source
- budgets

### Immediate feedback

After a hosted synthetic scenario is edited, the hosted UI should validate it.

That means:

- syntax and configuration validation in the UI is valuable
- real measurement should still happen in CI
- the product does not need a hosted preview build or measurement run in the normal V1 flow

## Richer Synthetic Settings

If richer synthetic settings are added beyond the core `id + display name + source + budgets` shape, they should appear in a hidden advanced panel.

They should be treated as escape hatches for recurring real-world repo problems, not as the main authoring model.

### Strongest candidates

The most product-shaped advanced settings are:

- externalized packages
- resolve conditions
- explicit prod or dev defines

Why these fit better:

- they solve real library measurement cases
- they still preserve the mental model of a maintained import-cost check
- they do not immediately turn the feature into a general-purpose bundler UI

### Alias support

`aliases` may still become worth supporting, but it is the most sandbox-like advanced knob.

It makes the feature feel much closer to a hosted bundle lab because it enables arbitrary import rewrites and shims.

Because of that, alias support should likely wait until after V1 unless a strong recurring repository need justifies it.

## Precedence And Catalog Behavior

If a repo-defined synthetic-import scenario and a hosted synthetic-import scenario share the same stable id:

- the repo-defined scenario is the effective definition
- the hosted definition is shadowed
- the catalog should show one effective row, not two competing rows
- the UI should show a clear notice that a hosted definition exists but is overridden by the repo definition

Catalog behavior rule:

- public repository scenario catalogs should filter and label that effective row by its effective source of truth, which is `repo`
- the authenticated synthetic management surface should additionally show the override notice and the shadowed hosted definition state

This keeps the catalog understandable and preserves repository-owned definitions as the higher-trust source of truth.

## Lifecycle

Hosted synthetic-import scenarios should follow the same lifecycle rule as the rest of the scenario catalog:

- scenarios remain expected until manually archived
- V1 does not auto-retire scenarios
- V1 does not need a normal hard-delete path

History should remain preserved through archive semantics rather than deletion semantics.

## Explicit Non-Goals

These should stay out of the synthetic-import product shape for V1:

- turning the product into a general online bundler
- broad bundle-lab controls as part of the normal flow
- shareable hosted bundle sessions as a primary product concept
- hosted preview measurements before CI as the normal path
- a new dedicated repo config file for synthetic-import scenarios
- alias support unless a later post-V1 need proves strong enough
