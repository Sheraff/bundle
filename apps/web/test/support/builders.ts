import type {
  GitContext,
  PluginArtifactV1,
  PullRequestContext,
  RepositoryContext,
  ScenarioSource,
  SyntheticDefinition,
  UploadScenarioRunEnvelopeV1,
} from '@workspace/contracts'

const DEFAULT_SHA = '0123456789abcdef0123456789abcdef01234567'
const DEFAULT_GENERATED_AT = '2026-04-06T12:00:00.000Z'

type CiContext = UploadScenarioRunEnvelopeV1['ci']
type FixtureScenarioSource = Extract<ScenarioSource, { kind: 'fixture-app' }>
type SyntheticScenarioSource = Exclude<ScenarioSource, FixtureScenarioSource>

export type BuildArtifactOverrides = {
  build?: PluginArtifactV1['build']
  environments?: PluginArtifactV1['environments']
  generatedAt?: PluginArtifactV1['generatedAt']
  pluginVersion?: PluginArtifactV1['pluginVersion']
  scenario?: PluginArtifactV1['scenario']
  schemaVersion?: PluginArtifactV1['schemaVersion']
}

type BuildEnvelopeBaseOverrides = {
  artifact?: PluginArtifactV1
  ci?: CiContext
  git?: GitContext
  pullRequest?: PullRequestContext
  repository?: RepositoryContext
  schemaVersion?: UploadScenarioRunEnvelopeV1['schemaVersion']
}

export type BuildFixtureEnvelopeOverrides = BuildEnvelopeBaseOverrides & {
  scenarioSource?: FixtureScenarioSource
}

export type BuildSyntheticEnvelopeOverrides = BuildEnvelopeBaseOverrides & {
  scenarioSource: SyntheticScenarioSource
  syntheticDefinition: SyntheticDefinition
}

export type BuildEnvelopeOverrides =
  | BuildFixtureEnvelopeOverrides
  | BuildSyntheticEnvelopeOverrides

const DEFAULT_FIXTURE_SCENARIO_SOURCE = { kind: 'fixture-app' } satisfies FixtureScenarioSource

export function size(raw: number, gzip: number, brotli: number) {
  return { raw, gzip, brotli }
}

export function buildCiContext(
  workflowRunId: string,
  overrides: Partial<CiContext> = {},
): CiContext {
  return {
    provider: 'github-actions',
    workflowRunId,
    workflowRunAttempt: 1,
    job: 'build',
    actionVersion: 'v1',
    ...overrides,
  }
}

export function buildArtifact(overrides: BuildArtifactOverrides = {}): PluginArtifactV1 {
  return {
    ...buildSimpleArtifact(),
    ...overrides,
  }
}

export function buildEnvelope(
  overrides: BuildEnvelopeOverrides = {},
): UploadScenarioRunEnvelopeV1 {
  const baseEnvelope: Extract<UploadScenarioRunEnvelopeV1, { scenarioSource: FixtureScenarioSource }> = {
    schemaVersion: 1,
    artifact: buildSimpleArtifact(),
    repository: {
      githubRepoId: 123,
      owner: 'acme',
      name: 'widget',
      installationId: 456,
    },
    git: {
      commitSha: DEFAULT_SHA,
      branch: 'main',
    },
    scenarioSource: DEFAULT_FIXTURE_SCENARIO_SOURCE,
    ci: buildCiContext('999'),
  }

  if (isSyntheticEnvelopeOverrides(overrides)) {
    return {
      ...baseEnvelope,
      ...overrides,
      schemaVersion: overrides.schemaVersion ?? baseEnvelope.schemaVersion,
      scenarioSource: overrides.scenarioSource,
      syntheticDefinition: overrides.syntheticDefinition,
    }
  }

  return {
    ...baseEnvelope,
    ...overrides,
    schemaVersion: overrides.schemaVersion ?? baseEnvelope.schemaVersion,
    scenarioSource: overrides.scenarioSource ?? baseEnvelope.scenarioSource,
  }
}

export function buildSimpleArtifact({
  scenarioId = 'fixture-app-cost',
  generatedAt = DEFAULT_GENERATED_AT,
  chunkFileName = 'assets/main.js',
  cssFileName = 'assets/main.css',
  chunkSizes = size(123, 45, 38),
  cssSizes = size(10, 8, 6),
}: {
  chunkFileName?: string
  chunkSizes?: { brotli: number; gzip: number; raw: number }
  cssFileName?: string
  cssSizes?: { brotli: number; gzip: number; raw: number }
  generatedAt?: string
  scenarioId?: string
} = {}): PluginArtifactV1 {
  return {
    schemaVersion: 1,
    pluginVersion: '0.1.0',
    generatedAt,
    scenario: {
      id: scenarioId,
      kind: 'fixture-app',
    },
    build: {
      bundler: 'vite',
      bundlerVersion: '8.0.4',
      rootDir: '/tmp/repo',
    },
    environments: [
      {
        name: 'default',
        build: {
          outDir: 'dist',
        },
        manifest: {
          'src/main.ts': {
            file: chunkFileName,
            src: 'src/main.ts',
            isEntry: true,
            css: [cssFileName],
          },
        },
        chunks: [
          {
            fileName: chunkFileName,
            name: 'main',
            isEntry: true,
            isDynamicEntry: false,
            facadeModuleId: '/tmp/repo/src/main.ts',
            imports: [],
            dynamicImports: [],
            implicitlyLoadedBefore: [],
            importedCss: [cssFileName],
            importedAssets: [],
            modules: [
              {
                rawId: '/tmp/repo/src/main.ts',
                renderedLength: chunkSizes.raw,
                originalLength: 456,
              },
            ],
            sizes: chunkSizes,
          },
        ],
        assets: [
          {
            fileName: cssFileName,
            names: ['main.css'],
            needsCodeReference: false,
            sizes: cssSizes,
          },
        ],
        warnings: [],
      },
    ],
  }
}

function isSyntheticEnvelopeOverrides(
  overrides: BuildEnvelopeOverrides,
): overrides is BuildSyntheticEnvelopeOverrides {
  const kind = overrides.scenarioSource?.kind
  return kind === 'repo-synthetic' || kind === 'hosted-synthetic'
}
