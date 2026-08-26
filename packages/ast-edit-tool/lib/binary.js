/**
 * Locate the ast-grep binary. Resolution order:
 *  1. `DSH_AST_GREP_BINARY` / configured `binaryPath` (user override).
 *  2. `@ast-grep/cli/ast-grep` — the postinstall copy at the package root.
 *  3. The platform binary package (`@ast-grep/cli-<platform>-<arch>`), which
 *     ships the compiled ELF/PEE directly and therefore works even when pnpm
 *     or npm blocked the cli package's postinstall script.
 */
import { existsSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const PLATFORM_PACKAGES = {
    darwin: ["@ast-grep/cli-darwin-arm64", "@ast-grep/cli-darwin-x64"],
    linux: ["@ast-grep/cli-linux-arm64-gnu", "@ast-grep/cli-linux-x64-gnu"],
    win32: ["@ast-grep/cli-win32-arm64-msvc", "@ast-grep/cli-win32-x64-msvc"],
};
function resolveInPackage(pkg, file) {
    try {
        const dir = path.dirname(require.resolve(`${pkg}/package.json`));
        const candidate = path.join(dir, file);
        return existsSync(candidate) ? candidate : null;
    }
    catch {
        return null;
    }
}
export function resolveAstGrepBinary(configured) {
    const explicit = configured?.trim();
    if (explicit)
        return explicit;
    const extension = process.platform === "win32" ? ".exe" : "";
    const names = [`ast-grep${extension}`, `sg${extension}`];
    const candidates = [];
    for (const name of names) {
        const viaCli = resolveInPackage("@ast-grep/cli", name);
        if (viaCli)
            candidates.push(viaCli);
    }
    for (const pkg of PLATFORM_PACKAGES[process.platform] ?? []) {
        for (const name of names) {
            const viaPlatform = resolveInPackage(pkg, name);
            if (viaPlatform)
                candidates.push(viaPlatform);
        }
    }
    for (const candidate of candidates) {
        if (existsSync(candidate))
            return candidate;
    }
    return null;
}
