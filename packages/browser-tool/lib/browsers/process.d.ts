import { spawn } from "node:child_process";
export interface ProcessInfo {
    pid: number;
    args: string[];
}
/** List processes whose executable resolves to `exePath` (exact path match). */
export declare function processesByExecutable(exePath: string): ProcessInfo[];
/**
 * Gracefully terminate a process group (or single pid when the group is gone),
 * escalating TERM → KILL after `graceMs`. Mirrors pi-natives terminate().
 */
export declare function terminateProcessTree(pid: number, graceMs?: number): Promise<void>;
/** Spawn a detached child process (own process group) for later tree-kill. */
export declare function spawnDetached(command: string, args: string[], options?: {
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    stdio?: "ignore" | "inherit";
}): {
    pid: number;
    child: ReturnType<typeof spawn>;
};
