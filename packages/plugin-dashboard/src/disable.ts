/**
 * Plugin disable/enable planning and application.
 *
 * "Disable" means the loader-level `disabled: true` override for every row a
 * plugin contributes: the profile's own patch layer (`cordis.patch.yml`) is
 * id-targeted by the patch engine (`applyEntryPatches`), so appended entries
 * like
 *
 *     - id: plugin-dashboard
 *       name: dsh-plugin-dashboard
 *       disabled: true
 *
 * stop the row from mounting without touching `dsh.profile.bundles` or
 * `dependencies` — the package stays installed and the bundle list intact, so
 * `dsh plugin` reconcile can never silently re-enable it. On profiles with
 * `patchReload: "live"` the user patch layer hot-reloads, so a disable takes
 * effect immediately; `startup` profiles apply it at the next boot.
 *
 * Row attribution uses the live loader tree (`ctx.loader.entries()`, rows whose
 * `options.name` equals the package name) rather than re-parsing bundle patch
 * files: the tree is exactly what boots, so grouped, `!!js`-carrying, or nested
 * patch shapes are all handled by the loader itself. The loader service is kept
 * structural (`LoaderLike`) to avoid a dependency on the loader package.
 */
import { promises as fs } from "node:fs";
import path from "node:path";

/** The profile's own patch layer, which the launcher hot-reloads on live profiles. */
export const PATCH_FILENAME = "cordis.patch.yml";

/** One loader row attributable to a plugin (name match, with a file id). */
export interface PluginRow {
	id: string;
	/** The row's `name` from loader options; used for the patch engine's name-mismatch check. */
	name: string | null;
	/** Evaluated disabled state (expression rows resolved by the loader). */
	disabled: boolean;
}

export interface LoaderEntryLike {
	options: { id?: unknown; name?: unknown; disabled?: unknown };
	/** Evaluated `disabled` (distinct from a `!!js` expression in `options`). */
	disabled?: boolean;
}

/** Structural subset of the cordis Loader service. */
export interface LoaderLike {
	entries(): Iterable<LoaderEntryLike>;
}

/**
 * Collect the loader rows a plugin contributes: entries whose `options.name`
 * equals the package name and that carry a file id (id-less rows cannot be
 * targeted by a patch). Returns [] when the loader is unavailable.
 */
export function pluginRows(loader: LoaderLike | undefined, name: string): PluginRow[] {
	if (!loader) return [];
	const rows: PluginRow[] = [];
	for (const entry of loader.entries()) {
		const options = entry.options as LoaderEntryLike["options"] | undefined;
		if (!options || options.name !== name) continue;
		if (typeof options.id !== "string" || options.id.length === 0) continue;
		rows.push({
			id: options.id,
			name: typeof options.name === "string" ? options.name : null,
			disabled: entry.disabled === true || options.disabled === true,
		});
	}
	return rows;
}

/** Whether a disable/enable takes effect on the live profile or at the next boot. */
export type PatchEffect = "live" | "restart";

export interface DisablePlan {
	name: string;
	rows: Array<{ id: string; name: string | null; disabled: boolean; wouldDisable: boolean }>;
	wouldChange: boolean;
	effect: PatchEffect;
	error?: string;
}

/** Plan disabling a plugin: the rows found, and which ones actually need writing. */
export function planDisable(name: string, rows: PluginRow[], patchReload: "live" | "startup" | null): DisablePlan {
	const effect: PatchEffect = patchReload === "live" ? "live" : "restart";
	const described = rows.map((row) => ({ ...row, wouldDisable: !row.disabled }));
	if (rows.length === 0) {
		return {
			name,
			rows: [],
			wouldChange: false,
			effect,
			error: "在加载树中未找到该插件的行（未挂载或行未声明 id），无法禁用",
		};
	}
	const pending = described.filter((row) => row.wouldDisable);
	if (pending.length === 0) {
		return {
			name,
			rows: described,
			wouldChange: false,
			effect,
			error: "该插件当前已全部禁用",
		};
	}
	return { name, rows: described, wouldChange: true, effect };
}

export interface EnablePlan {
	name: string;
	/** Rows currently disabled in the tree — what re-enabling restores. */
	rows: Array<{ id: string; name: string | null }>;
	found: boolean;
	wouldChange: boolean;
	effect: PatchEffect;
	error?: string;
}

/** Plan enabling a plugin: whether the dashboard ever wrote a disable block for it. */
export async function planEnable(profileDir: string, name: string, rows: PluginRow[], patchReload: "live" | "startup" | null): Promise<EnablePlan> {
	let content = "";
	try {
		content = await fs.readFile(path.join(profileDir, PATCH_FILENAME), "utf8");
	} catch {
		// no patch file — nothing the dashboard disabled
	}
	const effect: PatchEffect = patchReload === "live" ? "live" : "restart";
	const disabledRows = rows.filter((row) => row.disabled).map(({ id, name }) => ({ id, name }));
	if (!hasDisableBlock(content, name)) {
		return {
			name,
			rows: disabledRows,
			found: false,
			wouldChange: false,
			effect,
			error: "未找到本面板为该插件写入的禁用记录",
		};
	}
	return { name, rows: disabledRows, found: true, wouldChange: true, effect };
}

const BLOCK_START = (pkg: string): string => `# >>> dsh-plugin-dashboard managed: disabled plugin ${pkg}`;
const BLOCK_END = "# <<< dsh-plugin-dashboard managed";

/** YAML scalar rendering: plain when safe, JSON double-quoted otherwise (`@`:`, spaces…`). */
function yamlScalar(value: string): string {
	return /^[A-Za-z0-9_.-]+$/.test(value) ? value : JSON.stringify(value);
}

/**
 * Append a managed disable block for `pkg` targeting `rows` ({id, name}) to the
 * given patch-file content. Never re-serializes the rest of the file — the
 * block is delimited by marker comments and removed wholesale on enable, so
 * user content (including `!!js` expressions) is preserved verbatim.
 */
export function appendDisableBlock(content: string, pkg: string, rows: Array<{ id: string; name: string | null }>): string {
	if (rows.length === 0) throw new Error("no rows to disable");
	const lines: string[] = [BLOCK_START(pkg)];
	for (const row of rows) {
		lines.push(`- id: ${yamlScalar(row.id)}`);
		if (row.name) lines.push(`  name: ${yamlScalar(row.name)}`);
		lines.push("  disabled: true");
	}
	lines.push(BLOCK_END);
	const block = lines.join("\n");
	const base = content.length === 0 || content.endsWith("\n") ? content : `${content}\n`;
	return `${base}${block}\n`;
}

/** Exact-line match: a block header for `pkg` (prefix packages like a vs aX must not collide). */
function isBlockStart(line: string, pkg: string): boolean {
	return line.trimEnd() === BLOCK_START(pkg);
}

/** Whether the patch-file content holds a dashboard-managed disable block for `pkg`. */
export function hasDisableBlock(content: string, pkg: string): boolean {
	return content.split("\n").some((line) => isBlockStart(line, pkg));
}

/**
 * Remove the dashboard-managed disable block for `pkg`. Throws when no such
 * block exists; other content (and other plugins' blocks) is untouched.
 */
export function removeDisableBlock(content: string, pkg: string): string {
	const lines = content.split("\n");
	const start = lines.findIndex((line) => isBlockStart(line, pkg));
	if (start < 0) throw new Error(`${pkg}: 未找到本面板写入的禁用记录`);
	let end = lines.findIndex((line, index) => index > start && line.includes(BLOCK_END));
	if (end < 0) throw new Error(`${pkg}: 禁用块缺少结束标记，请手工检查 ${PATCH_FILENAME}`);
	end += 1; // inclusive
	const next = [...lines.slice(0, start), ...lines.slice(end)].join("\n");
	// Collapse blank lines the removed block left behind (it was appended at EOF).
	return next.replace(/\n{3,}/g, "\n\n");
}

async function readPatchFile(profileDir: string): Promise<string> {
	try {
		return await fs.readFile(path.join(profileDir, PATCH_FILENAME), "utf8");
	} catch (error) {
		throw new Error(`cannot read ${path.join(profileDir, PATCH_FILENAME)}: ${error instanceof Error ? error.message : String(error)}`);
	}
}

/** Apply the disable to disk: backup the patch file, append the managed block. */
export async function applyDisable(profileDir: string, plan: DisablePlan): Promise<{ backupPath: string; log: string[] }> {
	if (plan.error || !plan.wouldChange) throw new Error(plan.error ?? `${plan.name}: nothing to disable`);
	const patchPath = path.join(profileDir, PATCH_FILENAME);
	const original = await readPatchFile(profileDir);
	const pending = plan.rows.filter((row) => row.wouldDisable).map(({ id, name }) => ({ id, name }));
	const next = appendDisableBlock(original, plan.name, pending);
	const backupPath = `${patchPath}.dshbak-${Date.now()}`;
	await fs.writeFile(backupPath, original);
	await fs.writeFile(patchPath, next);
	return {
		backupPath,
		log: [
			`禁用 ${plan.name}：${pending.map((row) => row.id).join(", ")}`,
			`写入 ${PATCH_FILENAME}（备份 ${path.basename(backupPath)}）`,
		],
	};
}

/** Apply the enable to disk: backup the patch file, remove the managed block. */
export async function applyEnable(profileDir: string, plan: EnablePlan): Promise<{ backupPath: string; log: string[] }> {
	if (plan.error || !plan.wouldChange) throw new Error(plan.error ?? `${plan.name}: nothing to enable`);
	const patchPath = path.join(profileDir, PATCH_FILENAME);
	const original = await readPatchFile(profileDir);
	const next = removeDisableBlock(original, plan.name);
	const backupPath = `${patchPath}.dshbak-${Date.now()}`;
	await fs.writeFile(backupPath, original);
	await fs.writeFile(patchPath, next);
	return { backupPath, log: [`启用 ${plan.name}：移除 ${PATCH_FILENAME} 中的禁用块（备份 ${path.basename(backupPath)}）`] };
}