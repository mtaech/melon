/**
 * Plugin + tool configuration for dsh-browser-tool. Environment overrides win
 * over the `browser` config block (DSH_BROWSER_*), mirroring oh-my-pi.
 */
import z from "@deepseek-ai/schemastery";
export declare const browserToolConfigSchema: z<Schemastery.ObjectS<{
    enabled: z<boolean, boolean>;
    headless: z<boolean, boolean>;
    relay: z<boolean, boolean>;
    relayUrl: z<string, string>;
    cdpUrl: z<string, string>;
    screenshotDir: z<string, string>;
    noWebP: z<boolean, boolean>;
    installChrome: z<boolean, boolean>;
}>, Schemastery.ObjectT<{
    enabled: z<boolean, boolean>;
    headless: z<boolean, boolean>;
    relay: z<boolean, boolean>;
    relayUrl: z<string, string>;
    cdpUrl: z<string, string>;
    screenshotDir: z<string, string>;
    noWebP: z<boolean, boolean>;
    installChrome: z<boolean, boolean>;
}>>;
export type BrowserToolConfig = ReturnType<typeof browserToolConfigSchema>;
/** Author-facing (un-parsed) config surface; see the README for env overrides. */
export interface BrowserToolConfigInput {
    enabled?: boolean;
    headless?: boolean;
    relay?: boolean;
    relayUrl?: string;
    cdpUrl?: string;
    screenshotDir?: string;
    noWebP?: boolean;
    installChrome?: boolean;
}
/** Merge environment overrides onto the config block. */
export declare function resolveConfig(input: Partial<BrowserToolConfigInput>): BrowserToolConfig;
