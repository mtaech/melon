/**
 * Serialization of IntelliJ IDEA `execute_tool` command strings.
 *
 * IDEA's MCP server exposes a single router tool whose only argument is a
 * shell-ish command line: `search_symbol --q MainController`. Each typed
 * `idea_*` tool in this package owns exactly one such command, so the model
 * never has to remember flag names or quoting.
 *
 * Value encoding rules, verified against a live IDEA 2026.3 MCP server:
 * - `undefined` / `null` / `false` -> the flag is omitted entirely
 * - `true`                          -> `--flag true` (IDEA's parser rejects a bare
 *                                      `--flag`: "Parameter 'flag' requires a value")
 * - number                          -> decimal literal
 * - array / object                  -> bare JSON (`--files ["a.java","b.java"]`)
 * - bare-safe string                -> passed as-is
 * - anything else                   -> double-quoted with `\` and `"` escaped
 */

/** One flag/value pair for {@link buildCommand}. */
export type CommandFlag = readonly [name: string, value: CommandValue];

/** A value a typed tool may serialize into an IDEA command line. */
export type CommandValue =
	| string
	| number
	| boolean
	| readonly unknown[]
	| Readonly<Record<string, unknown>>
	| undefined
	| null;

/** Strings that never need quoting on the IDEA command line. */
const BARE_SAFE = /^[A-Za-z0-9_@./:=+,-]+$/;

/** Encode one scalar/JSON value for the command line. */
export function quoteCommandValue(value: string | number): string {
	if (typeof value === "number") return String(value);
	if (value === "") return '""';
	if (BARE_SAFE.test(value)) return value;
	return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/** Encode any {@link CommandValue}; returns `undefined` when the flag is omitted. */
export function formatCommandValue(value: CommandValue): string | undefined {
	if (value === undefined || value === null) return undefined;
	// IDEA's command parser requires a value for every parameter — a bare
	// `--errorsOnly` is rejected with "Parameter 'errorsOnly' requires a value".
	if (typeof value === "boolean") return value ? "true" : undefined;
	if (typeof value === "number") return quoteCommandValue(value);
	if (typeof value === "string") return quoteCommandValue(value);
	const json = JSON.stringify(value);
	return json === undefined ? undefined : json;
}

/**
 * Build the `execute_tool` command line: tool name followed by the flags whose
 * values are present. `true` becomes `--flag true`, `false` is omitted.
 * @param tool - the IDEA tool name, e.g. `search_symbol`.
 * @param flags - ordered flag/value pairs; omitted values are skipped.
 * @returns the command string passed to IDEA's `execute_tool`.
 */
export function buildCommand(tool: string, flags: readonly CommandFlag[] = []): string {
	const parts: string[] = [tool];
	for (const [name, value] of flags) {
		const encoded = formatCommandValue(value);
		if (encoded === undefined) continue;
		parts.push(`--${name} ${encoded}`);
	}
	return parts.join(" ");
}
