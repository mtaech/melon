/**
 * dsh-browser-tool: DSH plugin surface. Registers one `browser` tool that
 * opens/attaches a Chromium, manages named tabs, and runs code against a tab
 * with the full omp `tab` helper API (observe / ariaSnapshot / screenshot /
 * clicks / waits / evaluate …). Ported from oh-my-pi's coding-agent browser
 * tool plus browser-relay.
 *
 * Wire this package into a DSH profile by adding its built bundle to the
 * profile's `package.json > dsh.profile.bundles` list.
 */
import z from "@deepseek-ai/schemastery";
import { type BrowserToolConfigInput } from "./config.js";
import { type Context, type ImageAttachmentRef } from "./deps.js";
import type { JsonValue } from "@deepseek-ai/dsh-session";
export interface BrowserToolOptions {
    /** Allow spawning/attaching a browser. False disables the tool. */
    enabled?: boolean;
    config?: Partial<BrowserToolConfigInput>;
}
export declare const name = "dsh-browser-tool";
export declare const inject: string[];
export declare const Config: z<Schemastery.ObjectS<{
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
/** Runtime argument shape (validated by the schema above). */
export interface BrowserToolArgs {
    action: "open" | "run" | "close";
    name: string;
    url?: string;
    waitUntil?: "load" | "domcontentloaded" | "networkidle0" | "networkidle2";
    headless?: boolean;
    timeout?: number;
    target?: string;
    viewport?: {
        width?: number;
        height?: number;
        deviceScaleFactor?: number;
    };
    dialogs?: "accept" | "dismiss";
    code?: string;
    kill?: boolean;
}
export interface BrowserToolOutputEntry {
    kind: "text" | "image";
    text?: string;
    dest?: string;
    image?: ImageAttachmentRef;
}
export interface BrowserToolValue {
    ok: boolean;
    name: string;
    created?: boolean;
    url?: string;
    message?: string;
    output?: BrowserToolOutputEntry[];
    returnValue?: JsonValue;
}
export declare function apply(ctx: Context, options?: BrowserToolOptions): void;
declare const _default: {
    name: string;
    inject: string[];
    Config: z<Schemastery.ObjectS<{
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
    apply: typeof apply;
};
export default _default;
