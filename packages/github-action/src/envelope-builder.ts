import { SCHEMA_VERSION_V1 } from "@workspace/contracts/shared";
import {
	uploadScenarioRunEnvelopeV1Schema,
	type UploadScenarioRunEnvelopeV1,
} from "@workspace/contracts/upload-envelope";
import { type PluginArtifactV1 } from "@workspace/contracts/plugin-artifact";
import * as v from "valibot";

import { type GithubActionContext } from "./github-context.js";
import { type ActionInputs } from "./inputs.js";
import { formatIssues } from "./parsing.js";

export function buildUploadEnvelope(
	parsedInputs: ActionInputs,
	artifact: PluginArtifactV1,
	githubContext: GithubActionContext,
): UploadScenarioRunEnvelopeV1 {
	const candidateEnvelope = {
		schemaVersion: SCHEMA_VERSION_V1,
		artifact,
		repository: githubContext.repository,
		git: githubContext.git,
		...(githubContext.pullRequest
			? { pullRequest: githubContext.pullRequest }
			: {}),
		ci: githubContext.ci,
		...(parsedInputs.mode === "fixture-app"
			? {
					scenarioSource: {
						kind: "fixture-app" as const,
					},
				}
			: {
					scenarioSource: {
						kind: "repo-synthetic" as const,
					},
					syntheticDefinition: {
						source: parsedInputs.source,
					},
				}),
	};

	const result = v.safeParse(
		uploadScenarioRunEnvelopeV1Schema,
		candidateEnvelope,
	);

	if (!result.success) {
		throw new Error(
			`Generated upload envelope is invalid: ${formatIssues(result.issues)}`,
		);
	}

	return result.output;
}
