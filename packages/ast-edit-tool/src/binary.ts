/**
 * Locate the ast-grep binary. Resolution order:
 *  1. `DSH_AST_GREP_BINARY` / configured `binaryPath` (user override).
 *  2. A native executable, preferred over any candidate: when a package
 *     manager blocks `@ast-grep/cli`'s postinstall, `@ast-grep/cli/ast-grep`
 *     stays a JS shim that re-resolves the real binary on every call and
 * prints a warning to stderr — which the engine would surface as a
 *     per-pattern warning. The platform package
 *     (`@ast-grep/cli-<platform>-<arch>`) ships the compiled ELF/PE/Mach-O
 *     directly, so we sniff each candidate's magic bytes and take a native
 *     one first.
 *  3. Otherwise the first existing candidate (the shim still works).
 */
import { closeSync, existsSync, openSync, readSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const PLATFORM_PACKAGES: Record<string, string[]> = {
	darwin: ["@ast-grep/cli-darwin-arm64", "@ast-grep/cli-darwin-x64"],
	linux: ["@ast-grep/cli-linux-arm64-gnu", "@ast-grep/cli-linux-x64-gnu"],
	win32: ["@ast-grep/cli-win32-arm64-msvc", "@ast-grep/cli-win32-x64-msvc"],
};

function resolveInPackage(pkg: string, file: string): string | null {
	try {
		const dir = path.dirname(require.resolve(`${pkg}/package.json`));
		const candidate = path.join(dir, file);
		return existsSync(candidate) ? candidate : null;
	} catch {
		return null;
	}
}

export function resolveAstGrepBinary(configured?: string): string | null {
	const explicit = configured?.trim();
	if (explicit) return explicit;

	const extension = process.platform === "win32" ? ".exe" : "";
	const names = [`ast-grep${extension}`, `sg${extension}`];
	const candidates: string[] = [];

	for (const name of names) {
		const viaCli = resolveInPackage("@ast-grep/cli", name);
		if (viaCli) candidates.push(viaCli);
	}
	for (const pkg of PLATFORM_PACKAGES[process.platform] ?? []) {
		for (const name of names) {
			const viaPlatform = resolveInPackage(pkg, name);
			if (viaPlatform) candidates.push(viaPlatform);
		}
	}
	return candidates.find(isNativeExecutable) ?? candidates[0] ?? null;
}

/**
 * True when the file starts with a native executable magic number:
 * ELF (Linux), MZ (Windows PE), or Mach-O (macOS, incl. universal binaries).
 * A JS shim starts with `#!` or source text and fails every check.
 */
function isNativeExecutable(file: string): boolean {
	let fd: number | undefined;
	try {
		fd = openSync(file, "r");
		const head = Buffer.alloc(4);
		if (readSync(fd, head, 0, 4, 0) < 4) return false;
		if (head[0] === 0x7f && head[1] === 0x45 && head[2] === 0x4c && head[3] === 0x46) return true; // ELF
		if (head[0] === 0x4d && head[1] === 0x5a) return true; // MZ (PE)
		const magic = head.readUInt32BE(0);
		return magic === 0xfeedface || magic === 0xfeedfacf || magic === 0xcefaedfe || magic === 0xcffaedfe || magic === 0xcafebabe;
	} catch {
		return false;
	} finally {
		if (fd !== undefined) closeSync(fd);
	}
}