# Next Steps Todo

Ordered from highest leverage to lower-priority follow-on work, based on the current codebase and the V1 plans.

## 1. Close the PR acknowledgement loop

- Add auth/session handling for write actions.
- Add repository permission checks for acknowledgement writes.
- Implement the `acknowledgeComparisonItem` mutation against the `acknowledgements` table.
- Add acknowledgement and note controls to the PR compare page.
- Refresh PR review summaries and republish GitHub surfaces after an acknowledgement write.
- Add tests for the mutation, authorization, and summary refresh flow.

## 2. Implement the repository history page

- Add the missing public route for `/r/$owner/$repo/history`.
- Support the planned URL filters: `branch`, `scenario`, `env`, `entrypoint`, and `lens`.
- Reuse existing summary/read-model helpers where possible instead of creating parallel loaders.
- Start with a solid history-first data view, then layer richer visualization later.

## 3. Fill in scenario and compare detail tabs

- Replace placeholder detail tabs on the scenario and compare pages.
- Add treemap diff views backed by the stable-identity outputs.
- Add graph and supporting asset/package diff views.
- Surface degraded stable-identity evidence clearly in the UI.

## 4. Implement real budget evaluation

- Replace the current hardcoded `not-configured` budget state.
- Define the V1 budget configuration shape and persistence path.
- Evaluate comparison items into blocking, warning, or passing states.
- Feed those states through compare pages, PR summaries, and GitHub checks.

## 5. Add the GitHub webhook and auth-exchange path

- Implement `POST /api/v1/github/webhooks`.
- Sync or refresh repository and PR metadata from GitHub events.
- Wire the webhook flow into the existing commit-group and publication pipeline.
- Finish the short-lived upload auth exchange if it is still part of the chosen infra path.

## 6. Build hosted synthetic scenario management

- Add authenticated repository management routes under `/app/repositories/...`.
- Implement hosted synthetic scenario create, update, list, and archive flows.
- Persist hosted definitions and show override behavior against repo-defined scenarios.
- Keep measurement in CI; treat the hosted UI as catalog and configuration management.

## 7. Upgrade the public dashboard UX

- Improve the repository overview beyond basic tables and text.
- Add the stronger filtering and scanning experience described in the plans.
- Make compare and scenario pages easier to scan for multi-series repositories.
- Improve loading, empty, and partial-state presentation.

## 8. Harden the product path end to end

- Add broader integration coverage for upload -> normalize -> derive -> compare -> summary -> publish.
- Add route-level tests for new pages and mutations.
- Tighten error handling and observability around queues, workflows, and GitHub publishing.
- Run `pnpm check` regularly as features land and keep the workspace green.
