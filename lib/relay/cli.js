/**
 * Relay CLI: `dsh-browser-relay serve|install|status`. Ported from
 * oh-my-pi `relay/cli.ts` with the daemon-broker machinery removed.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { readAssetText } from "./../asset.js";
import { startRelayServer } from "./server.js";
import { parseFlag } from "./../util.js";
const EXT_ASSET_PREFIX = "relay/extension-assets";
function print(message) {
    console.log(message);
}
async function serve(args) {
    const port = flag(args, "--port", "9224");
    const token = flag(args, "--token", process.env.DSH_BROWSER_RELAY_TOKEN ?? "");
    const quiet = parseFlag(process.env.DSH_BROWSER_RELAY_QUIET, false);
    const noGroup = args.includes("--no-group") || parseFlag(process.env.DSH_BROWSER_RELAY_NO_GROUP, false);
    const groupTitle = flag(args, "--group-title", "omp");
    const groupColor = flag(args, "--group-color", "grey");
    const log = (message, data) => {
        if (quiet)
            return;
        const detail = data ? ` ${JSON.stringify(data)}` : "";
        console.error(`[relay] ${message}${detail}`);
    };
    const handle = await startRelayServer({
        port: Number(port),
        token,
        log,
        group: noGroup ? null : { title: groupTitle, color: groupColor },
    });
    log("browser relay listening", { url: handle.url });
    if (process.env.DSH_BROWSER_RELAY_SPAWNED === "1") {
        // Parent is still probing; keep the heartbeat visible to the parent's probe.
    }
    await new Promise(() => {
        // Run until killed.
    });
    void handle;
}
async function install(args) {
    const dir = flag(args, "--dir", defaultExtensionDir());
    const force = args.includes("--force");
    if (fs.existsSync(dir)) {
        if (force) {
            logForceRemoval(dir);
            fs.rmSync(dir, { recursive: true, force: true });
        }
        else {
            print(`Extension already installed at ${dir} (use --force to reinstall)`);
            return;
        }
    }
    const outDir = path.join(dir, "dist");
    fs.mkdirSync(outDir, { recursive: true });
    const names = ["background.js.txt", "manifest.json.txt", "options.html.txt", "options.js.txt", "LICENSE.txt", "THIRD-PARTY-NOTICES.txt"];
    for (const name of names) {
        const content = await readAssetText(`${EXT_ASSET_PREFIX}/${name}`);
        const outName = name.replace(/\.txt$/, "");
        const outPath = path.join(outDir, outName);
        const prefix = path.dirname(outPath);
        if (prefix)
            fs.mkdirSync(prefix, { recursive: true });
        fs.writeFileSync(outPath, content, "utf8");
    }
    const baseDir = path.dirname(outDir);
    fs.writeFileSync(path.join(baseDir, "README.md"), extReadme(), "utf8");
    print(`Browser relay extension installed at ${dir}`);
    print(`1. Open chrome://extensions, enable Developer mode, click "Load unpacked", and select:\n   ${outDir}`);
    print(`2. Restart the relay with ` + "`dsh-browser-relay serve` if it is already running — the extension will reconnect.");
}
function logForceRemoval(dir) {
    print(`Removing existing installation at ${dir}`);
}
function extReadme() {
    return [
        "# OMP Browser Relay extension",
        "",
        "Load the `dist/` directory as an unpacked extension. It connects to the local",
        "browser relay (default ws://127.0.0.1:9224/ext) and drives `chrome.debugger`",
        "for the tabs the agent controls.",
        "",
    ].join("\n");
}
async function status(args) {
    const url = flag(args, "--url", process.env.DSH_BROWSER_RELAY_URL ?? "http://127.0.0.1:9224");
    const { probeCdpStatus } = await import("./../browsers/attach.js");
    const version = `${url.replace(/\/+$/, "")}/json/version`;
    const code = await probeCdpStatus(version, { timeoutMs: 2_000 });
    if (code !== null && code >= 200 && code < 300) {
        print(`relay OK (${url})`);
        return;
    }
    if (code === 503) {
        print(`relay reachable at ${url} but extension not connected (HTTP 503)`);
        return;
    }
    print(`relay not reachable at ${url}`);
    process.exitCode = 1;
}
function flag(args, name, fallback) {
    const index = args.indexOf(name);
    if (index >= 0 && index + 1 < args.length)
        return args[index + 1];
    return fallback;
}
function defaultExtensionDir() {
    return path.join(os.homedir(), ".dsh", "browser-relay", "extension");
}
export async function main() {
    const argv = process.argv.slice(2);
    const command = argv[0] ?? "serve";
    const rest = argv.slice(1);
    switch (command) {
        case "serve":
            await serve(rest);
            break;
        case "install":
            await install(rest);
            break;
        case "status":
            await status(rest);
            break;
        default:
            print(`Usage: dsh-browser-relay <serve|install|status> [options]`);
            process.exitCode = 1;
    }
}
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
    void main();
}
