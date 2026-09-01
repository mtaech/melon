/**
 * dsh-browser-tool: DSH plugin surface. Registers one `browser` tool that
 * opens/attaches a Chromium, manages named tabs, and runs code against a tab
 * with the full omp `tab` helper API (observe / ariaSnapshot / screenshot /
 * clicks / waits / evaluate …). Ported from oh-my-pi's coding-agent browser
 * tool plus browser-relay.
 *
 * Wire this package into a DSH profile by adding its built bundle to the
 * profile's `package.json > dsh.profile.bundles` list.
 */
import z from "@deepseek-ai/schemastery";
import { ToolError } from "./errors.js";
import { resolveConfig, type BrowserToolConfig, type BrowserToolConfigInput } from "./config.js";
import { defineTool, type Context, type ContentBlock, type ImageAttachmentRef, type ToolRunContext } from "./deps.js";
import { acquireBrowser, releaseBrowser, type ResolvedBrowserConfig } from "./browsers/registry.js";
import { acquireTab, getTab, releaseTab, runInTab, expandBrowserScreenshotDir } from "./browsers/tab-supervisor.js";
import { resolveRelayKind } from "./relay/kind.js";
import type { ImageContent, RunResultOk, TextContent } from "./browsers/types.js";
import type { JsonValue } from "@deepseek-ai/dsh-util-values";

export interface BrowserToolOptions {
	/** Allow spawning/attaching a browser. False disables the tool. */
	enabled?: boolean;
	config?: Partial<BrowserToolConfigInput>;
}

export const name = "dsh-browser-tool";
export const inject = ["tools", "attachments"];

export const Config = z.object({
	enabled: z.boolean().default(true),
	headless: z.boolean().default(true),
	relay: z.boolean().default(false),
	relayUrl: z.string().default("http://127.0.0.1:9224"),
	cdpUrl: z.string().default("http://127.0.0.1:9222"),
	screenshotDir: z.string().default(""),
	noWebP: z.boolean().default(false),
	installChrome: z.boolean().default(true),
});

/** Author-facing parameter schema (dsh-tools ValueSchemaSpec DSL). */
const parameters = {
	action: { type: "string" as const, enum: ["open" as const, "run" as const, "close" as const], required: true as const, description: "open: create/reuse a tab; run: execute code in a tab; close: close a tab." },
	name: { type: "string" as const, required: true as const, description: "Tab name; unique per session." },
	url: { type: "string" as const, description: "Initial URL for open." },
	waitUntil: { type: "string" as const, enum: ["load" as const, "domcontentloaded" as const, "networkidle0" as const, "networkidle2" as const], description: "Navigation lifecycle event to wait for on open." },
	headless: { type: "boolean" as const, description: "Override headless launch for this open." },
	timeout: { type: "integer" as const, description: "Per-call budget in ms (open/run); default 120000." },
	target: { type: "string" as const, description: "Attach target hint (URL fragment) when attaching to a running browser." },
	viewport: {
		type: "object" as const,
		additionalProperties: false as const,
		properties: {
			width: { type: "integer" as const },
			height: { type: "integer" as const },
			deviceScaleFactor: { type: "number" as const },
		},
	},
	dialogs: { type: "string" as const, enum: ["accept" as const, "dismiss" as const], description: "Auto-handle JS dialogs for this tab." },
	code: { type: "string" as const, description: "JavaScript body for run. Scope: page, browser, tab, assert, wait, sleep, display, print, console." },
	kill: { type: "boolean" as const, description: "Close + kill the owned browser process." },
};

/** Exported so the contract test can validate real result objects against the declared schema. */
export const outputSchema = {
	type: "object" as const,
	additionalProperties: false as const,
	properties: {
		ok: { type: "boolean" as const, required: true as const },
		name: { type: "string" as const, required: true as const },
		created: { type: "boolean" as const },
		url: { type: "string" as const },
		message: { type: "string" as const },
		output: {
			type: "array" as const,
			items: {
				type: "object" as const,
				additionalProperties: false as const,
				properties: {
					kind: { type: "string" as const, enum: ["text" as const, "image" as const], required: true as const },
					text: { type: "string" as const },
					dest: { type: "string" as const },
					image: {
						type: "object" as const,
						additionalProperties: false as const,
						properties: {
							attachmentId: { type: "string" as const, required: true as const },
							mediaType: { type: "string" as const, required: true as const },
							bytes: { type: "integer" as const, required: true as const },
							width: { type: "integer" as const, required: true as const },
							height: { type: "integer" as const, required: true as const },
							name: { type: "string" as const },
						},
					},
				},
			},
		},
		returnValue: { type: "json" as const },
	},
};

/** Runtime argument shape (validated by the schema above). */
export interface BrowserToolArgs {
	action: "open" | "run" | "close";
	name: string;
	url?: string;
	waitUntil?: "load" | "domcontentloaded" | "networkidle0" | "networkidle2";
	headless?: boolean;
	timeout?: number;
	target?: string;
	viewport?: { width?: number; height?: number; deviceScaleFactor?: number };
	dialogs?: "accept" | "dismiss";
	code?: string;
	kill?: boolean;
}

export interface BrowserToolOutputEntry {
	kind: "text" | "image";
	text?: string;
	dest?: string;
	image?: ImageAttachmentRef;
}

export interface BrowserToolValue {
	ok: boolean;
	name: string;
	created?: boolean;
	url?: string;
	message?: string;
	output?: BrowserToolOutputEntry[];
	returnValue?: JsonValue;
}

const DEFAULT_OPEN_TIMEOUT_MS = 120_000;
const DEFAULT_RUN_TIMEOUT_MS = 120_000;

interface ToolServices {
	attachments: {
		saveImages(inputs: readonly { data: Uint8Array; mediaType: "image/png" | "image/jpeg" | "image/webp" | "image/gif"; name?: string }[]): Promise<ImageAttachmentRef[]>;
	};
}

export function apply(ctx: Context, options: BrowserToolOptions = {}): void {
	if (options.enabled === false) return;
	const settings = resolveConfig(options.config ?? {});
	if (!settings.enabled) return;
	const tools = ctx.get("tools");
	const attachments = ctx.get("attachments") as ToolServices["attachments"] | undefined;
	if (!tools || !attachments) return;

	const browserSettings: ResolvedBrowserConfig = {
		headless: settings.headless,
		relayEnabled: settings.relay,
		relayUrl: settings.relayUrl,
		cdpUrl: settings.cdpUrl,
		screenshotDir: settings.screenshotDir || undefined,
		excludeWebP: settings.noWebP,
		installChrome: settings.installChrome,
	};

	tools.register(
		defineTool({
			name: "browser",
			description: [
				"Drive a Chromium browser: open/manage named tabs, run JavaScript against a page, and read back",
				"accessible snapshots, screenshots, and extracted readable text. Actions:",
				"- open: create (or reuse) a tab; connects headless Chromium, the user's Chrome via the browser relay, or a CDP endpoint.",
				"- run: execute JavaScript in the tab. The cell receives page, browser, tab (TabApi with the same semantics as the",
				"  omp browser tool), assert/wait/sleep/display/print/console. tab.observe() returns interactive elements with ids for",
				"  click/type/fill, tab.ariaSnapshot() returns an aria snapshot with refs (ref(e1) etc.), tab.screenshot() saves and",
				"  returns a path, tab.extract() returns readable markdown. Local network and file access follow the hosting environment.",
				"  A run cell reports returnValue only when its last top-level statement is an expression or an explicit `return <expr>`;",
				"  a cell ending in any other statement omits returnValue entirely, which is normal and not an error. Values that are",
				"  not JSON (functions, class instances, cycles) are coerced to a string or dropped, so return plain JSON and use",
				"  display()/print() for anything you want to read regardless.",
				"- close: close a tab (optionally kill the owned browser).",
			].join(" "),
			parameters,
			timeoutMs: 300_000,
			output: {
				schema: outputSchema,
				render(renderedArgs: unknown, rawValue: unknown): ContentBlock[] {
					const value = rawValue as BrowserToolValue;
					const blocks: ContentBlock[] = [];
					if (value.ok && value.output) {
						for (const entry of value.output) {
							if (entry.kind === "image" && entry.image) {
								blocks.push({ type: "image", attachment: entry.image });
							} else if (entry.kind === "text" && entry.text) {
								blocks.push({ type: "text", text: entry.text });
							}
						}
						if (value.message) blocks.push({ type: "text", text: value.message });
					} else if (value.message) {
						blocks.push({ type: "text", text: value.message });
					}
					void renderedArgs;
					return blocks;
				},
				presentationMeta(renderedArgs: unknown, rawValue: unknown) {
					const value = rawValue as BrowserToolValue;
					const args = renderedArgs as BrowserToolArgs;
					return { name: value.name, action: args.action, ok: value.ok };
				},
			},
			async execute(rawArgs: unknown, exec: ToolRunContext): Promise<BrowserToolValue> {
				const args = rawArgs as BrowserToolArgs;
				if (exec.signal.aborted) throw new ToolError(`Browser tool aborted: ${String(exec.signal.reason)}`);
				const cwd = (exec.agent?.session?.header as { cwd?: string } | undefined)?.cwd ?? process.cwd();
				switch (args.action) {
					case "open":
						return await actionOpen(args, exec, cwd, browserSettings, settings);
					case "run":
						return await actionRun(args, exec, cwd, browserSettings, settings, attachments);
					case "close":
						return await actionClose(args, exec, browserSettings);
				}
			},
		}),
	);
}

async function actionOpen(
	args: BrowserToolArgs,
	exec: ToolRunContext,
	cwd: string,
	browserSettings: ResolvedBrowserConfig,
	settings: BrowserToolConfig,
): Promise<BrowserToolValue> {
	const timeoutMs = args.timeout ?? DEFAULT_OPEN_TIMEOUT_MS;
	const relay = resolveRelayKind({ settingEnabled: settings.relay, url: settings.relayUrl });
	const kind = relay
		? { kind: "relay" as const, cdpUrl: relay.cdpUrl }
		: (args.headless ?? settings.headless)
			? { kind: "headless" as const, headless: true }
			: { kind: "connected" as const, cdpUrl: settings.cdpUrl };
	const viewport = normalizeViewport(args.viewport);

	const browser = await acquireBrowser(kind, {
		cwd,
		viewport: viewport ?? undefined,
		config: browserSettings,
		signal: exec.signal,
	});
	const ownerSessionId = exec.agent?.session?.id as string | undefined;
	try {
		const { tab, created } = await acquireTab(args.name, browser, {
			url: args.url,
			waitUntil: args.waitUntil,
			viewport: viewport ?? undefined,
			target: args.target,
			dialogs: args.dialogs,
			timeoutMs,
			signal: exec.signal,
			ownerSessionId,
		});
		const url = tab.info?.url ?? args.url;
		return {
			ok: true,
			name: args.name,
			created,
			...(url === undefined ? {} : { url }),
			message: created
				? `Opened tab ${JSON.stringify(args.name)} (${tab.info?.url ?? "about:blank"})`
				: `Reused tab ${JSON.stringify(args.name)}`,
		};
	} catch (error) {
		await releaseBrowser(browser, { kill: false }).catch(() => undefined);
		throw error;
	}
}

async function actionRun(
	args: BrowserToolArgs,
	exec: ToolRunContext,
	cwd: string,
	browserSettings: ResolvedBrowserConfig,
	settings: BrowserToolConfig,
	attachments: ToolServices["attachments"],
): Promise<BrowserToolValue> {
	const timeoutMs = args.timeout ?? DEFAULT_RUN_TIMEOUT_MS;
	if (!getTab(args.name)) {
		throw new ToolError(`Tab ${JSON.stringify(args.name)} is not open. Open it first with action:"open".`);
	}
	const result: RunResultOk = await runInTab(args.name, {
		code: args.code ?? "",
		timeoutMs,
		signal: exec.signal,
		cwd,
		screenshotDir: expandScreenshotDir(settings),
		excludeWebP: settings.noWebP,
	});
	const output: BrowserToolOutputEntry[] = [];
	for (const entry of result.displays) {
		if ((entry as TextContent).type === "text") {
			output.push({ kind: "text", text: (entry as TextContent).text });
		} else {
			const image = entry as ImageContent;
			const ref = await saveImage(attachments, image);
			output.push({ kind: "image", image: ref, ...(image.dest === undefined ? {} : { dest: image.dest }) });
		}
	}
	if (result.screenshots?.length) {
		output.push({
			kind: "text",
			text: `Screenshots: ${result.screenshots.map(s => `${s.dest} (${s.width}x${s.height})`).join(", ")}`,
		});
	}
	const returnValue = toJsonValue(result.returnValue);
	return {
		ok: true,
		name: args.name,
		output,
		// The schema declares returnValue optional; an absent value must be an absent
		// KEY, because an own key holding `undefined` breaks the lossless-JSON boundary.
		...(returnValue === undefined ? {} : { returnValue }),
	};
}

/** Lossless-JSON projection of a run cell return value (non-JSON → undefined). */
function toJsonValue(value: unknown): JsonValue | undefined {
	if (value === undefined) return undefined;
	try {
		return JSON.parse(JSON.stringify(value)) as JsonValue;
	} catch {
		return undefined;
	}
}

async function saveImage(attachments: ToolServices["attachments"], image: ImageContent): Promise<ImageAttachmentRef> {
	const data = Buffer.from(image.data, "base64");
	const mediaType = normalizeMediaType(image.mimeType);
	const [ref] = await attachments.saveImages([{ data, mediaType, name: "browser-screenshot" }]);
	if (!ref) throw new ToolError("internal: image attachment store returned no reference");
	return ref;
}

function normalizeMediaType(mime: string): "image/png" | "image/jpeg" | "image/webp" | "image/gif" {
	if (mime === "image/jpeg" || mime === "image/png" || mime === "image/webp" || mime === "image/gif") return mime;
	return "image/png";
}

function normalizeViewport(
	vp: { width?: number; height?: number; deviceScaleFactor?: number } | undefined,
): { width: number; height: number; deviceScaleFactor?: number } | undefined {
	if (!vp || (vp.width === undefined && vp.height === undefined && vp.deviceScaleFactor === undefined)) return undefined;
	return {
		width: vp.width ?? 1365,
		height: vp.height ?? 768,
		deviceScaleFactor: vp.deviceScaleFactor,
	};
}

function expandScreenshotDir(settings: BrowserToolConfig): string | undefined {
	return expandBrowserScreenshotDir(settings.screenshotDir || undefined);
}

async function actionClose(args: BrowserToolArgs, exec: ToolRunContext, browserSettings: ResolvedBrowserConfig): Promise<BrowserToolValue> {
	void exec;
	void browserSettings;
	const timeoutMs = args.timeout ?? 10_000;
	const closed = await releaseTab(args.name, { kill: args.kill ?? false, timeoutMs });
	return {
		ok: true,
		name: args.name,
		message: closed
			? `Closed tab ${JSON.stringify(args.name)}${args.kill ? " and killed its browser" : ""}`
			: `Tab ${JSON.stringify(args.name)} was not open`,
	};
}

export default { name, inject, Config, apply };