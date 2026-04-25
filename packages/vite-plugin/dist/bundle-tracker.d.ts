import type { Plugin } from "vite";
export declare const DEFAULT_ARTIFACT_RELATIVE_PATH: ".bundle/artifact.json";
export type BundleTrackerScenarioKind = "fixture-app" | "synthetic-import";
export interface BundleTrackerOptions {
    scenario: string;
    kind?: BundleTrackerScenarioKind;
    artifactOutput?: string;
}
export declare function bundleTracker(options: BundleTrackerOptions): Plugin;
