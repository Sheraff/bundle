import { spawnSync } from "node:child_process"

const result = spawnSync("pnpm", ["--filter", "@workspace/web", "build"], {
  env: {
    ...process.env,
    CLOUDFLARE_ENV: "staging",
  },
  stdio: "inherit",
})

process.exit(result.status ?? 1)
