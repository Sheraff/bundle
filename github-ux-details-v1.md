# GitHub UX Details V1

## Summary

- GitHub surfaces should be summary and decision surfaces, not the full investigation surface.
- V1 should publish one maintained PR comment and one aggregate required GitHub check per PR or commit group.
- The PR comment should use a fixed format in V1: impacted scenarios only, grouped by scenario, with one visible summary row per scenario.
- The visible row for a scenario should represent the highest-severity changed series, usually the worst unacknowledged regression, with a `+N more changed series` hint when more rows exist.
- The main PR comment call to action should be `Open PR diff`, linking to the repository compare page for the PR base and head.
- Each impacted scenario group should expose one inline `View diff` link to the filtered compare page for the visible series.
- The comment may update before all expected scenarios finish, but pending state should appear only as header counts rather than as placeholder scenario rows.
- Acknowledgements happen in the web app, stay item-scoped, and remain visible in GitHub with inline acknowledged badges or acknowledged counts.
- The aggregate check should stay lean and blocker-focused, explaining failures, acknowledgements, and partial state before sending users to the compare page.
- Repo-level PR comment density settings are out of V1, but they should be treated as an early post-V1 follow-on.

## Goals

This document resolves the V1 GitHub UX questions around:

- PR comment structure and density
- check granularity and merge gating
- acknowledgement location and visibility
- how GitHub surfaces should link into the public compare flow
- how to keep multi-scenario PRs readable without hiding important regressions

## Core GitHub Surface Model

V1 should use this GitHub surface model:

- one maintained PR comment
- one aggregate required GitHub check
- one primary deep-inspection destination: the public compare page
- shared derived comparison read models for comment, check, and dashboard surfaces

### Division of responsibility

GitHub should answer:

- did this PR regress anything
- what is blocking
- what was acknowledged
- where should I click next

The web app should answer:

- what exactly changed
- why it changed
- what the treemap, graph, and asset or package diff look like
- how the same series evolved over time

This keeps GitHub fast to scan and keeps the richer compare flow as the real inspection surface.

## PR Comment Contract

### Posting and update model

- Create one maintained comment per PR.
- Update the comment in place as new scenario runs are processed.
- Allow partial updates before all expected scenarios settle.
- Show header-level pending counts while processing is incomplete.
- Once processing settles, replace pending counts with final partial-state signals such as inherited or missing scenario counts when applicable.

### Top-level comment shape

The comment should have:

- an overall state line
- compact counts for blocking regressions, acknowledged regressions, improvements, pending scenarios, and partial-state warnings when present
- one primary `Open PR diff` link to the compare page for the PR base and head
- scenario groups for impacted scenarios only
- a compact omitted count for unchanged scenarios

Unchanged scenarios should not render as named rows in V1.

### Scenario grouping

The body should be scenario-first.

Each impacted scenario group should show:

- scenario name
- scenario kind or source chip when useful
- small inline status badges such as `blocking`, `acknowledged`, `improved`, or `+N more changed series`
- one visible summary row
- one inline `View diff` link

The group should not try to show every changed series in GitHub.

### Visible summary row

A scenario's one visible row should represent the highest-severity changed series in that scenario.

Selection order:

- unacknowledged failing regression
- unacknowledged warning regression
- acknowledged regression
- largest improvement

The row should fully qualify the measured subject:

- environment
- entrypoint
- lens
- current value
- baseline value
- absolute delta
- percentage delta
- budget state

If additional series changed inside the same scenario, the scenario group should show a compact `+N more changed series` hint rather than rendering all of them inline.

### Ordering

Scenario groups should be ordered by review urgency:

- blocking regressions
- acknowledged regressions
- partial-state or degraded warnings
- improvements

Within a section, order by severity then by delta magnitude.

### Deep links

The PR comment should use the link strategy already defined in `web-app-shape-v1.md`.

Required links:

- `Open PR diff` -> repository compare page for the current PR base and head
- `View diff` -> filtered compare page for the visible series row in one scenario group

The PR comment should not expose separate inline `Treemap`, `Graph`, or `Scenario history` links in V1. Those remain available after landing on the compare or scenario page.

### Pending and partial states

While expected scenarios are still processing:

- show only header-level pending counts
- do not create named pending placeholder rows
- keep impacted scenario groups limited to finished comparisons

After processing settles:

- surface inherited or missing scenario counts in the comment header or status area
- keep inherited and missing states non-blocking in V1
- link users to the compare page for the final commit-group explanation

## Aggregate Check Contract

### Granularity

V1 should publish one aggregate required GitHub check per PR or commit group.

V1 should not create:

- one required check per scenario
- one required check per series
- one required check per metric

This avoids check explosion in scenario-heavy repositories.

### Role

The aggregate check is primarily a merge-gating surface.

It should answer:

- is the PR blocked
- which items are blocking
- which items were acknowledged
- whether the result is still partial or pending
- where to click for full diff analysis

It should not become a second full report inside GitHub in V1.

### Content

The check should stay lean and blocker-focused.

It should include:

- overall pass or fail state
- compact counts for blocking regressions, acknowledged regressions, pending scenarios, inherited scenarios, and missing scenarios when applicable
- a short blocker list identifying scenario, environment, entrypoint, lens, and metric
- a short acknowledged list when acknowledgements exist
- a primary link to the compare page

Improvements may be summarized, but they do not need dense listing in the check surface.

### Blocking behavior

- Unacknowledged failing regressions block the check.
- Acknowledged regressions remain visible but do not block the check.
- Inherited, missing, or still-pending scenarios do not block in V1.
- Partial-state warnings remain visible in the check summary.

## Acknowledgement UX

### Scope

Acknowledgements stay item-scoped in V1.

An acknowledgement attaches to:

- one PR
- one comparison
- one series
- one metric or diff item key

It does not create a durable repo-wide or series-wide policy exception.

### Action location

The acknowledgement action should live in the web app, not in GitHub.

Primary acknowledgement entry points should be:

- the filtered compare page
- detail views under the selected series context

V1 should not require:

- slash commands
- comment buttons
- GitHub check action buttons
- repo config changes for one-off acknowledgements

### Visibility in GitHub

Acknowledged items must stay visible in GitHub after the next refresh.

Visibility rules:

- if the visible summary row is acknowledged, show an inline `Acknowledged` badge on that row
- if the scenario group contains additional acknowledged items beyond the visible row, show an inline acknowledged count on the scenario group
- show an optional short note preview when a note exists and it fits without bloating the comment
- keep acknowledged items in their normal scenario position rather than moving them into a separate hidden area

This keeps acknowledgements explicit without turning them into a separate workflow.

## Illustrative Comment Shape

```text
Bundle review: failing
3 blocking regressions  1 acknowledged  2 improvements  2 pending
Open PR diff

minimal-react-app  [blocking] [+2 more changed series]
client / main / entry-js-direct-css
46.8 kB vs 41.2 kB  (+5.6 kB, +13.6%)
View diff

export-foo-from-core  [acknowledged]
default / index / entry-js-direct-css
5.9 kB vs 5.2 kB  (+0.7 kB, +13.5%)  [Acknowledged]
View diff

7 unchanged scenarios omitted
```

The exact copy and visual styling can change during implementation, but this is the intended information density and hierarchy.

## Why This Shape Fits V1

- It matches the architecture rule that PR comments, checks, and dashboards consume the same derived comparison objects.
- It stays scenario-first instead of flattening the product into a generic metric list.
- It keeps GitHub useful in repositories with many scenarios by showing impacted scenarios only.
- It gives users a single blocking check that works cleanly with branch protection.
- It keeps acknowledgements explicit without forcing a GitHub-native interaction model into V1.
- It keeps the compare page as the main deep-diff destination, which matches the web-app information architecture already chosen.
- It leaves room for richer GitHub controls later without committing V1 to a heavy configuration surface.

## Explicit V1 Limits

- No repo-level PR comment layout settings yet.
- No per-scenario or per-series required checks.
- No named pending placeholder rows in PR comments.
- No inline `Treemap`, `Graph`, or history link set in the default PR comment.
- No GitHub-native acknowledgement buttons, slash commands, or check actions.
- No attempt to make the GitHub check surface a second full diff report.

## Early Follow-On Work

These are likely early post-V1 candidates:

- repo-level compact versus detailed PR comment setting
- optional secondary inline links such as `Treemap`
- better acknowledgement note presentation rules
- richer GitHub check presentation if users repeatedly avoid the compare page
- later GitHub-native acknowledgement actions if the web-only flow proves too indirect
