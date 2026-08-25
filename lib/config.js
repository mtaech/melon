/**
 * Plugin + tool configuration for dsh-browser-tool. Environment overrides win
 * over the `browser` config block (DSH_BROWSER_*), mirroring oh-my-pi.
 */
import z from "@deepseek-ai/schemastery";
export const browserToolConfigSchema = z.object({
    enabled: z.boolean().default(true),
    headless: z.boolean().default(true),
    relay: z.boolean().default(false),
    relayUrl: z.string().default("http://127.0.0.1:9224"),
    cdpUrl: z.string().default("http://127.0.0.1:9222"),
    screenshotDir: z.string().default(""),
    noWebP: z.boolean().default(false),
    installChrome: z.boolean().default(true),
});
/** Merge environment overrides onto the config block. */
export function resolveConfig(input) {
    return {
        enabled: envFlag("DSH_BROWSER_ENABLED", input.enabled ?? true),
        headless: envFlag("DSH_BROWSER_HEADLESS", input.headless ?? true),
        relay: envFlag("DSH_BROWSER_RELAY", input.relay ?? false),
        relayUrl: process.env.DSH_BROWSER_RELAY_URL?.trim() || input.relayUrl || "http://127.0.0.1:9224",
        cdpUrl: process.env.DSH_BROWSER_CDP_URL?.trim() || input.cdpUrl || "http://127.0.0.1:9222",
        screenshotDir: expandHome(process.env.DSH_BROWSER_SCREENSHOT_DIR || input.screenshotDir || ""),
        noWebP: envFlag("DSH_BROWSER_NO_WEBP", input.noWebP ?? false),
        installChrome: envFlag("DSH_BROWSER_INSTALL_CHROME", input.installChrome ?? true),
    };
}
function envFlag(name, fallback) {
    const raw = process.env[name];
    if (raw === undefined)
        return fallback;
    const value = raw.trim().toLowerCase();
    if (value === "" || value === "0" || value === "false" || value === "no" || value === "off")
        return false;
    return true;
}
function expandHome(p) {
    if (!p)
        return p;
    if (p === "~")
        return process.env.HOME ?? p;
    if (p.startsWith("~/"))
        return `${process.env.HOME ?? ""}${p.slice(1)}`;
    return p;
}
