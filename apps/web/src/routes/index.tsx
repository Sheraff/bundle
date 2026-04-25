import { createFileRoute } from "@tanstack/react-router"

export const Route = createFileRoute("/")({
  component: HomeRouteComponent,
})

function HomeRouteComponent() {
  return (
    <main>
      <section>
        <h1>Chunk Scope</h1>
        <p>Chunk Scope tracks how Vite bundle size changes across scenarios, branches, and pull requests.</p>
      </section>

      <section>
        <h2>How It Works</h2>
        <ol>
          <li>Add the Chunk Scope Vite plugin to emit normalized bundle snapshots.</li>
          <li>Run the Chunk Scope GitHub Action on pushes and pull requests.</li>
          <li>Install the GitHub App so PR comments and checks can be published.</li>
          <li>Use public repository dashboards to inspect trends, scenarios, comparisons, and acknowledgements.</li>
        </ol>
      </section>

      <section>
        <h2>Quick Start</h2>
        <pre>{`pnpm add -D git+https://github.com/Sheraff/bundle.git#staging&path:packages/vite-plugin

// vite.config.ts
import { bundleTracker } from "@chunk-scope/vite-plugin"

export default {
  plugins: [bundleTracker({ scenario: { id: "main-app", kind: "fixture-app" } })],
}`}</pre>
        <p>Then add the staged GitHub Action from <code>Sheraff/bundle/packages/github-action@staging</code>.</p>
      </section>

      <section>
        <h2>Inspect</h2>
        <p>Repository pages expose trend graphs, scenario history, pairwise compares, treemaps, dependency graphs, build-time waterfalls, asset/package/module tables, budgets, and PR acknowledgements.</p>
      </section>

      <section>
        <h2>Demo And Setup</h2>
        <p><a href="https://github.com/Sheraff/bundle-test">Open the smoke repository</a>.</p>
        <p><a href="/app/setup">Open setup guide</a> or <a href="/api/v1/auth/github/start?redirect_to=/app">sign in with GitHub</a>.</p>
      </section>

      <section>
        <h2>Current Limits</h2>
        <p>Chunk Scope is pre-production. This pass targets public GitHub repositories, Vite builds, and the staging package/action channel first.</p>
      </section>
    </main>
  )
}
