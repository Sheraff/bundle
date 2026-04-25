import { mkdtemp, writeFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { execFileSync } from "node:child_process"

const ids = {
  repo: "01ARZ3NDEKTSV4RRFFQ69G5FA0",
  scenario: "01ARZ3NDEKTSV4RRFFQ69G5FA1",
  baseGroup: "01ARZ3NDEKTSV4RRFFQ69G5FA2",
  headGroup: "01ARZ3NDEKTSV4RRFFQ69G5FA3",
  baseRun: "01ARZ3NDEKTSV4RRFFQ69G5FA4",
  headRun: "01ARZ3NDEKTSV4RRFFQ69G5FA5",
  series: "01ARZ3NDEKTSV4RRFFQ69G5FA6",
  basePoint: "01ARZ3NDEKTSV4RRFFQ69G5FA7",
  headPoint: "01ARZ3NDEKTSV4RRFFQ69G5FA8",
  comparison: "01ARZ3NDEKTSV4RRFFQ69G5FA9",
  summary: "01ARZ3NDEKTSV4RRFFQ69G5FAA",
}
const baseSha = "0123456789abcdef0123456789abcdef01234567"
const headSha = "1111111111111111111111111111111111111111"
const baseKey = `normalized/scenario-runs/${ids.baseRun}/snapshot.json`
const headKey = `normalized/scenario-runs/${ids.headRun}/snapshot.json`

const baseSnapshot = buildSnapshot(ids.baseRun, ids.baseGroup, baseSha, { raw: 140, gzip: 55, brotli: 46 })
const headSnapshot = buildSnapshot(ids.headRun, ids.headGroup, headSha, { raw: 190, gzip: 74, brotli: 62 })
const summary = buildSummary()

const tempDir = await mkdtemp(path.join(tmpdir(), "chunk-scope-seed-"))
try {
  const sqlPath = path.join(tempDir, "seed.sql")
  const basePath = path.join(tempDir, "base-snapshot.json")
  const headPath = path.join(tempDir, "head-snapshot.json")
  await writeFile(sqlPath, buildSql(), "utf8")
  await writeFile(basePath, `${JSON.stringify(baseSnapshot, null, 2)}\n`, "utf8")
  await writeFile(headPath, `${JSON.stringify(headSnapshot, null, 2)}\n`, "utf8")

  run("wrangler", ["d1", "migrations", "apply", "DB", "--local"])
  run("wrangler", ["d1", "execute", "DB", "--local", "--file", sqlPath])
  run("wrangler", ["r2", "object", "put", `bundle-cache/${baseKey}`, "--local", "--file", basePath, "--content-type", "application/json"])
  run("wrangler", ["r2", "object", "put", `bundle-cache/${headKey}`, "--local", "--file", headPath, "--content-type", "application/json"])
} finally {
  await rm(tempDir, { recursive: true, force: true })
}

console.log("Seeded local Chunk Scope demo data at /r/acme/widget")

function run(command, args) {
  execFileSync(command, args, { stdio: "inherit", cwd: path.resolve(import.meta.dirname, "..") })
}

function buildSql() {
  const now = "2026-04-07T12:00:00.000Z"
  return `
DELETE FROM commit_group_summaries WHERE repository_id = '${ids.repo}';
DELETE FROM comparisons WHERE repository_id = '${ids.repo}';
DELETE FROM series_points WHERE repository_id = '${ids.repo}';
DELETE FROM series WHERE repository_id = '${ids.repo}';
DELETE FROM scenario_runs WHERE repository_id = '${ids.repo}';
DELETE FROM commit_groups WHERE repository_id = '${ids.repo}';
DELETE FROM scenarios WHERE repository_id = '${ids.repo}';
DELETE FROM repositories WHERE id = '${ids.repo}';
INSERT INTO repositories (id, github_repo_id, owner, name, installation_id, enabled, visibility, created_at, updated_at) VALUES ('${ids.repo}', 123, 'acme', 'widget', 456, 1, 'public', '${now}', '${now}');
INSERT INTO scenarios (id, repository_id, slug, source_kind, created_at, updated_at) VALUES ('${ids.scenario}', '${ids.repo}', 'fixture-app-cost', 'fixture-app', '${now}', '${now}');
INSERT INTO commit_groups (id, repository_id, commit_sha, branch, status, latest_upload_at, created_at, updated_at) VALUES ('${ids.baseGroup}', '${ids.repo}', '${baseSha}', 'main', 'settled', '2026-04-07T12:00:00.000Z', '${now}', '${now}');
INSERT INTO commit_groups (id, repository_id, commit_sha, branch, status, latest_upload_at, created_at, updated_at) VALUES ('${ids.headGroup}', '${ids.repo}', '${headSha}', 'main', 'settled', '2026-04-08T12:00:00.000Z', '${now}', '${now}');
${scenarioRunSql(ids.baseRun, ids.baseGroup, baseSha, baseKey, "2026-04-07T12:00:00.000Z")}
${scenarioRunSql(ids.headRun, ids.headGroup, headSha, headKey, "2026-04-08T12:00:00.000Z")}
INSERT INTO series (id, repository_id, scenario_id, environment, entrypoint_key, entrypoint_kind, lens, created_at, updated_at) VALUES ('${ids.series}', '${ids.repo}', '${ids.scenario}', 'default', 'src/main.ts', 'entry', 'entry-js-direct-css', '${now}', '${now}');
INSERT INTO series_points (id, repository_id, series_id, scenario_run_id, commit_group_id, commit_sha, branch, measured_at, entry_js_raw_bytes, entry_js_gzip_bytes, entry_js_brotli_bytes, direct_css_raw_bytes, direct_css_gzip_bytes, direct_css_brotli_bytes, total_raw_bytes, total_gzip_bytes, total_brotli_bytes, created_at, updated_at) VALUES ('${ids.basePoint}', '${ids.repo}', '${ids.series}', '${ids.baseRun}', '${ids.baseGroup}', '${baseSha}', 'main', '2026-04-07T12:00:00.000Z', 140, 55, 46, 10, 8, 6, 150, 63, 52, '${now}', '${now}');
INSERT INTO series_points (id, repository_id, series_id, scenario_run_id, commit_group_id, commit_sha, branch, measured_at, entry_js_raw_bytes, entry_js_gzip_bytes, entry_js_brotli_bytes, direct_css_raw_bytes, direct_css_gzip_bytes, direct_css_brotli_bytes, total_raw_bytes, total_gzip_bytes, total_brotli_bytes, created_at, updated_at) VALUES ('${ids.headPoint}', '${ids.repo}', '${ids.series}', '${ids.headRun}', '${ids.headGroup}', '${headSha}', 'main', '2026-04-08T12:00:00.000Z', 190, 74, 62, 12, 9, 7, 202, 83, 69, '${now}', '${now}');
INSERT INTO comparisons (id, repository_id, series_id, head_scenario_run_id, base_scenario_run_id, head_commit_group_id, base_commit_group_id, kind, status, requested_base_sha, requested_head_sha, selected_base_commit_sha, selected_head_commit_sha, current_total_raw_bytes, current_total_gzip_bytes, current_total_brotli_bytes, baseline_total_raw_bytes, baseline_total_gzip_bytes, baseline_total_brotli_bytes, delta_total_raw_bytes, delta_total_gzip_bytes, delta_total_brotli_bytes, selected_entrypoint_relation, selected_entrypoint_confidence, selected_entrypoint_evidence_json, stable_identity_summary_json, has_degraded_stable_identity, budget_state, created_at, updated_at) VALUES ('${ids.comparison}', '${ids.repo}', '${ids.series}', '${ids.headRun}', '${ids.baseRun}', '${ids.headGroup}', '${ids.baseGroup}', 'branch-previous', 'materialized', '${baseSha}', '${headSha}', '${baseSha}', '${headSha}', 202, 83, 69, 150, 63, 52, 52, 20, 17, 'same', 'high', '{}', '{}', 0, 'not-configured', '${now}', '${now}');
INSERT INTO commit_group_summaries (id, repository_id, commit_group_id, commit_sha, branch, status, latest_upload_at, quiet_window_deadline, settled_at, expected_scenario_count, fresh_scenario_count, pending_scenario_count, inherited_scenario_count, missing_scenario_count, failed_scenario_count, impacted_scenario_count, unchanged_scenario_count, comparison_count, changed_metric_count, no_baseline_series_count, failed_comparison_count, degraded_comparison_count, summary_json, created_at, updated_at) VALUES ('${ids.summary}', '${ids.repo}', '${ids.headGroup}', '${headSha}', 'main', 'settled', '2026-04-08T12:00:00.000Z', '2026-04-08T12:05:00.000Z', '2026-04-08T12:05:00.000Z', 1, 1, 0, 0, 0, 0, 1, 0, 1, 3, 0, 0, 0, ${sqlString(JSON.stringify(summary))}, '${now}', '${now}');
`
}

function scenarioRunSql(id, groupId, sha, key, uploadedAt) {
  return `INSERT INTO scenario_runs (id, repository_id, scenario_id, commit_group_id, commit_sha, branch, status, scenario_source_kind, artifact_scenario_kind, upload_dedupe_key, raw_artifact_r2_key, raw_envelope_r2_key, artifact_sha256, envelope_sha256, artifact_size_bytes, envelope_size_bytes, artifact_schema_version, upload_schema_version, ci_provider, ci_workflow_run_id, normalized_snapshot_r2_key, normalized_schema_version, normalized_at, uploaded_at, created_at, updated_at) VALUES ('${id}', '${ids.repo}', '${ids.scenario}', '${groupId}', '${sha}', 'main', 'processed', 'fixture-app', 'fixture-app', 'seed:${id}', 'raw/${id}/artifact.json', 'raw/${id}/envelope.json', 'artifact-${id}', 'envelope-${id}', 100, 100, 1, 1, 'github-actions', '${id.slice(-4)}', '${key}', 1, '${uploadedAt}', '${uploadedAt}', '${uploadedAt}', '${uploadedAt}');`
}

function buildSummary() {
  return {
    schemaVersion: 1,
    repositoryId: ids.repo,
    commitGroupId: ids.headGroup,
    pullRequestId: null,
    comparisonKind: "branch-previous",
    commitSha: headSha,
    branch: "main",
    status: "settled",
    quietWindowDeadline: "2026-04-08T12:05:00.000Z",
    settledAt: "2026-04-08T12:05:00.000Z",
    counts: { expectedScenarioCount: 1, freshScenarioCount: 1, pendingScenarioCount: 0, inheritedScenarioCount: 0, missingScenarioCount: 0, failedScenarioCount: 0, impactedScenarioCount: 1, unchangedScenarioCount: 0, comparisonCount: 1, changedMetricCount: 3, noBaselineSeriesCount: 0, failedComparisonCount: 0, degradedComparisonCount: 0 },
    freshScenarioGroups: [{ scenarioId: ids.scenario, scenarioSlug: "fixture-app-cost", sourceKind: "fixture-app", activeScenarioRunId: ids.headRun, activeCommitSha: headSha, activeUploadedAt: "2026-04-08T12:00:00.000Z", totalRunCount: 2, processedRunCount: 2, failedRunCount: 0, hasMultipleProcessedRuns: false, hasNewerFailedRun: false, latestFailedScenarioRunId: null, latestFailedAt: null, latestFailureCode: null, latestFailureMessage: null, series: [{ comparisonId: ids.comparison, seriesId: ids.series, scenarioRunId: ids.headRun, environment: "default", entrypoint: "src/main.ts", entrypointKind: "entry", lens: "entry-js-direct-css", requestedBaseSha: baseSha, selectedBaseCommitSha: baseSha, selectedHeadCommitSha: headSha, currentTotals: { raw: 202, gzip: 83, brotli: 69 }, baselineTotals: { raw: 150, gzip: 63, brotli: 52 }, deltaTotals: { raw: 52, gzip: 20, brotli: 17 }, budgetState: "not-configured", hasDegradedStableIdentity: false, selectedEntrypointRelation: "same", status: "materialized", items: [{ itemKey: "metric:total-gzip-bytes", metricKey: "total-gzip-bytes", currentValue: 83, baselineValue: 63, deltaValue: 20, percentageDelta: 31.746, direction: "regression" }, { itemKey: "metric:total-raw-bytes", metricKey: "total-raw-bytes", currentValue: 202, baselineValue: 150, deltaValue: 52, percentageDelta: 34.666, direction: "regression" }, { itemKey: "metric:total-brotli-bytes", metricKey: "total-brotli-bytes", currentValue: 69, baselineValue: 52, deltaValue: 17, percentageDelta: 32.692, direction: "regression" }] }] }],
    statusScenarios: [],
  }
}

function buildSnapshot(runId, groupId, sha, mainSizes) {
  return {
    schemaVersion: 1,
    normalizedAt: "2026-04-08T12:00:00.000Z",
    scenarioRunId: runId,
    repositoryId: ids.repo,
    commitGroupId: groupId,
    scenario: { id: "fixture-app-cost", kind: "fixture-app" },
    scenarioSource: { kind: "fixture-app" },
    repository: { githubRepoId: 123, owner: "acme", name: "widget", installationId: 456 },
    git: { commitSha: sha, branch: "main" },
    ci: { provider: "github-actions", workflowRunId: runId.slice(-4), workflowRunAttempt: 1, job: "build", actionVersion: "dev" },
    build: { bundler: "vite", bundlerVersion: "8.0.4", pluginVersion: "0.1.0", generatedAt: "2026-04-08T12:00:00.000Z", rootDir: "/tmp/repo" },
    raw: { artifactR2Key: `raw/${runId}/artifact.json`, envelopeR2Key: `raw/${runId}/envelope.json`, artifactSha256: `artifact-${runId}`, envelopeSha256: `envelope-${runId}`, artifactSchemaVersion: 1, uploadSchemaVersion: 1 },
    environments: [{ name: "default", build: { outDir: "dist" }, entrypoints: [{ key: "src/main.ts", kind: "entry", chunkFileName: "assets/main.js", manifestSourceKeys: ["src/main.ts"], facadeModule: { rawId: "/tmp/repo/src/main.ts", stableId: "app:src/main.ts", scope: "app" }, importedCss: ["assets/main.css"], importedAssets: [], staticImportedChunkFileNames: ["assets/vendor.js"], dynamicImportedChunkFileNames: ["assets/settings.js"] }], chunks: [{ fileName: "assets/main.js", fileLabel: "main.js", name: "main", isEntry: true, isDynamicEntry: false, facadeModule: { rawId: "/tmp/repo/src/main.ts", stableId: "app:src/main.ts", scope: "app" }, manifestSourceKeys: ["src/main.ts"], ownerRoots: ["src/main.ts"], imports: ["assets/vendor.js"], dynamicImports: ["assets/settings.js"], implicitlyLoadedBefore: [], importedCss: ["assets/main.css"], importedAssets: [], moduleIds: ["/tmp/repo/src/main.ts"], totalRenderedLength: mainSizes.raw, sizes: mainSizes, modules: [{ rawId: "/tmp/repo/src/main.ts", stableId: "app:src/main.ts", scope: "app", renderedLength: mainSizes.raw, originalLength: 320 }] }, { fileName: "assets/vendor.js", fileLabel: "vendor.js", name: "vendor", isEntry: false, isDynamicEntry: false, facadeModule: null, manifestSourceKeys: [], ownerRoots: ["src/main.ts"], imports: [], dynamicImports: [], implicitlyLoadedBefore: [], importedCss: [], importedAssets: [], moduleIds: ["/tmp/repo/node_modules/react/index.js"], totalRenderedLength: 80, sizes: { raw: 80, gzip: 30, brotli: 25 }, modules: [{ rawId: "/tmp/repo/node_modules/react/index.js", stableId: "pkg:react:index", scope: "package", renderedLength: 80, originalLength: 100 }] }, { fileName: "assets/settings.js", fileLabel: "settings.js", name: "settings", isEntry: false, isDynamicEntry: true, facadeModule: null, manifestSourceKeys: [], ownerRoots: ["src/main.ts"], imports: [], dynamicImports: [], implicitlyLoadedBefore: [], importedCss: [], importedAssets: [], moduleIds: ["/tmp/repo/src/settings.ts"], totalRenderedLength: 30, sizes: { raw: 30, gzip: 12, brotli: 10 }, modules: [{ rawId: "/tmp/repo/src/settings.ts", stableId: "app:src/settings.ts", scope: "app", renderedLength: 30, originalLength: 48 }] }], assets: [{ fileName: "assets/main.css", fileLabel: "main.css", kind: "css", names: ["main.css"], originalFileNames: [], sourceKeys: [], importerKeys: [], importerFiles: ["assets/main.js"], ownerRoots: ["assets/main.js"], needsCodeReference: false, sizes: { raw: 12, gzip: 9, brotli: 7 } }], packages: [{ packageName: "react", moduleCount: 1, renderedLength: 80 }], chunkGraphEdges: [{ kind: "static-import", fromChunkFileName: "assets/main.js", toChunkFileName: "assets/vendor.js" }, { kind: "dynamic-import", fromChunkFileName: "assets/main.js", toChunkFileName: "assets/settings.js" }], assetRelations: [{ kind: "css", chunkFileName: "assets/main.js", assetFileName: "assets/main.css" }], warnings: [] }],
  }
}

function sqlString(value) {
  return `'${value.replaceAll("'", "''")}'`
}
