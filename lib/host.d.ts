import type { Context } from "@deepseek-ai/cordis";
import type { SubprocessRuntime } from "@deepseek-ai/dsh-subprocess";
import { Registry } from "./registry.js";
import { type PluginSource } from "./profile.js";
import { type CommandRunner } from "./upgrade.js";
export declare const name = "dsh-plugin-dashboard";
export declare const inject: string[];
export interface PluginEntry {
    name: string;
    mounted: boolean;
    isCore: boolean;
    source: PluginSource;
    specifier: string;
    installedVersion: string | null;
    installedCommit: string | null;
    description?: string;
    latest: {
        label: string;
        targetCommit: string | null;
        error: string | null;
    } | null;
    status: "update-available" | "up-to-date" | "not-installed" | "ahead" | "unknown" | "n-a";
    upgradeable: boolean;
}
export interface HostOptions {
    /** Injectable for tests; defaults to a fresh Registry over the node fetch. */
    registry?: Registry;
    /** Override the profile directory (default: process.cwd(), the dsh profile dir). */
    profileDir?: string;
}
/** Adapter over ctx.subprocess: run one batch command, collect bounded output. */
export declare function subprocessRunner(sub: SubprocessRuntime): CommandRunner;
export declare function apply(ctx: Context, options?: HostOptions): () => void;
