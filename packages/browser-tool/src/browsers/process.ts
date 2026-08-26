/**
 * Process discovery and termination, replacing oh-my-pi's `pi-natives` Rust
 * addon with plain Node.
 *
 * - Linux: scan `/proc/[pid]/exe` + `/proc/[pid]/cmdline` directly.
 * - macOS: `ps -axo pid=,command=` and match the executable path.
 * - Windows: `wmic process where ExecutablePath=...` (best effort).
 *
 * Own spawned children are tracked as process groups (`spawn detached: true`),
 * so teardown can signal the whole tree with a negative pid.
 */
import * as fs from "node:fs";
import { execFileSync, spawn } from "node:child_process";
import { sleep } from "./../util.js";

export interface ProcessInfo {
	pid: number;
	args: string[];
}

function readProcCmdline(pid: number): string[] | null {
	try {
		const raw = fs.readFileSync(`/proc/${pid}/cmdline`, "utf8");
		return raw.split("\0").filter(part => part.length > 0);
	} catch {
		return null;
	}
}

function procExePath(pid: number): string | null {
	try {
		const target = fs.readlinkSync(`/proc/${pid}/exe`);
		return target.length > 0 ? target : null;
	} catch {
		return null;
	}
}

function listLinuxPids(): number[] {
	const out: number[] = [];
	for (const name of fs.readdirSync("/proc")) {
		if (/^\d+$/.test(name)) out.push(Number(name));
	}
	return out;
}

function sameExe(exePath: string, candidate: string | null | undefined): boolean {
	if (!candidate) return false;
	const normalize = (p: string): string => p.toLowerCase();
	const a = normalize(exePath);
	const b = normalize(candidate);
	return a === b || b.endsWith(a) || a.endsWith(b);
}

function execFileSyncCapture(cmd: string, args: string[]): string {
	try {
		return String(execFileSync(cmd, args, { encoding: "utf8", timeout: 10_000 }) ?? "");
	} catch {
		return "";
	}
}

/** List processes whose executable resolves to `exePath` (exact path match). */
export function processesByExecutable(exePath: string): ProcessInfo[] {
	if (process.platform === "linux") {
		const out: ProcessInfo[] = [];
		for (const pid of listLinuxPids()) {
			if (pid === process.pid) continue;
			const exe = procExePath(pid);
			if (!sameExe(exePath, exe)) continue;
			const args = readProcCmdline(pid) ?? [];
			out.push({ pid, args });
		}
		return out;
	}
	if (process.platform === "darwin") {
		// `ps -axo pid=,command=` never truncates the command (unlike comm=).
		const output = execFileSyncCapture("ps", ["-axo", "pid=,command="]);
		const out: ProcessInfo[] = [];
		for (const line of output.split("\n")) {
			const match = /^\s*(\d+)\s+(.*)$/.exec(line);
			if (!match) continue;
			const pid = Number(match[1]);
			if (pid === process.pid) continue;
			const command = match[2] ?? "";
			const firstArg = command.split(" ")[0] ?? "";
			if (sameExe(exePath, firstArg)) out.push({ pid, args: command.split(" ").slice(1) });
		}
		return out;
	}
	// Windows best effort: wmic is deprecated but present on Windows 10/11.
	try {
		const output = execFileSyncCapture("wmic", [
			"process",
			"where",
			`ExecutablePath="${exePath.replaceAll('"', '\\"')}"`,
			"get",
			"ProcessId",
			"/format:csv",
		]);
		const out: ProcessInfo[] = [];
		for (const line of output.split("\n").slice(1)) {
			const pid = Number((line.split(",").pop() ?? "").trim());
			if (Number.isInteger(pid) && pid > 0 && pid !== process.pid) out.push({ pid, args: [] });
		}
		return out;
	} catch {
		return [];
	}
}

function signalProcess(target: number, signal: NodeJS.Signals): boolean {
	try {
		process.kill(target, signal);
		return true;
	} catch {
		return false;
	}
}

function pidAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

/**
 * Gracefully terminate a process group (or single pid when the group is gone),
 * escalating TERM → KILL after `graceMs`. Mirrors pi-natives terminate().
 */
export async function terminateProcessTree(pid: number, graceMs = 2000): Promise<void> {
	const groupPid = -pid;
	const termOk = signalProcess(groupPid, "SIGTERM") || signalProcess(pid, "SIGTERM");
	if (!termOk) return;
	const deadline = Date.now() + graceMs;
	while (Date.now() < deadline) {
		if (!pidAlive(pid)) return;
		await sleep(50);
	}
	signalProcess(groupPid, "SIGKILL");
	signalProcess(pid, "SIGKILL");
}

/** Spawn a detached child process (own process group) for later tree-kill. */
export function spawnDetached(
	command: string,
	args: string[],
	options: { cwd?: string; env?: NodeJS.ProcessEnv; stdio?: "ignore" | "inherit" } = {},
): { pid: number; child: ReturnType<typeof spawn> } {
	const child = spawn(command, args, {
		detached: process.platform !== "win32",
		stdio: options.stdio ?? "ignore",
		cwd: options.cwd,
		env: { ...process.env, ...options.env },
	});
	child.unref();
	return { pid: child.pid ?? -1, child };
}