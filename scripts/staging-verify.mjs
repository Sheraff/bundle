import { spawnSync } from "node:child_process"

const origin = "https://chunk-scope-web-staging.me-b16.workers.dev"

run("curl", ["-fsS", `${origin}/healthz`])
run("pnpm", [
  "--dir",
  "apps/web",
  "exec",
  "wrangler",
  "d1",
  "execute",
  "DB",
  "--env",
  "staging",
  "--remote",
  "--command",
  "select owner, name, enabled, visibility from repositories order by updated_at desc limit 10",
])
run("pnpm", [
  "--dir",
  "apps/web",
  "exec",
  "wrangler",
  "d1",
  "execute",
  "DB",
  "--env",
  "staging",
  "--remote",
  "--command",
  "select commit_sha, branch, status, ci_workflow_run_id, failure_code from scenario_runs order by created_at desc limit 10",
])
run("pnpm", [
  "--dir",
  "apps/web",
  "exec",
  "wrangler",
  "d1",
  "execute",
  "DB",
  "--env",
  "staging",
  "--remote",
  "--command",
  "select surface, status, external_url, published_head_sha, last_error_code from github_publications order by updated_at desc limit 10",
])

function run(command, args) {
  const result = spawnSync(command, args, { stdio: "inherit" })

  if (result.status !== 0) {
    process.exit(result.status ?? 1)
  }
}
