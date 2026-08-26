/** Expand a leading `~` and `${VAR}` / `$VAR` environment references. */
export declare function expandPath(p: string): string;
/** Resolve a possibly-relative path against a base cwd (falling back to the process cwd). */
export declare function resolveToCwd(p: string, cwd: string | undefined): string;
