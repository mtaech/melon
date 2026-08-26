/**
 * Tab worker: executes `run` code against one page and implements the `tab`
 * helper API. Ported from oh-my-pi `tab-worker.ts` with the run-scope /
 * rejection-owner machinery and session-tool bridging removed, and the
 * minimal runtime from `./runtime.js`.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { ToolAbortError, ToolError, throwIfAborted } from "./../errors.js";
import { uid, untilAborted, withTimeout } from "./../util.js";
import { resizeImage } from "./image.js";
import { applyStealthPatches, applyViewport, BROWSER_PROTOCOL_TIMEOUT_MS, loadPuppeteerInWorker } from "./launch.js";
import { assertSelectorString, captureAriaSnapshot, parseAriaRefSelector, resolveAriaRefHandle, } from "./aria/aria-snapshot.js";
import { extractReadableFromHtml } from "./readable.js";
import { cloneSafe, RunOutput } from "./run-output.js";
import { createConsole, createDisplay, createPrint, runJsCode } from "./runtime.js";
const INTERACTIVE_AX_ROLES = new Set([
    "button", "link", "textbox", "combobox", "listbox", "option", "checkbox", "radio", "switch",
    "tab", "menuitem", "menuitemcheckbox", "menuitemradio", "slider", "spinbutton", "searchbox", "treeitem",
]);
const LEGACY_SELECTOR_PREFIXES = ["p-aria/", "p-text/", "p-xpath/", "p-pierce/"];
const SELECTOR_HANDLER_PREFIXES = ["aria/", "text/", "xpath/", "pierce/", "aria-ref=", "aria-ref/", "ariaref/", "p-"];
const PLAYWRIGHT_ONLY_SELECTOR_RE = /:has-text\(|:text\(|:text-is\(|:text-matches\(|:visible\b|:hidden\b|:nth-match\(|:near\(|:above\(|:below\(|:right-of\(|:left-of\(/;
/** Headroom subtracted from the cell budget so a per-op deadline fires before it. */
const OP_DEADLINE_SLACK_MS = 1_000;
const QUICK_OP_TIMEOUT_MS = 20_000;
const ACTION_OP_TIMEOUT_MS = 8_000;
const ZERO_MATCH_FAIL_FAST_MS = 2_000;
const ZERO_MATCH_POLL_MS = 250;
const REQUEST_INTERCEPTION_CLEANUP_TIMEOUT_MS = 500;
export function resolveOpTimeouts(cellTimeoutMs) {
    const budgetBound = Math.max(1, cellTimeoutMs - OP_DEADLINE_SLACK_MS);
    return {
        budgetBound,
        quickOpMs: Math.min(budgetBound, QUICK_OP_TIMEOUT_MS),
        actionOpMs: Math.min(budgetBound, ACTION_OP_TIMEOUT_MS),
    };
}
export function resolveWaitTimeout(cellTimeoutMs, explicit) {
    const { budgetBound, actionOpMs } = resolveOpTimeouts(cellTimeoutMs);
    if (explicit === undefined)
        return actionOpMs;
    if (explicit === 0 || explicit === Number.POSITIVE_INFINITY)
        return budgetBound;
    if (Number.isFinite(explicit) && explicit > 0)
        return Math.min(explicit, budgetBound);
    return actionOpMs;
}
export function normalizeSelector(selector) {
    assertSelectorString(selector);
    if (!selector)
        return selector;
    if (!SELECTOR_HANDLER_PREFIXES.some(prefix => selector.startsWith(prefix)) &&
        PLAYWRIGHT_ONLY_SELECTOR_RE.test(selector)) {
        throw new ToolError(`Playwright-only selector ${JSON.stringify(selector)} is not supported by the browser tool. ` +
            `Use a puppeteer text selector ("text/Allow all"), an aria selector ("aria/Name"), CSS, or "xpath/...".`);
    }
    if (selector.startsWith("p-") && !LEGACY_SELECTOR_PREFIXES.some(prefix => selector.startsWith(prefix))) {
        throw new ToolError(`Unsupported selector prefix. Use CSS or puppeteer query handlers (aria/, text/, xpath/, pierce/). Got: ${selector}`);
    }
    if (selector.startsWith("p-text/"))
        return `text/${selector.slice("p-text/".length)}`;
    if (selector.startsWith("p-xpath/"))
        return `xpath/${selector.slice("p-xpath/".length)}`;
    if (selector.startsWith("p-pierce/"))
        return `pierce/${selector.slice("p-pierce/".length)}`;
    if (selector.startsWith("p-aria/")) {
        const rest = selector.slice("p-aria/".length);
        const nameMatch = rest.match(/\[\s*name\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\]]+))\s*\]/);
        const name = nameMatch?.[1] ?? nameMatch?.[2] ?? nameMatch?.[3];
        if (name)
            return `aria/${name.trim()}`;
        return `aria/${rest}`;
    }
    return selector;
}
function isInteractiveNode(node) {
    if (INTERACTIVE_AX_ROLES.has(node.role))
        return true;
    return (node.checked !== undefined ||
        node.pressed !== undefined ||
        node.selected !== undefined ||
        node.expanded !== undefined ||
        node.focused === true);
}
async function privateTargetId(target) {
    const raw = target;
    if (typeof raw._targetId === "string")
        return raw._targetId;
    const session = await target.createCDPSession();
    try {
        const info = (await session.send("Target.getTargetInfo"));
        if (info.targetInfo?.targetId)
            return info.targetInfo.targetId;
        throw new ToolError("Target id unavailable from CDP target info");
    }
    finally {
        await session.detach().catch(() => undefined);
    }
}
async function createTrackedHeadlessPage(browser, reportTarget) {
    const session = await browser.target().createCDPSession();
    let targetId;
    try {
        ({ targetId } = (await session.send("Target.createTarget", { url: "about:blank" })));
        reportTarget(targetId);
    }
    finally {
        await session.detach().catch(() => undefined);
    }
    const existing = browser.targets().find(target => {
        const raw = target;
        return raw._targetId === targetId;
    });
    const target = existing ??
        (await browser.waitForTarget(candidate => {
            const raw = candidate;
            return raw._targetId === targetId;
        }, { timeout: BROWSER_PROTOCOL_TIMEOUT_MS }));
    const page = await target.page();
    if (!page)
        throw new ToolError(`Created headless target ${targetId} did not expose a page`);
    return page;
}
async function collectObservationEntries(core, node, entries, options) {
    if (options.includeAll || isInteractiveNode(node)) {
        const handle = await node.elementHandle();
        if (handle) {
            let inViewport = true;
            if (options.viewportOnly) {
                try {
                    inViewport = await handle.isIntersectingViewport();
                }
                catch {
                    inViewport = false;
                }
            }
            if (inViewport) {
                const id = core.nextElementId();
                const states = [];
                if (node.disabled)
                    states.push("disabled");
                if (node.checked !== undefined)
                    states.push(`checked=${String(node.checked)}`);
                if (node.pressed !== undefined)
                    states.push(`pressed=${String(node.pressed)}`);
                if (node.selected !== undefined)
                    states.push(`selected=${String(node.selected)}`);
                if (node.expanded !== undefined)
                    states.push(`expanded=${String(node.expanded)}`);
                if (node.required)
                    states.push("required");
                if (node.readonly)
                    states.push("readonly");
                if (node.multiselectable)
                    states.push("multiselectable");
                if (node.multiline)
                    states.push("multiline");
                if (node.modal)
                    states.push("modal");
                if (node.focused)
                    states.push("focused");
                core.cacheElement(id, handle);
                entries.push({
                    id,
                    role: node.role,
                    name: node.name,
                    value: node.value,
                    description: node.description,
                    keyshortcuts: node.keyshortcuts,
                    states,
                });
            }
            else {
                await handle.dispose();
            }
        }
    }
    for (const child of node.children ?? []) {
        await collectObservationEntries(core, child, entries, options);
    }
}
async function toActionableHandle(handle) {
    const target = handle;
    // ElementHandle already provides click/hover/focus/type/getBoundingBox in
    // puppeteer; the cast is a typing convenience only.
    return target;
}
function errorPayload(error) {
    if (error instanceof ToolAbortError) {
        return { name: error.name, message: error.message, stack: error.stack, isToolError: false, isAbort: true };
    }
    if (error instanceof ToolError) {
        return { name: error.name, message: error.message, stack: error.stack, isToolError: true, isAbort: false };
    }
    if (error instanceof Error) {
        return { name: error.name, message: error.message, stack: error.stack, isToolError: false, isAbort: false };
    }
    return { name: "Error", message: String(error), isToolError: false, isAbort: false };
}
export class WorkerCore {
    #transport;
    /** Child-of-cli mode: verbose transport logging over the wire. */
    #cliMode;
    #mode = null;
    #browser = null;
    #page = null;
    #active = null;
    #dialogHandler = null;
    #openDialog = null;
    #elementCache = new Map();
    #elementIdSeq = 0;
    #stealthState = {
        browserSession: null,
        override: null,
    };
    #prefs = { activateForScreenshot: true };
    constructor(transport, cliMode) {
        this.#transport = transport;
        this.#cliMode = cliMode;
        this.#register();
    }
    #register() {
        const unlisten = this.#transport.onMessage(msg => void this.#handle(msg));
        // Inline mode keeps the instance alive through the transport's queues.
        this.#cleanupUnlisten = unlisten;
    }
    #cleanupUnlisten = null;
    async #handle(msg) {
        switch (msg.type) {
            case "init":
                await this.#init(msg.payload);
                break;
            case "run":
                await this.#run(msg);
                break;
            case "abort":
                this.#abort(msg.id);
                break;
            case "tool-reply":
                // Not used in the DSH port (tool() is unsupported); ignore.
                break;
            case "close":
                await this.#close();
                break;
        }
    }
    async #init(payload) {
        try {
            const puppeteer = await loadPuppeteerInWorker();
            this.#transport.send({ type: "setup" });
            const browser = await puppeteer.connect({
                browserWSEndpoint: payload.browserWSEndpoint,
                defaultViewport: null,
                protocolTimeout: BROWSER_PROTOCOL_TIMEOUT_MS,
            });
            this.#browser = browser;
            this.#mode = payload.mode;
            if (payload.dialogs)
                await this.#installDialogHandler(payload.dialogs);
            let page;
            if (payload.mode === "headless") {
                page = await createTrackedHeadlessPage(browser, targetId => {
                    this.#transport.send({ type: "page-created", targetId });
                });
                this.#prefs.activateForScreenshot = true;
                await applyStealthPatches(browser, page, this.#stealthState);
                await applyViewport(page, payload.viewport);
            }
            else {
                // attach mode: adopt the resolved target page.
                const target = browser.targets().find(async (candidate) => {
                    const raw = candidate;
                    return raw._targetId === payload.targetId;
                });
                const resolved = target ??
                    (await browser.waitForTarget(candidate => {
                        const raw = candidate;
                        return raw._targetId === payload.targetId;
                    }, { timeout: BROWSER_PROTOCOL_TIMEOUT_MS }));
                const adopted = await resolved.page();
                if (!adopted)
                    throw new ToolError(`Target ${payload.targetId} did not expose a page`);
                page = adopted;
                this.#prefs.activateForScreenshot = payload.activateForScreenshot !== false;
                if (payload.recover) {
                    await this.#recoverBlockedPage(page);
                }
            }
            this.#page = page;
            if (payload.url) {
                await page.goto(payload.url, {
                    waitUntil: payload.waitUntil ?? "load",
                    timeout: payload.timeoutMs,
                });
            }
            if (this.#active || this.#closed) {
                // A close raced the init; tear the fresh page down.
                await page.close().catch(() => undefined);
                return;
            }
            const targetId = await privateTargetId(page.target());
            const info = {
                url: page.url(),
                title: await page.title().catch(() => undefined),
                viewport: (await page.viewport()) ?? { width: 0, height: 0 },
                targetId,
            };
            this.#transport.send({ type: "ready", info });
        }
        catch (error) {
            this.#transport.send({ type: "init-failed", error: errorPayload(error) });
        }
    }
    async #recoverBlockedPage(page) {
        // Stop a pending navigation so a blocked target cannot stall worker init.
        const session = await page.createCDPSession().catch(() => null);
        if (!session)
            return;
        try {
            await Promise.race([
                session.send("Page.stopLoading").catch(() => undefined),
                new Promise(resolve => setTimeout(resolve, 2_000)),
            ]);
        }
        finally {
            await session.detach().catch(() => undefined);
        }
    }
    async #installDialogHandler(policy) {
        if (!this.#page)
            return;
        const handler = async (dialog) => {
            this.#openDialog = { type: dialog.type(), message: dialog.message() };
            try {
                if (policy === "accept")
                    await dialog.accept();
                else
                    await dialog.dismiss();
            }
            finally {
                this.#openDialog = null;
            }
        };
        this.#page.on("dialog", handler);
        this.#dialogHandler = handler;
    }
    async #run(msg) {
        if (this.#active) {
            this.#transport.send({ type: "result", id: msg.id, ok: false, error: errorPayload(new ToolError("Tab worker is busy")) });
            return;
        }
        const timeoutSignal = AbortSignal.timeout(msg.timeoutMs);
        const ac = new AbortController();
        const runAc = new AbortController();
        const signal = AbortSignal.any([timeoutSignal, ac.signal, runAc.signal]);
        const output = new RunOutput();
        const screenshots = [];
        const active = { id: msg.id, ac, signal, output, screenshots, pendingTools: new Map(), inflight: new Map(), opCounter: 0 };
        this.#active = active;
        let returnValue;
        try {
            throwIfAborted(signal);
            if (!this.#page)
                throw new ToolError("Tab worker is not initialized");
            const page = this.#page;
            const browser = this.#browser;
            const tabApi = this.#createTabApi(msg.name, msg.timeoutMs, signal, msg.session, output, screenshots, active);
            const hooks = {
                onText: (text) => output.pushText(text),
                onDisplay: (payload) => output.pushDisplay(payload),
            };
            const scope = {
                page,
                browser,
                tab: tabApi,
                assert: (cond, text) => {
                    if (!cond)
                        throw new ToolError(text ?? "Assertion failed");
                },
                wait: (msOrPredicate, opts) => {
                    return this.#runOp(active, typeof msOrPredicate === "number" ? `wait(${msOrPredicate}ms)` : "wait(predicate)", Number.POSITIVE_INFINITY, sig => waitForRun(msOrPredicate, sig, {
                        timeout: typeof msOrPredicate === "number" ? undefined : resolveWaitTimeout(msg.timeoutMs, opts?.timeout),
                        interval: opts?.interval,
                    }));
                },
                sleep: (ms) => this.#runOp(active, `sleep(${ms}ms)`, Number.POSITIVE_INFINITY, sig => untilAborted(sig, new Promise(resolve => setTimeout(resolve, ms)))),
                display: createDisplay(hooks),
                print: createPrint(hooks),
                console: createConsole(hooks),
            };
            const onCancel = () => {
                const abortError = signal.reason instanceof ToolAbortError ? signal.reason : new ToolAbortError(undefined, { cause: signal.reason });
                if (timeoutSignal.aborted) {
                    const stalled = describeInflight(active.inflight);
                    const dialog = this.#openDialog;
                    const dialogNote = dialog
                        ? `; a ${dialog.type}(${JSON.stringify(dialog.message.slice(0, 80))}) dialog opened during this run and may still block the page — reopen the tab with dialogs:"accept"|"dismiss"`
                        : "";
                    runAc.abort(new ToolError(`Browser code execution timed out after ${msg.timeoutMs}ms${stalled ? ` (stalled on ${stalled})` : ""}${dialogNote}`));
                }
                else {
                    runAc.abort(abortError);
                }
                for (const pending of active.pendingTools.values())
                    pending.reject(abortError);
                active.pendingTools.clear();
            };
            if (signal.aborted)
                onCancel();
            else
                signal.addEventListener("abort", onCancel, { once: true });
            returnValue = await runJsCode(msg.code, scope, { name: msg.name, hooks });
        }
        catch (error) {
            this.#transport.send({
                type: "result",
                id: msg.id,
                ok: false,
                error: errorPayload(error),
            });
            return;
        }
        finally {
            this.#active = null;
            ac.abort();
        }
        for (const handle of this.#elementCache.values()) {
            void handle.dispose().catch(() => undefined);
        }
        this.#elementCache.clear();
        this.#transport.send({
            type: "result",
            id: msg.id,
            ok: true,
            payload: {
                displays: output.finish(),
                returnValue: cloneSafe(returnValue),
                screenshots,
            },
        });
    }
    #abort(id) {
        const active = this.#active;
        if (active && active.id === id)
            active.ac.abort();
    }
    async #close() {
        this.#active?.ac.abort();
        this.#active = null;
        this.#cleanupUnlisten?.();
        this.#cleanupUnlisten = null;
        this.#elementCache.clear();
        const page = this.#page;
        if (this.#dialogHandler && page && !page.isClosed())
            page.off("dialog", this.#dialogHandler);
        if (this.#mode === "headless" && page && !page.isClosed())
            await page.close().catch(() => undefined);
        if (this.#browser?.connected)
            this.#browser.disconnect();
        this.#closed = true;
        this.#transport.send({ type: "closed" });
        this.#transport.close();
    }
    #closed = false;
    #requirePage() {
        if (!this.#page)
            throw new ToolError("Tab worker is not initialized");
        return this.#page;
    }
    #requireBrowser() {
        if (!this.#browser)
            throw new ToolError("Tab worker is not initialized");
        return this.#browser;
    }
    #log(level, msg, meta) {
        this.#transport.send({ type: "log", level, msg, meta });
    }
    // -------------------------------------------------------------------------
    // Element cache + ids
    // -------------------------------------------------------------------------
    nextElementId() {
        return ++this.#elementIdSeq;
    }
    cacheElement(id, handle) {
        this.#elementCache.set(id, handle);
    }
    #clearElementCache() {
        for (const handle of this.#elementCache.values())
            void handle.dispose().catch(() => undefined);
        this.#elementCache.clear();
    }
    // -------------------------------------------------------------------------
    // Observation / snapshot / screenshot
    // -------------------------------------------------------------------------
    async #collectObservation(options) {
        const page = this.#requirePage();
        this.#clearElementCache();
        this.#elementIdSeq = 0;
        const includeAll = options.includeAll ?? false;
        const viewportOnly = options.viewportOnly ?? false;
        const snapshot = (await untilAborted(options.signal, () => page.accessibility.snapshot({ interestingOnly: !includeAll })));
        if (!snapshot)
            throw new ToolError("Accessibility snapshot unavailable");
        const entries = [];
        await collectObservationEntries(this, snapshot, entries, { includeAll, viewportOnly });
        const scroll = await page.evaluate(() => ({
            x: window.scrollX,
            y: window.scrollY,
            width: window.innerWidth,
            height: window.innerHeight,
            scrollWidth: document.documentElement.scrollWidth,
            scrollHeight: document.documentElement.scrollHeight,
        }));
        const viewport = await page.viewport();
        return {
            url: page.url(),
            title: await page.title().catch(() => undefined),
            viewport: viewport ?? { width: 0, height: 0 },
            scroll,
            elements: entries,
        };
    }
    async #ariaSnapshot(page, selector, options) {
        let root = null;
        if (selector) {
            const handle = await untilAborted(undefined, () => page.$(normalizeSelector(selector)));
            if (!handle)
                throw new ToolError(`tab.ariaSnapshot: selector ${JSON.stringify(selector)} matched no element`);
            root = handle;
        }
        try {
            return await captureAriaSnapshot(page, root, options);
        }
        finally {
            if (root)
                await root.dispose().catch(() => undefined);
        }
    }
    async #screenshot(active, page, opts, timeoutMs, session, output, screenshots) {
        let handle = null;
        if (opts.selector) {
            handle = await untilAborted(active.signal, () => page.$(normalizeSelector(opts.selector)));
            if (!handle)
                throw new ToolError(`tab.screenshot: selector ${JSON.stringify(opts.selector)} matched no element`);
        }
        try {
            if (this.#prefs.activateForScreenshot) {
                await Promise.race([page.bringToFront(), new Promise(resolve => setTimeout(resolve, 2_000))]);
            }
            const capture = handle ? handle.screenshot({ encoding: "binary", fullPage: false }) : page.screenshot({ encoding: "binary", fullPage: opts.fullPage ?? false });
            const buffer = (await withTimeout(capture, timeoutMs, `tab.screenshot timed out after ${timeoutMs}ms`, active.signal));
            const mimeType = "image/png";
            const dims = await imageDimensions(buffer);
            const destDir = session.browserScreenshotDir ?? os.tmpdir();
            const dest = path.join(destDir, `dsh-browser-shot-${uid.next()}.png`);
            await fs.promises.writeFile(dest, buffer);
            // Model copy: recompress toward the vision budget.
            const resized = await resizeImage({ data: buffer.toString("base64"), mimeType }, { excludeWebP: session.excludeWebP });
            const modelImage = {
                type: "image",
                data: resized.data,
                mimeType: resized.mimeType,
                width: resized.width || dims.width,
                height: resized.height || dims.height,
                dest,
            };
            screenshots.push({ dest, mimeType, bytes: buffer.length, width: dims.width, height: dims.height });
            if (!opts.silent) {
                output.push({ type: "text", text: `Screenshot captured: ${mimeType} (${(buffer.length / 1024).toFixed(2)} KB, ${dims.width}x${dims.height})` });
                output.push(modelImage);
            }
            return dest;
        }
        finally {
            if (handle)
                await handle.dispose().catch(() => undefined);
        }
    }
    // -------------------------------------------------------------------------
    // Tab helper API
    // -------------------------------------------------------------------------
    #createTabApi(name, cellTimeoutMs, signal, session, output, screenshots, active) {
        const page = this.#requirePage();
        const { budgetBound, quickOpMs, actionOpMs } = resolveOpTimeouts(cellTimeoutMs);
        const INF = Number.POSITIVE_INFINITY;
        const op = (label, timeoutMs, fn, opts) => this.#runOp(active, label, timeoutMs, fn, opts);
        const quick = (label, fn) => op(label, quickOpMs, fn);
        const action = (label, fn, opts) => op(label, actionOpMs, fn, { ...opts, zeroMatchAfterMs: opts?.selector === undefined ? undefined : ZERO_MATCH_FAIL_FAST_MS });
        const waitMs = (explicit) => resolveWaitTimeout(cellTimeoutMs, explicit);
        const resolveHandle = async (selector, w, sig) => {
            if (typeof selector !== "string")
                return toActionableHandle(selector);
            const ref = parseAriaRefSelector(selector);
            if (ref !== null)
                return toActionableHandle(await this.#resolveAriaRef(selector, sig));
            const handle = await untilAborted(sig, () => page.waitForSelector(normalizeSelector(selector), { timeout: w, visible: true, signal: sig }));
            if (!handle)
                throw new ToolError(`Selector ${JSON.stringify(selector)} matched no visible element within ${w}ms`);
            return toActionableHandle(handle);
        };
        return {
            name,
            page,
            url: () => page.url(),
            title: () => quick("tab.title()", sig => untilAborted(sig, () => page.title())),
            goto: (url, opts) => op(`tab.goto(${JSON.stringify(url)})`, INF, async (sig) => {
                await untilAborted(sig, () => page.goto(url, { waitUntil: opts?.waitUntil ?? "load", timeout: budgetBound, signal: sig }));
            }),
            observe: (opts) => quick("tab.observe()", sig => this.#collectObservation({ ...opts, signal: sig })),
            ariaSnapshot: (selector, opts) => quick("tab.ariaSnapshot()", sig => untilAborted(sig, () => this.#ariaSnapshot(page, selector, opts ?? {}))),
            screenshot: (opts) => op("tab.screenshot()", quickOpMs, sig => this.#screenshot(active, page, opts ?? {}, quickOpMs, session, output, screenshots)),
            extract: (format) => quick("tab.extract()", async (sig) => {
                const html = await untilAborted(sig, () => page.content());
                const result = await extractReadableFromHtml(html, page.url(), format ?? "markdown");
                if (!result)
                    throw new ToolError("No readable content found on this page");
                const text = result.markdown ?? result.text ?? "";
                output.push({ type: "text", text });
                return `${result.title ?? "(untitled)"} — ${result.contentLength} chars`;
            }),
            click: (selector) => action(`tab.click(${JSON.stringify(selDesc(selector))})`, async (sig) => {
                const handle = await resolveHandle(ensureStr(selector, "click"), actionOpMs, sig);
                try {
                    await withTimeout(handle.click({}), actionOpMs, `tab.click timed out after ${actionOpMs}ms`, sig);
                }
                finally {
                    await handle.dispose().catch(() => undefined);
                }
            }),
            type: (selector, text) => action(`tab.type(${JSON.stringify(selDesc(selector))})`, async (sig) => {
                const handle = await resolveHandle(ensureStr(selector, "type"), actionOpMs, sig);
                try {
                    await withTimeout(handle.type(text, { delay: 8 }), actionOpMs, `tab.type timed out after ${actionOpMs}ms`, sig);
                }
                finally {
                    await handle.dispose().catch(() => undefined);
                }
            }),
            fill: (selector, value) => action(`tab.fill(${JSON.stringify(selDesc(selector))})`, async (sig) => {
                const handle = await resolveHandle(ensureStr(selector, "fill"), actionOpMs, sig);
                try {
                    await withTimeout(this.#fillHandle(handle, value, sig), actionOpMs, `tab.fill timed out after ${actionOpMs}ms`, sig);
                }
                finally {
                    await handle.dispose().catch(() => undefined);
                }
            }),
            press: (key, opts) => action(`tab.press(${key})`, async (sig) => {
                const selector = opts?.selector;
                if (selector) {
                    const handle = await resolveHandle(selector, actionOpMs, sig);
                    try {
                        await handle.focus();
                    }
                    finally {
                        await handle.dispose().catch(() => undefined);
                    }
                }
                await page.keyboard.press(key);
            }),
            scroll: (deltaX, deltaY) => op(`tab.scroll(${deltaX}, ${deltaY})`, actionOpMs, async (sig) => {
                await page.mouse.wheel({ deltaX, deltaY });
            }),
            drag: (from, to) => op("tab.drag()", actionOpMs, async (sig) => {
                await drag(page, from, to, sig);
            }),
            waitFor: (selector, opts) => {
                const w = waitMs(opts?.timeout);
                return op(`tab.waitFor(${JSON.stringify(selector)})`, w, sig => resolveHandle(selector, w, sig), {
                    selector,
                    zeroMatchAfterMs: opts?.timeout === undefined ? ZERO_MATCH_FAIL_FAST_MS : undefined,
                });
            },
            waitForSelector: (selector, opts) => {
                const w = waitMs(opts?.timeout);
                return op(`tab.waitForSelector(${JSON.stringify(selector)})`, w, async (sig) => {
                    if (parseAriaRefSelector(selector) !== null)
                        return toActionableHandle(await this.#resolveAriaRef(selector, sig));
                    const handle = (await untilAborted(sig, () => page.waitForSelector(normalizeSelector(selector), { timeout: w, visible: opts?.visible, hidden: opts?.hidden, signal: sig })));
                    return handle ? toActionableHandle(handle) : null;
                }, { selector, zeroMatchAfterMs: opts?.timeout === undefined && !opts?.hidden ? ZERO_MATCH_FAIL_FAST_MS : undefined });
            },
            waitForNavigation: (opts) => op("tab.waitForNavigation()", waitMs(opts?.timeout), sig => untilAborted(sig, () => page.waitForNavigation({ waitUntil: opts?.waitUntil ?? "load", timeout: waitMs(opts?.timeout), signal: sig }))),
            evaluate: (fn, ...args) => op("tab.evaluate()", INF, sig => untilAborted(sig, () => typeof fn === "string" ? page.evaluate(fn) : page.evaluate(fn, ...args))),
            scrollIntoView: (selector) => action(`tab.scrollIntoView(${JSON.stringify(selector)})`, async (sig) => {
                const handle = await resolveHandle(selector, actionOpMs, sig);
                try {
                    await untilAborted(sig, () => handle.evaluate(el => {
                        el.scrollIntoView({
                            behavior: "instant",
                            block: "center",
                            inline: "center",
                        });
                    }));
                }
                finally {
                    await handle.dispose().catch(() => undefined);
                }
            }, { selector }),
            select: (selector, ...values) => action(`tab.select(${JSON.stringify(selector)})`, sig => page.select(selector, ...values), { selector }),
            uploadFile: (selector, ...filePaths) => action(`tab.uploadFile(${JSON.stringify(selector)})`, async (sig) => {
                const handle = await resolveHandle(ensureStr(selector, "uploadFile"), actionOpMs, sig);
                try {
                    await handle.uploadFile(...filePaths.map(p => resolveInCwd(p, session.cwd)));
                }
                finally {
                    await handle.dispose().catch(() => undefined);
                }
            }, { selector }),
            waitForUrl: (pattern, opts) => {
                const w = waitMs(opts?.timeout);
                return op("tab.waitForUrl()", w, sig => this.#waitForUrl(page, pattern, w, sig));
            },
            waitForResponse: (pattern, opts) => {
                const w = waitMs(opts?.timeout);
                return op("tab.waitForResponse()", w, sig => this.#waitForResponse(page, pattern, w, sig));
            },
            id: async (id) => toActionableHandle(await this.#resolveCachedHandle(id)),
            ref: async (id) => toActionableHandle(await this.#resolveAriaRef(id, signal)),
            signal,
        };
    }
    async #fillHandle(handle, value, signal) {
        const tag = await handle.evaluate(el => ({ tag: el.tagName, type: el.type, isContentEditable: el.isContentEditable }));
        if (tag.tag === "TEXTAREA" || (tag.tag === "INPUT" && tag.type !== "checkbox" && tag.type !== "radio")) {
            await handle.click();
            await handle.evaluate(el => (el.value = ""));
            await handle.type(value, { delay: 5 });
            return;
        }
        if (tag.isContentEditable) {
            await handle.click();
            await handle.evaluate(el => {
                el.innerText = "";
            });
            await handle.type(value, { delay: 5 });
            return;
        }
        throw new ToolError(`tab.fill target is not fillable (${tag.tag}${tag.type ? ` type="${tag.type}"` : ""})`);
    }
    async #waitForUrl(page, pattern, timeoutMs, signal) {
        const deadline = Date.now() + timeoutMs;
        const matches = (url) => {
            if (typeof pattern === "string")
                return url.includes(pattern);
            pattern.lastIndex = 0;
            return pattern.test(url);
        };
        for (;;) {
            throwIfAborted(signal);
            const url = page.url();
            if (matches(url))
                return url;
            if (Date.now() >= deadline)
                throw new ToolError(`tab.waitForUrl timed out after ${timeoutMs}ms waiting for ${String(pattern)}`);
            await new Promise(resolve => setTimeout(resolve, 200));
        }
    }
    async #waitForResponse(page, pattern, timeoutMs, signal) {
        return await new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                page.off("response", onResponse);
                reject(new ToolError(`tab.waitForResponse timed out after ${timeoutMs}ms`));
            }, timeoutMs);
            const onAbort = () => {
                clearTimeout(timer);
                page.off("response", onResponse);
                reject(new ToolAbortError(undefined, { cause: signal.reason }));
            };
            const onResponse = (response) => {
                const url = response.url();
                const matched = typeof pattern === "function"
                    ? pattern(response)
                    : typeof pattern === "string"
                        ? url.includes(pattern)
                        : (pattern.lastIndex = 0, pattern.test(url));
                if (matched) {
                    clearTimeout(timer);
                    signal.removeEventListener("abort", onAbort);
                    page.off("response", onResponse);
                    resolve(response);
                }
            };
            if (signal.aborted)
                onAbort();
            else
                signal.addEventListener("abort", onAbort, { once: true });
            page.on("response", onResponse);
        });
    }
    async #resolveCachedHandle(id) {
        const handle = this.#elementCache.get(id);
        if (!handle)
            throw new ToolError(`Element id ${id} is stale — re-run tab.observe() to refresh ids`);
        return handle;
    }
    async #resolveAriaRef(selector, sig) {
        const ref = parseAriaRefSelector(selector);
        if (!ref)
            throw new ToolError(`Not an aria ref selector: ${selector}`);
        const handle = await untilAborted(sig, () => resolveAriaRefHandle(this.#requirePage(), ref));
        if (!handle)
            throw new ToolError(`Aria ref ${ref} no longer matches any element — re-run tab.ariaSnapshot()`);
        return handle;
    }
    async #runOp(active, label, timeoutMs, fn, opts) {
        const opId = ++active.opCounter;
        active.inflight.set(label, "op");
        const cellSignal = active.signal;
        try {
            throwIfAborted(cellSignal);
            return await untilAborted(cellSignal, () => timeoutMs === Number.POSITIVE_INFINITY
                ? fn(cellSignal)
                : withTimeout(fn(cellSignal), timeoutMs, `${label} timed out after ${timeoutMs}ms`, cellSignal));
        }
        catch (error) {
            if (error instanceof ToolError && error.message.includes("timed out after") && !error.message.includes("cell")) {
                // Named per-op failure; leave the cell alive.
                throw error;
            }
            throw error;
        }
        finally {
            active.inflight.delete(label);
            void opId;
        }
    }
}
function selDesc(selector) {
    return typeof selector === "string" ? selector : "<handle>";
}
function ensureStr(selector, fn) {
    assertSelectorString(selector);
    return selector;
}
function describeInflight(inflight) {
    const entries = [...inflight.keys()];
    if (entries.length === 0)
        return "";
    return ` ${entries.join(", ")}`;
}
function resolveInCwd(p, cwd) {
    if (p === "~" || p.startsWith("~/")) {
        const homedir = os.homedir();
        return p === "~" ? homedir : path.join(homedir, p.slice(2));
    }
    return path.isAbsolute(p) ? p : path.resolve(cwd, p);
}
async function drag(page, from, to, signal) {
    let fromPoint;
    let toPoint;
    if (typeof from === "string") {
        const handle = await page.$(normalizeSelector(from));
        if (!handle)
            throw new ToolError(`tab.drag: source selector matched no element`);
        const box = await handle.boundingBox();
        await handle.dispose();
        if (!box)
            throw new ToolError("tab.drag: source element has no bounding box");
        fromPoint = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    }
    else
        fromPoint = from;
    if (typeof to === "string") {
        const handle = await page.$(normalizeSelector(to));
        if (!handle)
            throw new ToolError(`tab.drag: target selector matched no element`);
        const box = await handle.boundingBox();
        await handle.dispose();
        if (!box)
            throw new ToolError("tab.drag: target element has no bounding box");
        toPoint = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    }
    else
        toPoint = to;
    await untilAborted(signal, async () => {
        await page.mouse.move(fromPoint.x, fromPoint.y);
        await page.mouse.down();
        await page.mouse.move(toPoint.x, toPoint.y, { steps: 12 });
        await page.mouse.up();
    });
}
/** Poll `msOrPredicate` until truthy or timeout (mirrors the original `waitForRun`). */
async function waitForRun(msOrPredicate, signal, opts) {
    if (typeof msOrPredicate === "number") {
        await untilAborted(signal, new Promise(resolve => setTimeout(resolve, msOrPredicate)));
        return;
    }
    const interval = opts?.interval ?? 100;
    const timeout = opts?.timeout ?? 30_000;
    const deadline = Date.now() + timeout;
    for (;;) {
        throwIfAborted(signal);
        if (await msOrPredicate())
            return;
        if (Date.now() >= deadline)
            throw new ToolError(`wait(predicate) timed out after ${timeout}ms`);
        await new Promise(resolve => setTimeout(resolve, interval));
    }
}
/** Read PNG dimensions from the header (fast, no decode). */
async function imageDimensions(buffer) {
    if (buffer.length >= 24 && buffer[0] === 0x89 && buffer[1] === 0x50) {
        return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
    }
    // JPEG passive probe
    if (buffer.length > 4 && buffer[0] === 0xff && buffer[1] === 0xd8) {
        let offset = 2;
        while (offset + 9 < buffer.length) {
            if (buffer[offset] !== 0xff) {
                offset++;
                continue;
            }
            while (offset < buffer.length && buffer[offset] === 0xff)
                offset++;
            const marker = buffer[offset++];
            if (marker === 0xd9 || marker === 0xda)
                break;
            if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7))
                continue;
            const length = buffer.readUInt16BE(offset);
            if (marker >= 0xc0 && marker <= 0xcf && !(marker === 0xc4 || marker === 0xc8 || marker === 0xcc)) {
                return { width: buffer.readUInt16BE(offset + 5), height: buffer.readUInt16BE(offset + 3) };
            }
            offset += length;
        }
    }
    return { width: 0, height: 0 };
}
