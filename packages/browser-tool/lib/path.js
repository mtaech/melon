/**
 * Path helpers ported from oh-my-pi `path-utils.ts`.
 */
import * as os from "node:os";
import * as path from "node:path";
/** Expand a leading `~` and `${VAR}` / `$VAR` environment references. */
export function expandPath(p) {
    let result = p;
    if (result === "~")
        return os.homedir();
    if (result.startsWith("~/") || result.startsWith("~\\")) {
        result = path.join(os.homedir(), result.slice(2));
    }
    result = result.replace(/\$\{([^}]+)\}/g, (_m, name) => process.env[name] ?? "");
    result = result.replace(/\$([A-Za-z_][A-Za-z0-9_]*)/g, (_m, name) => process.env[name] ?? "");
    return result;
}
/** Resolve a possibly-relative path against a base cwd (falling back to the process cwd). */
export function resolveToCwd(p, cwd) {
    if (path.isAbsolute(p))
        return p;
    return path.resolve(cwd ?? process.cwd(), p);
}
