/**
 * CDP endpoint probing, free-port allocation, and reusable-browser discovery.
 * Ported from oh-my-pi `attach.ts`; `Bun.connect` → `node:net`, pi-natives
 * process enumeration → `./process`.
 */
import * as net from "node:net";
import { ToolError, throwIfAborted } from "./../errors.js";
import { processesByExecutable, terminateProcessTree } from "./process.js";
const ATTACH_TARGET_SKIP_PATTERN = /request[\s_-]?handler|devtools|background[\s_-]?(?:page|host)|service[\s_-]?worker/i;
/** Allocate an unused TCP port on 127.0.0.1 by binding to port 0 and reading back the kernel-assigned port. */
export async function findFreeCdpPort() {
    const { promise, resolve, reject } = Promise.withResolvers();
    const server = net.createServer();
    server.unref();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
        const addr = server.address();
        if (addr && typeof addr === "object" && typeof addr.port === "number") {
            const port = addr.port;
            server.close(closeErr => (closeErr ? reject(closeErr) : resolve(port)));
        }
        else {
            server.close();
            reject(new Error("Failed to allocate ephemeral CDP port"));
        }
    });
    return promise;
}
/**
 * Loopback HTTP/1.1 GET that never routes through a proxy, resolving to the
 * response status code (or null when the endpoint is unreachable, aborted,
 * malformed, or slow past `timeoutMs`). Raw TCP sidesteps HTTP(S)_PROXY.
 */
export async function probeCdpStatus(url, opts) {
    let target;
    try {
        target = new URL(url);
    }
    catch {
        return null;
    }
    if (opts.signal?.aborted)
        return null;
    const port = target.port ? Number(target.port) : 80;
    const requestPath = `${target.pathname}${target.search}` || "/";
    const { promise, resolve } = Promise.withResolvers();
    let socket;
    let settled = false;
    const finish = (status) => {
        if (settled)
            return;
        settled = true;
        clearTimeout(timer);
        opts.signal?.removeEventListener("abort", onAbort);
        try {
            socket?.end();
        }
        catch {
            // socket already torn down
        }
        resolve(status);
    };
    const onAbort = () => finish(null);
    const timer = setTimeout(() => finish(null), opts.timeoutMs);
    opts.signal?.addEventListener("abort", onAbort, { once: true });
    let buffered = "";
    try {
        socket = net.connect({ host: target.hostname, port });
        socket.once("connect", () => {
            socket?.write(`GET ${requestPath} HTTP/1.1\r\nHost: ${target.hostname}:${port}\r\nConnection: close\r\n\r\n`);
        });
        socket.on("data", chunk => {
            buffered += chunk.toString("latin1");
            const match = /^HTTP\/\d(?:\.\d)? (\d{3})/.exec(buffered);
            if (match)
                finish(Number(match[1]));
        });
        socket.on("error", () => finish(null));
        socket.on("close", () => finish(null));
    }
    catch {
        finish(null);
    }
    return promise;
}
/** Poll `${cdpUrl}/json/version` until it responds with 200, with abort + timeout support. */
export async function waitForCdp(cdpUrl, timeoutMs, signal) {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
        throwIfAborted(signal);
        const status = await probeCdpStatus(`${cdpUrl}/json/version`, { timeoutMs: 1_000, signal });
        if (status !== null && status >= 200 && status < 300)
            return;
        if (Date.now() >= deadline)
            throw new ToolError(`Timed out waiting for CDP endpoint at ${cdpUrl}`);
        await new Promise(resolve => setTimeout(resolve, 250));
    }
}
export function findReusableCdp(executablePath, selfPid) {
    for (const proc of processesByExecutable(executablePath)) {
        if (proc.pid === selfPid)
            continue;
        const debuggingIndex = proc.args.findIndex(arg => arg.startsWith("--remote-debugging-port=") || arg === "--remote-debugging-pipe");
        if (debuggingIndex < 0)
            continue;
        const portMatch = /^--remote-debugging-port=(\d+)$/.exec(proc.args[debuggingIndex] ?? "");
        return {
            pid: proc.pid,
            cdpUrl: portMatch ? `http://127.0.0.1:${portMatch[1]}` : undefined,
            args: proc.args,
        };
    }
    return null;
}
/**
 * Pick the CDP page target to attach: skip service-workers / DevTools /
 * extension pages, then prefer the visible (active) page, else the first
 * ordinary page.
 */
export async function pickElectronTarget(browser, opts) {
    throwIfAborted(opts.signal);
    const targets = browser.targets().filter(target => target.type() === "page");
    if (targets.length === 0)
        throw new ToolError("No page targets available to attach");
    let candidates = targets.filter(target => !ATTACH_TARGET_SKIP_PATTERN.test(target.url()));
    if (candidates.length === 0)
        candidates = targets;
    if (opts.target) {
        const needle = opts.target.toLowerCase();
        const match = candidates.find(target => target.url().toLowerCase().includes(needle));
        if (!match)
            throw new ToolError(`No page matches target "${opts.target}"`);
        const page = await match.page();
        if (!page)
            throw new ToolError("Matched target did not expose a page");
        return page;
    }
    // Prefer the visible (active) tab.
    const withPages = (await Promise.all(candidates.map(async (target) => {
        const page = await target.page();
        return page ? { target, page } : null;
    }))).filter((entry) => entry !== null);
    const active = (await Promise.all(withPages.map(async (entry) => ({ entry, visible: await isPageVisible(entry.page) })))).find(candidate => candidate.visible)?.entry;
    const chosen = active ?? withPages[0];
    if (!chosen)
        throw new ToolError("No attachable page found");
    return chosen.page;
}
/** `document.visibilityState === 'visible'` (no puppeteer helper for this). */
async function isPageVisible(page) {
    try {
        return await page.evaluate(() => document.visibilityState === "visible" && !document.hidden);
    }
    catch {
        return false;
    }
}
/** Whether a CDP-connected (non-owned) browser should be left at rest between runs. */
export function shouldPreserveConnectedBrowserFocus(_browser) {
    return true;
}
/**
 * Tear down every running process matching `executablePath` (single-instance
 * apps may keep an orphan around). Returns the number of processes killed.
 */
export async function killExistingByPath(executablePath, signal) {
    const processes = processesByExecutable(executablePath);
    if (processes.length === 0)
        return 0;
    for (const proc of processes) {
        throwIfAborted(signal);
        await terminateProcessTree(proc.pid, 3000);
    }
    return processes.length;
}
/** Best-effort extraction of a target's CDP target id (puppeteer internal field). */
export async function targetIdForPage(page) {
    const raw = page.target();
    if (typeof raw._targetId === "string")
        return raw._targetId;
    const session = await page.target().createCDPSession();
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
