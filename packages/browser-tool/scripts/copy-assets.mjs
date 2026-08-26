// Copy committed assets (src/assets → lib/assets) after tsc build.
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const src = path.join(root, "src", "assets");
const dest = path.join(root, "lib", "assets");

function copyDir(from, to) {
	fs.mkdirSync(to, { recursive: true });
	for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
		const s = path.join(from, entry.name);
		const d = path.join(to, entry.name);
		if (entry.isDirectory()) copyDir(s, d);
		else fs.copyFileSync(s, d);
	}
}

if (fs.existsSync(src)) {
	copyDir(src, dest);
	console.log(`[copy-assets] ${src} -> ${dest}`);
} else {
	console.error("[copy-assets] src/assets missing");
	process.exitCode = 1;
}