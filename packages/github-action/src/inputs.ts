import path from "node:path";

import {
	nonEmptyStringSchema,
	scenarioSlugSchema,
} from "@workspace/contracts/shared";
import * as v from "valibot";

import { formatIssues, normalizeTrimmedInput } from "./parsing.js";

const rawActionInputsSchema = v.strictObject({
	command: v.optional(nonEmptyStringSchema),
	scenario: v.optional(scenarioSlugSchema),
	source: v.optional(nonEmptyStringSchema),
	workingDirectory: v.optional(nonEmptyStringSchema),
});

export interface RawActionInputs {
	command?: string;
	scenario?: string;
	source?: string;
	workingDirectory?: string;
}

export interface FixtureAppActionInputs {
	mode: "fixture-app";
	command: string;
	workingDirectory: string;
}

export interface RepoSyntheticActionInputs {
	mode: "repo-synthetic";
	scenario: string;
	source: string;
	workingDirectory: string;
}

export type ActionInputs = FixtureAppActionInputs | RepoSyntheticActionInputs;

export function parseActionInputs(
	rawInputs: RawActionInputs,
	cwd = process.cwd(),
): ActionInputs {
	const normalizedInputs = {
		command: normalizeTrimmedInput(rawInputs.command),
		scenario: normalizeTrimmedInput(rawInputs.scenario),
		source: normalizeSourceInput(rawInputs.source),
		workingDirectory: normalizeTrimmedInput(rawInputs.workingDirectory),
	};

	const result = v.safeParse(rawActionInputsSchema, normalizedInputs);

	if (!result.success) {
		throw new Error(`Invalid action inputs: ${formatIssues(result.issues)}`);
	}

	const { command, scenario, source, workingDirectory } = result.output;
	const resolvedWorkingDirectory = path.resolve(cwd, workingDirectory ?? ".");

	if (command && source) {
		throw new Error(
			"Invalid action inputs: command and source cannot both be provided",
		);
	}

	if (!scenario) {
		if (!command) {
			throw new Error(
				"Invalid action inputs: fixture-app mode requires command",
			);
		}

		if (source) {
			throw new Error("Invalid action inputs: source requires scenario");
		}

		return {
			mode: "fixture-app",
			command,
			workingDirectory: resolvedWorkingDirectory,
		};
	}

	if (command) {
		throw new Error(
			"Invalid action inputs: synthetic-import mode forbids command",
		);
	}

	if (!source) {
		throw new Error(
			"Invalid action inputs: synthetic-import mode requires source",
		);
	}

	return {
		mode: "repo-synthetic",
		scenario,
		source,
		workingDirectory: resolvedWorkingDirectory,
	};
}

function normalizeSourceInput(value?: string) {
	if (!value || value.trim().length === 0) {
		return undefined;
	}

	return value;
}
