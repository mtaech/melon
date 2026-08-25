/**
 * Relay daemon lifecycle. oh-my-pi brokers a background daemon process with
 * start/stop/wait primitives; DSH has no such broker, so this module reduces
 * to: probe the endpoint, and if nothing answers, spawn a detached child
 * `node lib/relay/cli.js serve --port <p>` and re-probe. If a relay already
 * answers (adopt semantics), it is used as-is.
 */
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { probeCdpStatus } from "./../browsers/attach.js";
import { logger } from "./../util.js";
export function isLoopbackRelayUrl(url) {
    try {
        const parsed = new URL(url);
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:")
            return false;
        const host = parsed.hostname;
        return host === "127.0.0.1" || host === "localhost" || host === "::1";
    }
    catch {
        return false;
    }
}
/**
 * Ensure a relay answers at `cdpUrl`.
 * Returns false when a loopback relay could not be started or verified.
 */
export async function ensureRelayDaemon(options) {
    const probeUrl = `${options.cdpUrl.replace(/\/+$/, "")}/json/version`;
    const ok = await probeCdpStatus(probeUrl, { timeoutMs: 2_000, signal: options.signal });
    if (ok !== null && ok >= 200 && ok < 300)
        return true;
    const url = new URL(options.cdpUrl);
    const port = Number(url.port) || 9224;
    const cliPath = fileURLToPath(new URL("./cli.js", import.meta.url));
    const child = spawn(process.execPath, [cliPath, "serve", "--port", String(port)], {
        detached: process.platform !== "win32",
        stdio: "ignore",
        env: { ...process.env, DSH_BROWSER_RELAY_SPAWNED: "1" },
    });
    child.unref();
    logger.info("spawned browser relay daemon", { port, pid: child.pid });
    // Wait for the endpoint to answer (2520ms total, matching adoption give-up).
    for (let attempt = 0; attempt < 12; attempt++) {
        if (options.signal?.aborted)
            return false;
        const status = await probeCdpStatus(probeUrl, { timeoutMs: 1_200, signal: options.signal });
        if (status !== null && status >= 200 && status < 300)
            return true;
        await new Promise(resolve => setTimeout(resolve, 150));
    }
    logger.warn("browser relay daemon did not come up", { port });
    return false;
}
