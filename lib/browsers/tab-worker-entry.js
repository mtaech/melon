/**
 * Tab worker entry for node:worker_threads. The `init` message may already be
 * queued by the time this module's top-level runs (the parent spools messages
 * into the port queue immediately after starting the worker), so we bind the
 * port listener as early as possible.
 */
import { parentPort } from "node:worker_threads";
import { WorkerCore } from "./tab-worker.js";
if (!parentPort)
    throw new Error("tab-worker-entry: missing parentPort");
const port = parentPort;
const transport = {
    send(msg) {
        port.postMessage(msg);
    },
    onMessage(handler) {
        const wrap = (message) => handler(message);
        port.on("message", wrap);
        return () => port.off("message", wrap);
    },
    close() {
        port.close();
    },
};
new WorkerCore(transport, true);
