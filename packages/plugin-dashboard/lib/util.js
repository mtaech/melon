/** Subprocess helper with timeout and bounded output capture. */
import { spawn } from "node:child_process";
const MAX_OUTPUT = 2 * 1024 * 1024; // 2 MiB cap per stream
function killTree(child) {
    // kill the whole process group: git spawns git-remote-https helpers that
    // keep the pipe open unless the group is reaped
    const pid = child.pid;
    if (!pid)
        return;
    if (process.platform === "win32") {
        child.kill("SIGKILL");
    }
    else {
        try {
            process.kill(-pid, "SIGKILL");
        }
        catch {
            child.kill("SIGKILL");
        }
    }
}
export function exec(bin, args, opts = {}) {
    const { cwd, env, timeoutMs = 15_000 } = opts;
    return new Promise((resolve) => {
        let settled = false;
        const child = spawn(bin, args, { cwd, env, stdio: ["ignore", "pipe", "pipe"], detached: process.platform !== "win32" });
        let stdout = "";
        let stderr = "";
        let timedOut = false;
        const timer = setTimeout(() => {
            timedOut = true;
            killTree(child);
        }, timeoutMs);
        child.stdout.on("data", (d) => {
            if (stdout.length < MAX_OUTPUT)
                stdout += d.toString("utf8");
        });
        child.stderr.on("data", (d) => {
            if (stderr.length < MAX_OUTPUT)
                stderr += d.toString("utf8");
        });
        child.on("error", (err) => {
            if (settled)
                return;
            settled = true;
            clearTimeout(timer);
            resolve({ code: -1, stdout, stderr: `${err.message}\n${stderr}`, timedOut });
        });
        child.on("close", (code) => {
            if (settled)
                return;
            settled = true;
            clearTimeout(timer);
            resolve({ code: code ?? -1, stdout, stderr, timedOut });
        });
    });
}
/** Best-effort detection of a running dsh process (Linux/macOS). */
export async function isDshRunning() {
    try {
        const res = await exec("pgrep", ["-f", "dsh (web|tui|headless|serve)"], { timeoutMs: 3000 });
        return res.code === 0 && res.stdout.trim().length > 0;
    }
    catch {
        return false;
    }
}
/** `git ls-remote --tags` line: `<sha>\trefs/tags/<name>` */
export function parseTagLine(line) {
    const m = /^([0-9a-f]{40})\s+refs\/tags\/(.+)$/.exec(line);
    if (!m)
        return null;
    return { sha: m[1], tag: m[2] };
}
