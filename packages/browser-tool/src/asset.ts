/**
 * Runtime asset resolution. The package ships committed non-JS assets (stealth
 * scripts, the ARIA snapshot bundle, relay extension files) under `src/assets`
 * which the build copies to `lib/assets`. Resolve them relative to this module
 * so both `src/` (dev) and `lib/` (compiled) layouts work.
 */
import * as fs from "node:fs";
import { fileURLToPath } from "node:url";
import * as path from "node:path";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));

/** Absolute path to an asset under the package `assets` dir. */
export function assetPath(...segments: string[]): string {
	// asset.ts sits beside `assets/` in both layouts (src/assets, lib/assets);
	// keep the legacy two-level fallbacks for deeper callers.
	const candidates = [
		path.join(moduleDir, "assets", ...segments),
		path.join(moduleDir, "..", "assets", ...segments),
		path.join(moduleDir, "..", "..", "assets", ...segments),
	];
	for (const candidate of candidates) {
		if (fs.existsSync(candidate)) return candidate;
	}
	throw new Error(`asset not found: ${segments.join("/")}`);
}

/** Read an asset as UTF-8 text. */
export function readAssetText(...segments: string[]): string {
	return fs.readFileSync(assetPath(...segments), "utf8");
}