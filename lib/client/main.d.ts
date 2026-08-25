import type { ClientContext } from "@deepseek-ai/dsh-client-runtime/client";
/** JSON contract mirrored from the host half (kept local; wire-only). */
export interface PluginEntryDto {
    name: string;
    mounted: boolean;
    isCore: boolean;
    source: string;
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
export interface UpgradePlanDto {
    name: string;
    source: string;
    installedVersion: string | null;
    installedCommit: string | null;
    currentSpecifier: string;
    targetLabel: string;
    targetCommit: string | null;
    newSpecifier: string;
    command: string;
    wouldChange: boolean;
    error?: string;
}
export interface UninstallPlanDto {
    name: string;
    isCore: boolean;
    inDependencies: boolean;
    inBundles: boolean;
    wouldRemove: boolean;
    error?: string;
}
/** Services the browser plugin needs: the slots registry (settings tab contribution). */
export declare const inject: string[];
export declare function apply(ctx: ClientContext): void;
