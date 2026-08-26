/**
 * Path/glob/directory resolution plus gitignore-aware file collection.
 *
 * Semantics mirror oh-my-pi's ast_edit native scan:
 * - hidden files are included (except `.git`),
 * - `node_modules` is skipped unless any path/glob text mentions it,
 * - `.gitignore` files are respected (approximation: collected from the
 *   entry directory upward to the working directory),
 * - a hard `maxFiles` cap stops collection once reached.
 */
import { existsSync } from "node:fs";
import { promises as fs } from "node:fs";
import path from "node:path";
import fg from "fast-glob";
import ignore from "ignore";
/** True when a path contains glob magic and must not be treated as a literal file/dir. */
function hasGlobMagic(p) {
    return /[*?[\]{}]/.test(p);
}
/** Build a single gitignore matcher from every `.gitignore` from `from` up to `to`. */
async function buildIgnoreMatcher(from, to) {
    const matcher = ignore();
    let dir = from;
    const seen = new Set();
    while (dir && !seen.has(dir)) {
        seen.add(dir);
        const gi = path.join(dir, ".gitignore");
        if (existsSync(gi)) {
            try {
                matcher.add(await fs.readFile(gi, "utf8"));
            }
            catch {
                // unreadable .gitignore is tolerated
            }
        }
        if (dir === to || dir === path.parse(dir).root)
            break;
        dir = path.dirname(dir);
    }
    return matcher;
}
/** Walk a directory recursively, applying the ignore matcher relative to the cwd. */
async function walkDir(dirAbs, matcher, options, out, state) {
    if (state.limit)
        return;
    let entries;
    try {
        entries = await fs.readdir(dirAbs, { withFileTypes: true });
    }
    catch {
        return; // unreadable directory: skip silently
    }
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const entry of entries) {
        if (state.limit)
            return;
        const name = entry.name;
        if (name === ".git")
            continue;
        if (!options.allowNodeModules && name === "node_modules")
            continue;
        const abs = path.join(dirAbs, name);
        const rel = path.relative(options.cwd, abs).split(path.sep).join("/");
        if (matcher.ignores(rel))
            continue;
        state.count += 1;
        if (entry.isDirectory()) {
            await walkDir(abs, matcher, options, out, state);
        }
        else if (entry.isFile()) {
            if (out.length >= options.maxFiles) {
                state.limit = true;
                return;
            }
            out.push(abs);
        }
    }
}
export async function collectFiles(input, options) {
    const files = new Set();
    let searchedCount = 0;
    let limitReached = false;
    const allowNodeModules = options.allowNodeModules ?? input.some((p) => p.includes("node_modules"));
    const opts = { ...options, allowNodeModules };
    for (const raw of input) {
        const p = raw.trim();
        if (!p)
            continue;
        // Route globs to fast-glob before touching fs.stat: a glob string is not
        // a literal path and stat would fail for non-existent glob roots.
        if (hasGlobMagic(p)) {
            const baseDir = globBase(p, options.cwd);
            const matcher = await buildIgnoreMatcher(baseDir, options.cwd);
            let results;
            try {
                results = await fg(convertGlob(p), {
                    cwd: options.cwd,
                    absolute: true,
                    dot: true,
                    onlyFiles: true,
                    suppressErrors: true,
                    ignore: [...(allowNodeModules ? [] : ["**/node_modules/**"]), "**/.git/**"],
                });
            }
            catch {
                continue;
            }
            results.sort();
            for (const f of results) {
                const rel = path.relative(options.cwd, f).split(path.sep).join("/");
                if (matcher.ignores(rel))
                    continue;
                searchedCount += 1;
                if (files.size < options.maxFiles)
                    files.add(f);
                else
                    limitReached = true;
            }
            continue;
        }
        const abs = path.isAbsolute(p) ? path.normalize(p) : path.resolve(options.cwd, p);
        let stat;
        try {
            stat = await fs.stat(abs);
        }
        catch {
            // missing path: skip (best-effort, matching omp's scan tolerance)
            continue;
        }
        if (stat.isFile()) {
            searchedCount += 1;
            if (files.size < options.maxFiles)
                files.add(abs);
            else
                limitReached = true;
            continue;
        }
        if (stat.isDirectory()) {
            const matcher = await buildIgnoreMatcher(abs, options.cwd);
            const out = [];
            const state = { count: 0, limit: false };
            await walkDir(abs, matcher, opts, out, state);
            searchedCount += state.count;
            limitReached ||= state.limit;
            for (const f of out) {
                if (files.size >= options.maxFiles) {
                    limitReached = true;
                    break;
                }
                files.add(f);
            }
        }
    }
    const sorted = [...files].sort();
    return { files: sorted, searchedCount, limitReached };
}
/** Resolve the innermost real directory honoring a glob's leading segments. */
function globBase(glob, cwd) {
    const segments = glob.split(/[/\\]/);
    const literal = [];
    for (const seg of segments) {
        if (!seg)
            continue;
        if (hasGlobMagic(seg))
            break;
        literal.push(seg);
    }
    const base = path.resolve(cwd, literal.join(path.sep));
    return existsSync(base) ? base : cwd;
}
/** Normalize a glob to posix separators for fast-glob. */
function convertGlob(p) {
    return p.split(path.sep).join("/");
}
