import { spawnSync } from "node:child_process"
import { readFileSync } from "node:fs"

const build = spawnSync("pnpm", ["staging:build"], { stdio: "inherit" })

if (build.status !== 0) {
  process.exit(build.status ?? 1)
}

const config = JSON.parse(readFileSync("apps/web/dist/server/wrangler.json", "utf8"))
const failures = []

if (config.targetEnvironment !== "staging") {
  failures.push(`targetEnvironment is ${JSON.stringify(config.targetEnvironment)}`)
}

if (config.name !== "chunk-scope-web-staging") {
  failures.push(`worker name is ${JSON.stringify(config.name)}`)
}

if (config.vars?.PUBLIC_APP_ORIGIN !== "https://chunk-scope-web-staging.me-b16.workers.dev") {
  failures.push("PUBLIC_APP_ORIGIN does not point at staging")
}

for (const queue of [
  ...(config.queues?.producers ?? []).map((producer) => producer.queue),
  ...(config.queues?.consumers ?? []).map((consumer) => consumer.queue),
]) {
  if (!queue.includes("chunk-scope-staging-")) {
    failures.push(`queue ${JSON.stringify(queue)} is not a staging queue`)
  }
}

for (const workflow of config.workflows ?? []) {
  if (!workflow.name.includes("chunk-scope-staging-")) {
    failures.push(`workflow ${JSON.stringify(workflow.name)} is not a staging workflow`)
  }
}

for (const database of config.d1_databases ?? []) {
  if (database.database_name !== "chunk-scope-staging") {
    failures.push(`D1 database ${JSON.stringify(database.database_name)} is not staging`)
  }
}

for (const bucket of config.r2_buckets ?? []) {
  if (!bucket.bucket_name.includes("chunk-scope-staging-")) {
    failures.push(`R2 bucket ${JSON.stringify(bucket.bucket_name)} is not staging`)
  }
}

if (failures.length > 0) {
  console.error("Refusing to deploy because the generated Wrangler config is not staging-safe:")
  for (const failure of failures) {
    console.error(`- ${failure}`)
  }
  process.exit(1)
}

const deploy = spawnSync("pnpm", ["--dir", "apps/web", "exec", "wrangler", "deploy", "--env", "staging"], {
  env: {
    ...process.env,
    CLOUDFLARE_ENV: "staging",
  },
  stdio: "inherit",
})

process.exit(deploy.status ?? 1)
