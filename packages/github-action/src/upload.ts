import {
	nonEmptyStringSchema,
	positiveIntegerSchema,
} from "@workspace/contracts/shared";
import { type UploadScenarioRunEnvelopeV1 } from "@workspace/contracts/upload-envelope";
import * as v from "valibot";

import { formatIssues, normalizeTrimmedInput } from "./parsing.js";

const uploadEnvironmentSchema = v.strictObject({
	BUNDLE_API_ORIGIN: nonEmptyStringSchema,
	BUNDLE_INSTALLATION_ID: nonEmptyStringSchema,
	BUNDLE_UPLOAD_TOKEN: nonEmptyStringSchema,
});

export interface UploadRuntimeConfig {
	apiOrigin: string;
	installationId: number;
	uploadToken: string;
}

export async function uploadScenarioRunEnvelope(
	envelope: UploadScenarioRunEnvelopeV1,
	config: UploadRuntimeConfig,
	fetchImplementation: typeof fetch = fetch,
) {
	const uploadUrl = new URL(
		"/api/v1/uploads/scenario-runs",
		ensureTrailingSlash(config.apiOrigin),
	).toString();
	const response = await fetchImplementation(uploadUrl, {
		method: "POST",
		headers: {
			authorization: `Bearer ${config.uploadToken}`,
			"content-type": "application/json",
		},
		body: JSON.stringify(envelope),
	});

	if (!response.ok) {
		const responseBody = await response.text();
		const responseSuffix = responseBody ? `: ${truncate(responseBody)}` : "";
		throw new Error(
			`Scenario-run upload failed with status ${response.status}${responseSuffix}`,
		);
	}

	return {
		status: response.status,
		uploadUrl,
	};
}

export function parseUploadRuntimeConfig(
	env: NodeJS.ProcessEnv,
): UploadRuntimeConfig {
	const result = v.safeParse(uploadEnvironmentSchema, {
		BUNDLE_API_ORIGIN: normalizeTrimmedInput(env.BUNDLE_API_ORIGIN),
		BUNDLE_INSTALLATION_ID: normalizeTrimmedInput(env.BUNDLE_INSTALLATION_ID),
		BUNDLE_UPLOAD_TOKEN: normalizeTrimmedInput(env.BUNDLE_UPLOAD_TOKEN),
	});

	if (!result.success) {
		throw new Error(
			`Invalid upload runtime environment: ${formatIssues(result.issues)}`,
		);
	}

	let apiOrigin: string;

	try {
		apiOrigin = new URL(result.output.BUNDLE_API_ORIGIN).toString();
	} catch (error) {
		throw new Error(
			`Invalid BUNDLE_API_ORIGIN: ${result.output.BUNDLE_API_ORIGIN}`,
			{
				cause: error,
			},
		);
	}

	const installationIdResult = v.safeParse(
		positiveIntegerSchema,
		Number.parseInt(result.output.BUNDLE_INSTALLATION_ID, 10),
	);

	if (!installationIdResult.success) {
		throw new Error(
			`Invalid BUNDLE_INSTALLATION_ID: ${formatIssues(installationIdResult.issues)}`,
		);
	}

	return {
		apiOrigin,
		installationId: installationIdResult.output,
		uploadToken: result.output.BUNDLE_UPLOAD_TOKEN,
	};
}

function ensureTrailingSlash(value: string) {
	return value.endsWith("/") ? value : `${value}/`;
}

function truncate(value: string) {
	return value.length <= 500 ? value : `${value.slice(0, 497)}...`;
}
