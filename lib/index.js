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
import { ToolError } from "./errors.js";
import { resolveConfig } from "./config.js";
import { defineTool } from "./deps.js";
import { acquireBrowser, releaseBrowser } from "./browsers/registry.js";
import { acquireTab, getTab, releaseTab, runInTab, expandBrowserScreenshotDir } from "./browsers/tab-supervisor.js";
import { resolveRelayKind } from "./relay/kind.js";
export const name = "dsh-browser-tool";
export const inject = ["tools", "attachments"];
export const Config = z.object({
    enabled: z.boolean().default(true),
    headless: z.boolean().default(true),
    relay: z.boolean().default(false),
    relayUrl: z.string().default("http://127.0.0.1:9224"),
    cdpUrl: z.string().default("http://127.0.0.1:9222"),
    screenshotDir: z.string().default(""),
    noWebP: z.boolean().default(false),
    installChrome: z.boolean().default(true),
});
/** Author-facing parameter schema (dsh-tools ValueSchemaSpec DSL). */
const parameters = {
    action: { type: "string", enum: ["open", "run", "close"], required: true, description: "open: create/reuse a tab; run: execute code in a tab; close: close a tab." },
    name: { type: "string", required: true, description: "Tab name; unique per session." },
    url: { type: "string", description: "Initial URL for open." },
    waitUntil: { type: "string", enum: ["load", "domcontentloaded", "networkidle0", "networkidle2"], description: "Navigation lifecycle event to wait for on open." },
    headless: { type: "boolean", description: "Override headless launch for this open." },
    timeout: { type: "integer", description: "Per-call budget in ms (open/run); default 120000." },
    target: { type: "string", description: "Attach target hint (URL fragment) when attaching to a running browser." },
    viewport: {
        type: "object",
        additionalProperties: false,
        properties: {
            width: { type: "integer" },
            height: { type: "integer" },
            deviceScaleFactor: { type: "number" },
        },
    },
    dialogs: { type: "string", enum: ["accept", "dismiss"], description: "Auto-handle JS dialogs for this tab." },
    code: { type: "string", description: "JavaScript body for run. Scope: page, browser, tab, assert, wait, sleep, display, print, console." },
    kill: { type: "boolean", description: "Close + kill the owned browser process." },
};
/** Exported so the contract test can validate real result objects against the declared schema. */
export const outputSchema = {
    type: "object",
    additionalProperties: false,
    properties: {
        ok: { type: "boolean", required: true },
        name: { type: "string", required: true },
        created: { type: "boolean" },
        url: { type: "string" },
        message: { type: "string" },
        output: {
            type: "array",
            items: {
                type: "object",
                additionalProperties: false,
                properties: {
                    kind: { type: "string", enum: ["text", "image"], required: true },
                    text: { type: "string" },
                    dest: { type: "string" },
                    image: {
                        type: "object",
                        additionalProperties: false,
                        properties: {
                            attachmentId: { type: "string", required: true },
                            mediaType: { type: "string", required: true },
                            bytes: { type: "integer", required: true },
                            width: { type: "integer", required: true },
                            height: { type: "integer", required: true },
                            name: { type: "string" },
                        },
                    },
                },
            },
        },
        returnValue: { type: "json" },
    },
};
const DEFAULT_OPEN_TIMEOUT_MS = 120_000;
const DEFAULT_RUN_TIMEOUT_MS = 120_000;
export function apply(ctx, options = {}) {
    if (options.enabled === false)
        return;
    const settings = resolveConfig(options.config ?? {});
    if (!settings.enabled)
        return;
    const tools = ctx.get("tools");
    const attachments = ctx.get("attachments");
    if (!tools || !attachments)
        return;
    const browserSettings = {
        headless: settings.headless,
        relayEnabled: settings.relay,
        relayUrl: settings.relayUrl,
        cdpUrl: settings.cdpUrl,
        screenshotDir: settings.screenshotDir || undefined,
        excludeWebP: settings.noWebP,
        installChrome: settings.installChrome,
    };
    tools.register(defineTool({
        name: "browser",
        description: [
            "Drive a Chromium browser: open/manage named tabs, run JavaScript against a page, and read back",
            "accessible snapshots, screenshots, and extracted readable text. Actions:",
            "- open: create (or reuse) a tab; connects headless Chromium, the user's Chrome via the browser relay, or a CDP endpoint.",
            "- run: execute JavaScript in the tab. The cell receives page, browser, tab (TabApi with the same semantics as the",
            "  omp browser tool), assert/wait/sleep/display/print/console. tab.observe() returns interactive elements with ids for",
            "  click/type/fill, tab.ariaSnapshot() returns an aria snapshot with refs (ref(e1) etc.), tab.screenshot() saves and",
            "  returns a path, tab.extract() returns readable markdown. Local network and file access follow the hosting environment.",
            "  A run cell reports returnValue only when its last top-level statement is an expression or an explicit `return <expr>`;",
            "  a cell ending in any other statement omits returnValue entirely, which is normal and not an error. Values that are",
            "  not JSON (functions, class instances, cycles) are coerced to a string or dropped, so return plain JSON and use",
            "  display()/print() for anything you want to read regardless.",
            "- close: close a tab (optionally kill the owned browser).",
        ].join(" "),
        parameters,
        timeoutMs: 300_000,
        output: {
            schema: outputSchema,
            render(renderedArgs, rawValue) {
                const value = rawValue;
                const blocks = [];
                if (value.ok && value.output) {
                    for (const entry of value.output) {
                        if (entry.kind === "image" && entry.image) {
                            blocks.push({ type: "image", attachment: entry.image });
                        }
                        else if (entry.kind === "text" && entry.text) {
                            blocks.push({ type: "text", text: entry.text });
                        }
                    }
                    if (value.message)
                        blocks.push({ type: "text", text: value.message });
                }
                else if (value.message) {
                    blocks.push({ type: "text", text: value.message });
                }
                void renderedArgs;
                return blocks;
            },
            presentationMeta(renderedArgs, rawValue) {
                const value = rawValue;
                const args = renderedArgs;
                return { name: value.name, action: args.action, ok: value.ok };
            },
        },
        async execute(rawArgs, exec) {
            const args = rawArgs;
            if (exec.signal.aborted)
                throw new ToolError(`Browser tool aborted: ${String(exec.signal.reason)}`);
            const cwd = exec.agent?.session?.header?.cwd ?? process.cwd();
            switch (args.action) {
                case "open":
                    return await actionOpen(args, exec, cwd, browserSettings, settings);
                case "run":
                    return await actionRun(args, exec, cwd, browserSettings, settings, attachments);
                case "close":
                    return await actionClose(args, exec, browserSettings);
            }
        },
    }));
}
async function actionOpen(args, exec, cwd, browserSettings, settings) {
    const timeoutMs = args.timeout ?? DEFAULT_OPEN_TIMEOUT_MS;
    const relay = resolveRelayKind({ settingEnabled: settings.relay, url: settings.relayUrl });
    const kind = relay
        ? { kind: "relay", cdpUrl: relay.cdpUrl }
        : (args.headless ?? settings.headless)
            ? { kind: "headless", headless: true }
            : { kind: "connected", cdpUrl: settings.cdpUrl };
    const viewport = normalizeViewport(args.viewport);
    const browser = await acquireBrowser(kind, {
        cwd,
        viewport: viewport ?? undefined,
        config: browserSettings,
        signal: exec.signal,
    });
    const ownerSessionId = exec.agent?.session?.id;
    try {
        const { tab, created } = await acquireTab(args.name, browser, {
            url: args.url,
            waitUntil: args.waitUntil,
            viewport: viewport ?? undefined,
            target: args.target,
            dialogs: args.dialogs,
            timeoutMs,
            signal: exec.signal,
            ownerSessionId,
        });
        const url = tab.info?.url ?? args.url;
        return {
            ok: true,
            name: args.name,
            created,
            ...(url === undefined ? {} : { url }),
            message: created
                ? `Opened tab ${JSON.stringify(args.name)} (${tab.info?.url ?? "about:blank"})`
                : `Reused tab ${JSON.stringify(args.name)}`,
        };
    }
    catch (error) {
        await releaseBrowser(browser, { kill: false }).catch(() => undefined);
        throw error;
    }
}
async function actionRun(args, exec, cwd, browserSettings, settings, attachments) {
    const timeoutMs = args.timeout ?? DEFAULT_RUN_TIMEOUT_MS;
    if (!getTab(args.name)) {
        throw new ToolError(`Tab ${JSON.stringify(args.name)} is not open. Open it first with action:"open".`);
    }
    const result = await runInTab(args.name, {
        code: args.code ?? "",
        timeoutMs,
        signal: exec.signal,
        cwd,
        screenshotDir: expandScreenshotDir(settings),
        excludeWebP: settings.noWebP,
    });
    const output = [];
    for (const entry of result.displays) {
        if (entry.type === "text") {
            output.push({ kind: "text", text: entry.text });
        }
        else {
            const image = entry;
            const ref = await saveImage(attachments, image);
            output.push({ kind: "image", image: ref, ...(image.dest === undefined ? {} : { dest: image.dest }) });
        }
    }
    if (result.screenshots?.length) {
        output.push({
            kind: "text",
            text: `Screenshots: ${result.screenshots.map(s => `${s.dest} (${s.width}x${s.height})`).join(", ")}`,
        });
    }
    const returnValue = toJsonValue(result.returnValue);
    return {
        ok: true,
        name: args.name,
        output,
        // The schema declares returnValue optional; an absent value must be an absent
        // KEY, because an own key holding `undefined` breaks the lossless-JSON boundary.
        ...(returnValue === undefined ? {} : { returnValue }),
    };
}
/** Lossless-JSON projection of a run cell return value (non-JSON → undefined). */
function toJsonValue(value) {
    if (value === undefined)
        return undefined;
    try {
        return JSON.parse(JSON.stringify(value));
    }
    catch {
        return undefined;
    }
}
async function saveImage(attachments, image) {
    const data = Buffer.from(image.data, "base64");
    const mediaType = normalizeMediaType(image.mimeType);
    const [ref] = await attachments.saveImages([{ data, mediaType, name: "browser-screenshot" }]);
    if (!ref)
        throw new ToolError("internal: image attachment store returned no reference");
    return ref;
}
function normalizeMediaType(mime) {
    if (mime === "image/jpeg" || mime === "image/png" || mime === "image/webp" || mime === "image/gif")
        return mime;
    return "image/png";
}
function normalizeViewport(vp) {
    if (!vp || (vp.width === undefined && vp.height === undefined && vp.deviceScaleFactor === undefined))
        return undefined;
    return {
        width: vp.width ?? 1365,
        height: vp.height ?? 768,
        deviceScaleFactor: vp.deviceScaleFactor,
    };
}
function expandScreenshotDir(settings) {
    return expandBrowserScreenshotDir(settings.screenshotDir || undefined);
}
async function actionClose(args, exec, browserSettings) {
    void exec;
    void browserSettings;
    const timeoutMs = args.timeout ?? 10_000;
    const closed = await releaseTab(args.name, { kill: args.kill ?? false, timeoutMs });
    return {
        ok: true,
        name: args.name,
        message: closed
            ? `Closed tab ${JSON.stringify(args.name)}${args.kill ? " and killed its browser" : ""}`
            : `Tab ${JSON.stringify(args.name)} was not open`,
    };
}
export default { name, inject, Config, apply };
