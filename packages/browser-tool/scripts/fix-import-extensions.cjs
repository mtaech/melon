// One-shot: add .js extensions to relative imports in src/**/*.ts (NodeNext ESM).
const fs = require("fs");
const path = require("path");

function walk(dir, out = []) {
	for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
		const p = path.join(dir, e.name);
		if (e.isDirectory()) walk(p, out);
		else if (p.endsWith(".ts")) out.push(p);
	}
	return out;
}

const files = walk("src");
let changed = 0;
for (const f of files) {
	let s = fs.readFileSync(f, "utf8");
	const orig = s;
	s = s.replace(/(from\s+["'`])(\.\.?\/[^"'`]+?)(["'`])/g, (m, a, p, c) => {
		if (/\.(js|ts|json|node)$/.test(p) || p.endsWith("/")) return m;
		return a + p + ".js" + c;
	});
	s = s.replace(/(import\(\s*["'`])(\.\.?\/[^"'`]+?)(["'`])/g, (m, a, p, c) => {
		if (/\.(js|ts|json|node)$/.test(p)) return m;
		return a + p + ".js" + c;
	});
	if (s !== orig) {
		fs.writeFileSync(f, s);
		changed++;
		console.log("  patched", f);
	}
}
console.log("patched", changed, "files");