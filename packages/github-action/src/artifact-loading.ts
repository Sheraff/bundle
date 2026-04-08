import fs from "node:fs/promises";

import {
	pluginArtifactV1Schema,
	type PluginArtifactV1,
} from "@workspace/contracts/plugin-artifact";
import * as v from "valibot";

import { formatIssues } from "./parsing.js";

export async function resetArtifactFile(artifactPath: string) {
	await fs.rm(artifactPath, { force: true });
}

export async function loadArtifact(
	filePath: string,
): Promise<PluginArtifactV1> {
	let contents: string;

	try {
		contents = await fs.readFile(filePath, "utf8");
	} catch (error) {
		throw new Error(`Could not find the expected artifact at ${filePath}`, {
			cause: error,
		});
	}

	let parsedArtifact: unknown;

	try {
		parsedArtifact = JSON.parse(contents);
	} catch (error) {
		throw new Error(`Could not parse the artifact at ${filePath}`, {
			cause: error,
		});
	}

	const result = v.safeParse(pluginArtifactV1Schema, parsedArtifact);

	if (!result.success) {
		throw new Error(
			`Artifact at ${filePath} is invalid: ${formatIssues(result.issues)}`,
		);
	}

	return result.output;
}
