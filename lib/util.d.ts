export interface ExecOption {
    cwd?: string;
    timeoutMs?: number;
    env?: Record<string, string>;
}
export interface ExecResult {
    code: number;
    stdout: string;
    stderr: string;
    timedOut: boolean;
}
export declare function exec(bin: string, args: string[], opts?: ExecOption): Promise<ExecResult>;
/** Best-effort detection of a running dsh process (Linux/macOS). */
export declare function isDshRunning(): Promise<boolean>;
/** `git ls-remote --tags` line: `<sha>\trefs/tags/<name>` */
export declare function parseTagLine(line: string): {
    sha: string;
    tag: string;
} | null;
