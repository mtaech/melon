/**
 * Local CDP relay HTTP + websocket server. Ported from oh-my-pi
 * `relay/server.ts` (Bun.serve → Node http + ws).
 */
import * as http from "node:http";
import { URL } from "node:url";
import { WebSocketServer } from "ws";
import { RelayBridge } from "./bridge.js";
/** Cap on a single inbound frame (256 MiB alike oh-my-pi). */
const MAX_PAYLOAD_BYTES = 256 * 1024 * 1024;
const KEEPALIVE_INTERVAL_MS = 30_000;
/** Extension socket origin allowlist. */
const EXTENSION_ORIGIN = /^chrome-extension:\/\//i;
export async function startRelayServer(options = {}) {
    const log = options.log ?? (() => { });
    const bridge = new RelayBridge({ log, group: options.group ?? null });
    const server = http.createServer((req, res) => {
        void handleHttpGet(bridge, req, res, options.token, () => server.address());
    });
    const wss = new WebSocketServer({
        server,
        maxPayload: MAX_PAYLOAD_BYTES,
        verifyClient: (info) => verifyUpgrade({ origin: info.origin, rawUrl: info.req.url }, options.token),
        perMessageDeflate: false,
    });
    const sockets = new Set();
    wss.on("connection", (raw, request) => {
        const connId = null;
        const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
        if (url.pathname === "/ext") {
            // Chrome extension service workers always send a chrome-extension://
            // origin. Local tooling clients (tests, the relay CLI) may send none;
            // the server binds to loopback only, so accept them. Any other origin
            // is refused.
            const origin = request.headers.origin ?? "";
            if (origin && !EXTENSION_ORIGIN.test(origin)) {
                raw.close(1008, "forbidden origin");
                return;
            }
            const sock = makeSocket(raw, sockets);
            bridge.extConnected(sock);
            raw.on("close", () => {
                sockets.delete(sock);
                bridge.extClosed(sock);
            });
            raw.on("message", data => bridge.extMessage(sock, String(data)));
            log("extension connected");
            return;
        }
        if (url.pathname === "/cdp") {
            const sock = makeSocket(raw, sockets);
            const id = bridge.cdpConnected(sock);
            raw.on("close", () => {
                sockets.delete(sock);
                bridge.cdpClosed(id);
            });
            raw.on("message", data => bridge.cdpMessage(id, String(data)));
            return;
        }
        raw.close(1008, "unknown path");
        void connId;
    });
    // Keepalive pings hold the extension service worker alive.
    const keepalive = setInterval(() => {
        for (const sock of sockets) {
            if (sock.raw.readyState === sock.raw.OPEN)
                sock.raw.ping();
        }
    }, KEEPALIVE_INTERVAL_MS);
    keepalive.unref();
    await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(options.port ?? 0, options.host ?? "127.0.0.1", () => {
            server.off("error", reject);
            resolve();
        });
    });
    const addr = server.address();
    const port = addr.port;
    return {
        port,
        url: `http://127.0.0.1:${port}`,
        async close() {
            clearInterval(keepalive);
            for (const sock of sockets) {
                try {
                    sock.raw.terminate();
                }
                catch {
                    // already gone
                }
            }
            for (const ws of wss.clients) {
                try {
                    ws.terminate();
                }
                catch {
                    // already gone
                }
            }
            await new Promise(resolve => wss.close(() => resolve()));
            await new Promise(resolve => server.close(() => resolve()));
        },
    };
}
function makeSocket(raw, pool) {
    const sock = {
        raw,
        send(text) {
            if (raw.readyState === raw.OPEN)
                raw.send(text);
        },
        close() {
            try {
                raw.close();
            }
            catch {
                // already closed
            }
        },
    };
    pool.add(sock);
    return sock;
}
function verifyUpgrade(info, token) {
    if (!token)
        return true;
    if (info.origin && EXTENSION_ORIGIN.test(info.origin))
        return true;
    const url = new URL(info.rawUrl ?? "/", "http://localhost");
    return url.searchParams.get("token") === token;
}
function requiresAuth(req, token) {
    if (!token)
        return false;
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    return url.searchParams.get("token") !== token;
}
async function handleHttpGet(bridge, req, res, token, getAddr) {
    if (requiresAuth(req, token)) {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "unauthorized" }));
        return;
    }
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    const pathname = url.pathname.replace(/\/+$/, "") || "/";
    const addr = getAddr();
    const wsUrl = `ws://127.0.0.1:${String(addr.port)}/cdp${token ? `?token=${encodeURIComponent(token)}` : ""}`;
    switch (pathname) {
        case "/json/version":
            res.writeHead(bridge.ready ? 200 : 503, { "Content-Type": "application/json" });
            res.end(JSON.stringify(bridge.versionInfo(wsUrl)));
            return;
        case "/json/list":
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify(bridge.listTargets()));
            return;
        case "/json":
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify(bridge.listTargets()));
            return;
        default:
            res.writeHead(404, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "not found" }));
            return;
    }
}
