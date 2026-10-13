/**
 * Cross-project resolution for IDEA's mandatory `projectPath` argument.
 *
 * IDEA's MCP server refuses every routed call until it knows which project to
 * act on (it does NOT auto-resolve even with a single project open). The only
 * way to enumerate open projects is the rejection message itself:
 *
 *   Unable to determine the target project for the current MCP tool call.
 *   ... Currently open projects: {"projects":[{"path":"/abs/path"}]}
 *
 * This module parses that message and matches the list against the agent's
 * session cwd, so `.worktrees/xxx` sessions land on the `.worktrees` project
 * without the user hardcoding a path.
 */
import path from "node:path";

/** Marker that precedes the JSON project list in IDEA's rejection message. */
const PROJECTS_MARKER = "Currently open projects:";

/**
 * Extract absolute project paths from an IDEA "unable to determine project" message.
 * @param text - the raw tool result text.
 * @returns open project paths, or an empty array when the message has no list.
 */
export function parseOpenProjects(text: string): string[] {
	const markerAt = text.indexOf(PROJECTS_MARKER);
	if (markerAt < 0) return [];
	const tail = text.slice(markerAt + PROJECTS_MARKER.length);
	const start = tail.indexOf("{");
	const end = tail.lastIndexOf("}");
	if (start < 0 || end <= start) return [];
	let parsed: unknown;
	try {
		parsed = JSON.parse(tail.slice(start, end + 1));
	} catch {
		return [];
	}
	const entries = (parsed as { projects?: unknown }).projects;
	if (!Array.isArray(entries)) return [];
	const out: string[] = [];
	for (const entry of entries) {
		const value = (entry as { path?: unknown } | null)?.path;
		if (typeof value === "string" && value.length > 0) out.push(value);
	}
	return out;
}

/**
 * Choose the open project a session's cwd belongs to.
 *
 * Prefers the deepest project directory containing `cwd` (so nested worktrees
 * win over their parent checkout). Falls back to the only open project when
 * there is exactly one — matching the behaviour users expect from a
 * single-project IDE window.
 * @param cwd - the agent session's working directory.
 * @param projects - open project paths, as reported by IDEA.
 * @returns the path to pass as `projectPath`, or undefined when ambiguous.
 */
export function pickProject(cwd: string, projects: readonly string[]): string | undefined {
	if (projects.length === 0) return undefined;
	const target = path.resolve(cwd);
	let best: { raw: string; abs: string } | undefined;
	for (const raw of projects) {
		const abs = path.resolve(raw);
		if (target !== abs && !target.startsWith(abs + path.sep)) continue;
		if (!best || abs.length > best.abs.length) best = { raw, abs };
	}
	if (best) return best.raw;
	return projects.length === 1 ? projects[0] : undefined;
}

/** Render the open-project list for an error message or a tool result. */
export function formatProjects(projects: readonly string[]): string {
	if (projects.length === 0) return "(IDEA 当前没有打开任何工程)";
	return projects.map((project, index) => `${index + 1}. ${project}`).join("\n");
}
