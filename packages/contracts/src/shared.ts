import * as v from "valibot";

export const SCHEMA_VERSION_V1 = 1 as const;

export const BUNDLE_ARTIFACT_OUTPUT_ENV_VAR = "BUNDLE_ARTIFACT_OUTPUT" as const;

export const DEFAULT_ARTIFACT_RELATIVE_PATH = ".bundle/artifact.json" as const;

export const DEFAULT_LENS_SLUG = "entry-js-direct-css" as const;

export const PLUGIN_SCENARIO_KINDS = [
	"fixture-app",
	"synthetic-import",
] as const;
export const SCENARIO_SOURCE_KINDS = [
	"fixture-app",
	"repo-synthetic",
	"hosted-synthetic",
] as const;
export const CI_PROVIDERS = ["github-actions"] as const;
export const SCENARIO_RUN_STATUSES = [
	"queued",
	"processing",
	"processed",
	"failed",
] as const;
export const QUEUE_KINDS = [
	"normalize-run",
	"derive-run",
	"schedule-comparisons",
	"materialize-comparison",
	"refresh-summaries",
	"publish-github",
	"generate-detail",
] as const;
export const WORKFLOW_KINDS = [
	"CommitGroupSettlementWorkflow",
	"PrPublishDebounceWorkflow",
	"RepositoryBackfillWorkflow",
] as const;
export const DETAIL_KINDS = ["treemap", "graph", "waterfall"] as const;

const ISO_TIMESTAMP_REGEX = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;
const ULID_REGEX = /^[0-7][0-9A-HJKMNP-TV-Za-hjkmnp-tv-z]{25}$/;
const SCENARIO_SLUG_REGEX = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const GIT_SHA_REGEX = /^[0-9a-f]{40}$/i;
const GITHUB_OWNER_REGEX = /^[A-Za-z\d](?:[A-Za-z\d-]{0,38})$/;
const GITHUB_REPO_REGEX = /^[A-Za-z\d_.-]+$/;

export const schemaVersionV1Schema = v.literal(SCHEMA_VERSION_V1);

export const nonEmptyStringSchema = v.pipe(v.string(), v.nonEmpty());

export const noteSchema = v.pipe(v.string(), v.maxLength(4000));

export const isoTimestampSchema = v.pipe(
	nonEmptyStringSchema,
	v.regex(ISO_TIMESTAMP_REGEX, "Expected an ISO-8601 UTC timestamp"),
);

export const ulidSchema = v.pipe(
	nonEmptyStringSchema,
	v.regex(ULID_REGEX, "Expected a ULID"),
);

export const scenarioSlugSchema = v.pipe(
	nonEmptyStringSchema,
	v.regex(SCENARIO_SLUG_REGEX, "Expected a stable slug-like scenario id"),
);

export const gitShaSchema = v.pipe(
	nonEmptyStringSchema,
	v.regex(GIT_SHA_REGEX, "Expected a full git commit SHA"),
);

export const githubOwnerSchema = v.pipe(
	nonEmptyStringSchema,
	v.regex(GITHUB_OWNER_REGEX, "Expected a valid GitHub owner"),
);

export const githubRepoNameSchema = v.pipe(
	nonEmptyStringSchema,
	v.regex(GITHUB_REPO_REGEX, "Expected a valid GitHub repository name"),
);

export const positiveIntegerSchema = v.pipe(
	v.number(),
	v.integer(),
	v.minValue(1),
);

export const nonNegativeIntegerSchema = v.pipe(
	v.number(),
	v.integer(),
	v.minValue(0),
);

export const nonEmptyStringArraySchema = v.pipe(
	v.array(nonEmptyStringSchema),
	v.nonEmpty(),
);

export const stringRecordSchema = v.record(
	nonEmptyStringSchema,
	nonEmptyStringSchema,
);

export const nonAllStringSchema = v.pipe(
	nonEmptyStringSchema,
	v.check(
		(value) => value !== "all",
		'"all" is only valid on history and scenario pages',
	),
);

export type DetailKind = (typeof DETAIL_KINDS)[number];
export type QueueKind = (typeof QUEUE_KINDS)[number];
export type ScenarioRunStatus = (typeof SCENARIO_RUN_STATUSES)[number];
export type WorkflowKind = (typeof WORKFLOW_KINDS)[number];
