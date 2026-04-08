import { readFileSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { brotliCompressSync, gzipSync } from "node:zlib";

import {
	BUNDLE_ARTIFACT_OUTPUT_ENV_VAR,
	DEFAULT_ARTIFACT_RELATIVE_PATH,
	SCHEMA_VERSION_V1,
	scenarioSlugSchema,
	nonEmptyStringSchema,
} from "@workspace/contracts/shared";
import {
	pluginArtifactV1Schema,
	type ArtifactWarningV1,
	type AssetArtifactV1,
	type ChunkArtifactV1,
	type PluginArtifactV1,
} from "@workspace/contracts/plugin-artifact";
import * as v from "valibot";
import type { Plugin, UserConfig } from "vite";

const PLUGIN_VERSION = "0.0.0";
const DEFAULT_ENVIRONMENT_NAME = "default";

const bundleTrackerOptionsSchema = v.strictObject({
	scenario: scenarioSlugSchema,
	kind: v.optional(
		v.union([v.literal("fixture-app"), v.literal("synthetic-import")]),
	),
	artifactOutput: v.optional(nonEmptyStringSchema),
});

export type BundleTrackerScenarioKind = PluginArtifactV1["scenario"]["kind"];

export interface BundleTrackerOptions {
	scenario: string;
	kind?: BundleTrackerScenarioKind;
	artifactOutput?: string;
}

type CandidateChunkArtifact = Omit<ChunkArtifactV1, "sizes">;
type CandidateAssetArtifact = Omit<AssetArtifactV1, "sizes">;
type CandidateManifest = Record<string, unknown>;

interface CapturedEnvironmentState {
	outDir: string;
	manifestPath: string;
	chunks: CandidateChunkArtifact[];
	assets: CandidateAssetArtifact[];
	warnings: ArtifactWarningV1[];
}

type ChunkWithViteMetadata = {
	viteMetadata?: {
		importedCss?: Iterable<string>;
		importedAssets?: Iterable<string>;
	};
} & {
	dynamicImports: string[];
	facadeModuleId: string | null;
	fileName: string;
	implicitlyLoadedBefore?: string[];
	imports: string[];
	isDynamicEntry: boolean;
	isEntry: boolean;
	modules: Record<
		string,
		{
			originalLength: number | undefined;
			renderedLength: number | undefined;
		}
	>;
	name: string;
};

type AssetWithBundleMetadata = {
	fileName: string;
	names?: string[];
	needsCodeReference?: boolean;
	originalFileNames?: string[];
};

export function bundleTracker(options: BundleTrackerOptions): Plugin {
	const normalizedOptions = parseBundleTrackerOptions(options);

	let artifactFile = "";
	let rootDir = "";
	let viteVersion = "";
	let expectedEnvironmentCount = 1;
	let artifactRemoved = false;
	let artifactWritten = false;

	const capturedEnvironments = new Map<string, CapturedEnvironmentState>();
	const capturedManifests = new Map<string, CandidateManifest>();

	return {
		name: "bundle-tracker",
		apply: "build",

		config(config): UserConfig {
			expectedEnvironmentCount =
				1 + Object.keys(config.environments ?? {}).length;

			return {
				build: {
					manifest: normalizeManifestConfigValue(config.build?.manifest),
				},
				environments: updateEnvironmentManifestConfig(config.environments),
			};
		},

		configResolved(config) {
			rootDir = config.root;
			const artifactOutput =
				readArtifactOutputOverride() ??
				normalizedOptions.artifactOutput ??
				DEFAULT_ARTIFACT_RELATIVE_PATH;
			artifactFile = path.resolve(rootDir, artifactOutput);
		},

		async buildStart() {
			viteVersion = this.meta.viteVersion ?? viteVersion;

			if (artifactFile.length === 0) {
				throw new Error(
					"Could not determine the artifact output path before build start",
				);
			}

			if (artifactRemoved) {
				return;
			}

			artifactRemoved = true;
			await fs.rm(artifactFile, { force: true });
		},

		generateBundle(_, bundle) {
			const environmentName = getEnvironmentName(this.environment?.name);
			const environmentBuild = this.environment?.config?.build;
			const manifestSetting = normalizeResolvedManifestValue(
				environmentBuild?.manifest,
				environmentName,
			);
			const outDir = requireNonEmptyString(
				environmentBuild?.outDir,
				`Environment "${environmentName}" is missing build.outDir`,
			);

			const chunks: CandidateChunkArtifact[] = [];
			const assets: CandidateAssetArtifact[] = [];
			const manifestPath = toPosixPath(resolveManifestPath(manifestSetting));

			if (capturedEnvironments.has(environmentName)) {
				throw new Error(
					`Environment name "${environmentName}" was emitted more than once in one build`,
				);
			}

			for (const fileName of Object.keys(bundle).sort((left, right) =>
				left.localeCompare(right),
			)) {
				const output = bundle[fileName];

				if (output.type === "chunk") {
					chunks.push(
						serializeChunk(
							output as unknown as ChunkWithViteMetadata,
							environmentName,
							(rawId) => getModuleOriginalLength(this, rawId),
						),
					);
					continue;
				}

				if (shouldSkipAsset(fileName, manifestPath)) {
					continue;
				}

				assets.push(
					serializeAsset(output as AssetWithBundleMetadata, environmentName),
				);
			}

			capturedEnvironments.set(environmentName, {
				outDir,
				manifestPath,
				chunks: chunks.sort((left, right) =>
					left.fileName.localeCompare(right.fileName),
				),
				assets: assets.sort((left, right) =>
					left.fileName.localeCompare(right.fileName),
				),
				warnings: [],
			});
		},

		async closeBundle() {
			const environmentName = getEnvironmentName(this.environment?.name);
			const capturedEnvironment = capturedEnvironments.get(environmentName);

			if (!capturedEnvironment) {
				return;
			}

			const outDir = path.resolve(rootDir, capturedEnvironment.outDir);
			capturedManifests.set(
				environmentName,
				await readManifest(
					path.join(outDir, capturedEnvironment.manifestPath),
					environmentName,
				),
			);

			if (
				capturedManifests.size !== expectedEnvironmentCount ||
				artifactWritten
			) {
				return;
			}

			artifactWritten = true;
			await writeArtifact({
				artifactFile,
				capturedEnvironments,
				capturedManifests,
				options: normalizedOptions,
				rootDir,
				viteVersion,
			});
		},
	} satisfies Plugin;
}

function updateEnvironmentManifestConfig(
	environments: UserConfig["environments"],
): UserConfig["environments"] {
	if (!environments) {
		return undefined;
	}

	return Object.fromEntries(
		Object.entries(environments).map(([environmentName, environmentConfig]) => [
			environmentName,
			{
				...environmentConfig,
				build: {
					...environmentConfig.build,
					manifest: normalizeManifestConfigValue(
						environmentConfig.build?.manifest,
					),
				},
			},
		]),
	);
}

function parseBundleTrackerOptions(options: BundleTrackerOptions) {
	const result = v.safeParse(bundleTrackerOptionsSchema, options);

	if (!result.success) {
		throw new Error(
			`Invalid bundleTracker options: ${formatIssues(result.issues)}`,
		);
	}

	return {
		scenario: result.output.scenario,
		kind: result.output.kind ?? "fixture-app",
		artifactOutput: result.output.artifactOutput,
	};
}

function serializeChunk(
	chunk: ChunkWithViteMetadata,
	environmentName: string,
	getModuleOriginalLength: (rawId: string) => number | null,
): CandidateChunkArtifact {
	const modules = Object.entries(chunk.modules).map(([rawId, moduleInfo]) => ({
		rawId: requireNonEmptyString(
			rawId,
			`Environment "${environmentName}" has a chunk module with an empty id`,
		),
		renderedLength: requireNonNegativeInteger(
			moduleInfo.renderedLength,
			`Chunk "${chunk.fileName}" in environment "${environmentName}" is missing module renderedLength`,
		),
		originalLength: resolveOriginalLength(
			rawId,
			moduleInfo.originalLength,
			getModuleOriginalLength,
			`Chunk "${chunk.fileName}" in environment "${environmentName}" is missing module originalLength`,
		),
	}));

	if (modules.length === 0) {
		throw new Error(
			`Chunk "${chunk.fileName}" in environment "${environmentName}" is missing module membership`,
		);
	}

	return {
		fileName: requireNonEmptyString(
			chunk.fileName,
			`Encountered a chunk with an empty fileName in environment "${environmentName}"`,
		),
		name: requireNonEmptyString(
			chunk.name,
			`Chunk "${chunk.fileName}" in environment "${environmentName}" is missing a name`,
		),
		isEntry: chunk.isEntry,
		isDynamicEntry: chunk.isDynamicEntry,
		facadeModuleId: chunk.facadeModuleId
			? requireNonEmptyString(
					chunk.facadeModuleId,
					`Chunk "${chunk.fileName}" in environment "${environmentName}" has an empty facadeModuleId`,
				)
			: null,
		imports: sortUniqueStrings(chunk.imports),
		dynamicImports: sortUniqueStrings(chunk.dynamicImports),
		implicitlyLoadedBefore: sortUniqueStrings(
			chunk.implicitlyLoadedBefore ?? [],
		),
		importedCss: sortUniqueStrings(chunk.viteMetadata?.importedCss ?? []),
		importedAssets: sortUniqueStrings(chunk.viteMetadata?.importedAssets ?? []),
		modules: modules.sort((left, right) =>
			left.rawId.localeCompare(right.rawId),
		),
	};
}

function serializeAsset(
	asset: AssetWithBundleMetadata,
	environmentName: string,
): CandidateAssetArtifact {
	const fileName = requireNonEmptyString(
		asset.fileName,
		`Encountered an asset with an empty fileName in environment "${environmentName}"`,
	);
	const names = sortUniqueStrings(asset.names ?? []);

	if (names.length === 0) {
		throw new Error(
			`Asset "${fileName}" in environment "${environmentName}" is missing names`,
		);
	}

	const originalFileNames = sortUniqueStrings(asset.originalFileNames ?? []);

	return {
		fileName,
		names,
		...(originalFileNames.length > 0 ? { originalFileNames } : {}),
		needsCodeReference: asset.needsCodeReference ?? false,
	};
}

async function writeArtifact(input: {
	artifactFile: string;
	capturedEnvironments: Map<string, CapturedEnvironmentState>;
	capturedManifests: Map<string, CandidateManifest>;
	options: ReturnType<typeof parseBundleTrackerOptions>;
	rootDir: string;
	viteVersion: string;
}) {
	const environments = await Promise.all(
		[...input.capturedEnvironments.entries()]
			.sort(([leftName], [rightName]) => leftName.localeCompare(rightName))
			.map(async ([environmentName, capturedEnvironment]) => {
				const manifest = input.capturedManifests.get(environmentName);

				if (!manifest) {
					throw new Error(
						`Environment "${environmentName}" is missing manifest data`,
					);
				}

				const absoluteOutDir = path.resolve(
					input.rootDir,
					capturedEnvironment.outDir,
				);

				return {
					name: environmentName,
					build: {
						outDir: capturedEnvironment.outDir,
					},
					manifest,
					chunks: await Promise.all(
						capturedEnvironment.chunks.map(async (chunk) => ({
							...chunk,
							sizes: await measureFile(
								path.join(absoluteOutDir, chunk.fileName),
								`chunk "${chunk.fileName}" in environment "${environmentName}"`,
							),
						})),
					),
					assets: await Promise.all(
						capturedEnvironment.assets.map(async (asset) => ({
							...asset,
							sizes: await measureFile(
								path.join(absoluteOutDir, asset.fileName),
								`asset "${asset.fileName}" in environment "${environmentName}"`,
							),
						})),
					),
					warnings: capturedEnvironment.warnings,
				};
			}),
	);

	const candidateArtifact = {
		schemaVersion: SCHEMA_VERSION_V1,
		pluginVersion: PLUGIN_VERSION,
		generatedAt: new Date().toISOString(),
		scenario: {
			id: input.options.scenario,
			kind: input.options.kind,
		},
		build: {
			bundler: "vite",
			bundlerVersion: requireNonEmptyString(
				input.viteVersion,
				"Could not determine the Vite version for the current build",
			),
			rootDir: requireNonEmptyString(
				input.rootDir,
				"Could not determine the Vite root directory",
			),
		},
		environments,
	};

	const parsedArtifact = v.safeParse(pluginArtifactV1Schema, candidateArtifact);

	if (!parsedArtifact.success) {
		throw new Error(
			`Generated artifact is invalid: ${formatIssues(parsedArtifact.issues)}`,
		);
	}

	await fs.mkdir(path.dirname(input.artifactFile), { recursive: true });
	await fs.writeFile(
		input.artifactFile,
		`${JSON.stringify(parsedArtifact.output, null, 2)}\n`,
	);
}

async function readManifest(
	filePath: string,
	environmentName: string,
): Promise<CandidateManifest> {
	let contents: string;

	try {
		contents = await fs.readFile(filePath, "utf8");
	} catch (error) {
		throw new Error(
			`Environment "${environmentName}" is missing the required Vite manifest at ${filePath}`,
			{ cause: error },
		);
	}

	let parsed: unknown;

	try {
		parsed = JSON.parse(contents);
	} catch (error) {
		throw new Error(
			`Environment "${environmentName}" has an unreadable manifest at ${filePath}`,
			{
				cause: error,
			},
		);
	}

	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
		throw new Error(
			`Environment "${environmentName}" has an invalid manifest payload at ${filePath}`,
		);
	}

	return Object.fromEntries(
		Object.entries(parsed).sort(([leftKey], [rightKey]) =>
			leftKey.localeCompare(rightKey),
		),
	);
}

async function measureFile(filePath: string, label: string) {
	let buffer: Buffer;

	try {
		buffer = await fs.readFile(filePath);
	} catch (error) {
		throw new Error(`Could not read ${label} at ${filePath}`, { cause: error });
	}

	return {
		raw: buffer.byteLength,
		gzip: gzipSync(buffer).byteLength,
		brotli: brotliCompressSync(buffer).byteLength,
	};
}

function normalizeManifestConfigValue(value: unknown) {
	if (value === true || typeof value === "string") {
		return value;
	}

	return true;
}

function readArtifactOutputOverride() {
	const artifactOutput = process.env[BUNDLE_ARTIFACT_OUTPUT_ENV_VAR];
	return artifactOutput && artifactOutput.length > 0
		? artifactOutput
		: undefined;
}

function getModuleOriginalLength(
	pluginContext: PluginContextLike,
	rawId: string,
) {
	const sourceLength = readModuleSourceLength(rawId);

	if (sourceLength !== null) {
		return sourceLength;
	}

	const moduleInfo = pluginContext.getModuleInfo(rawId);

	if (!moduleInfo?.code) {
		return null;
	}

	return Buffer.byteLength(moduleInfo.code);
}

function normalizeResolvedManifestValue(
	value: unknown,
	environmentName: string,
) {
	if (value === true || typeof value === "string") {
		return value;
	}

	throw new Error(
		`Environment "${environmentName}" is missing build.manifest after config resolution`,
	);
}

function resolveManifestPath(value: true | string) {
	return value === true ? path.join(".vite", "manifest.json") : value;
}

function shouldSkipAsset(fileName: string, manifestPath: string) {
	const normalizedFileName = toPosixPath(fileName);
	return (
		normalizedFileName === manifestPath || normalizedFileName.endsWith(".map")
	);
}

function getEnvironmentName(value: string | undefined) {
	return value && value.length > 0 ? value : DEFAULT_ENVIRONMENT_NAME;
}

function requireNonEmptyString(value: unknown, message: string) {
	if (typeof value !== "string" || value.length === 0) {
		throw new Error(message);
	}

	return value;
}

function requireNonNegativeInteger(value: unknown, message: string) {
	if (!Number.isInteger(value) || Number(value) < 0) {
		throw new Error(message);
	}

	return Number(value);
}

function resolveOriginalLength(
	rawId: string,
	value: unknown,
	getModuleOriginalLength: (rawId: string) => number | null,
	message: string,
) {
	if (Number.isInteger(value) && Number(value) >= 0) {
		return Number(value);
	}

	const codeLength = getModuleOriginalLength(rawId);

	if (codeLength !== null) {
		return codeLength;
	}

	throw new Error(message);
}

function readModuleSourceLength(rawId: string) {
	const filePath = stripQuery(rawId);

	if (!path.isAbsolute(filePath)) {
		return null;
	}

	try {
		return readFileSync(filePath).byteLength;
	} catch {
		return null;
	}
}

function sortUniqueStrings(values: Iterable<string>) {
	return [
		...new Set(
			[...values].map((value) =>
				requireNonEmptyString(value, "Expected a non-empty string"),
			),
		),
	].sort((left, right) => left.localeCompare(right));
}

function toPosixPath(value: string) {
	return value.replaceAll("\\", "/");
}

function stripQuery(value: string) {
	const queryIndex = value.indexOf("?");
	return queryIndex === -1 ? value : value.slice(0, queryIndex);
}

function formatIssues(issues: readonly { message: string }[]) {
	return issues.map((issue) => issue.message).join("; ");
}

interface PluginContextLike {
	getModuleInfo(id: string): { code?: string | null } | null;
}
