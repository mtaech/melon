/**
 * ARIA snapshot capture for puppeteer pages. Ported from oh-my-pi
 * `aria/aria-snapshot.ts`; the committed Playwright bundle is read from the
 * package assets instead of a text import.
 */
import type { ElementHandle, JSHandle, Page } from "puppeteer-core";
import { readAssetText } from "./../../asset.js";
import { ToolError } from "./../../errors.js";

const ariaBundle = readAssetText("aria-snapshot.bundle.txt");

export interface AriaSnapshotOptions {
	/** Maximum tree depth to render. */
	depth?: number;
	/** Append `[box=x,y,w,h]` bounding boxes to each node. */
	boxes?: boolean;
}

/**
 * Page-side evaluators built ONCE here in the worker — never inside the page,
 * so page CSP never applies. They run the bundled Playwright ARIA-snapshot
 * sources (CJS) in a throwaway module scope. Puppeteer serializes these to a
 * CDP Runtime.evaluate in the page's MAIN world (the only world where the
 * bundle's `_ariaRef` ref expandos live). Nothing is installed on `window`.
 */
function buildEvaluator(params: string, call: string): (...args: unknown[]) => unknown {
	return new Function(
		...params.split(",").map(p => p.trim()),
		`var module = { exports: {} };\n${ariaBundle}\nreturn module.exports.${call};`,
	) as unknown as (...args: unknown[]) => unknown;
}

// Handles (root) must stay top-level args: Puppeteer only unwraps JSHandles
// passed positionally to page.evaluate, never ones nested inside an object.
const evaluateAriaSnapshot = buildEvaluator("root, request", "ariaSnapshot(root, request)");
const evaluateResolveRef = buildEvaluator("ref", "resolveAriaRef(ref)");

export async function captureAriaSnapshot(
	page: Page,
	root: ElementHandle | null,
	options: AriaSnapshotOptions = {},
): Promise<string> {
	const request = { depth: options.depth, boxes: options.boxes };
	return (await page.evaluate(evaluateAriaSnapshot as never, root as never, request as never)) as string;
}

export async function resolveAriaRefHandle(page: Page, ref: string): Promise<ElementHandle | null> {
	const handle = (await page.evaluateHandle(evaluateResolveRef as never, ref as never)) as JSHandle;
	const element = handle.asElement();
	if (!element) {
		await handle.dispose().catch(() => undefined);
		return null;
	}
	return element as ElementHandle;
}

const ARIA_REF_PREFIXES = ["aria-ref=", "aria-ref/", "ariaref/"];

/**
 * Guard the selector funnels: tab.click/type/fill/waitFor* take string
 * selectors only. Throws a recovery-naming ToolError for handles/promises.
 */
export function assertSelectorString(selector: unknown): asserts selector is string {
	if (typeof selector === "string") return;
	let kind: string;
	if (selector !== null && typeof selector === "object") {
		kind = "then" in selector && typeof selector.then === "function" ? "a Promise (missing await?)" : "an ElementHandle";
	} else {
		kind = `a ${typeof selector}`;
	}
	throw new ToolError(
		`Browser selector must be a string; got ${kind}. ` +
			"tab.click/type/fill/waitFor take string selectors only — " +
			'call the handle method directly (e.g. (await tab.id(n)).click()) or pass a string like "aria-ref=eN".',
	);
}

/**
 * Recognize a snapshot-ref selector and return the bare ref id, else null.
 * Accepts `aria-ref=e5` (Playwright-MCP style), `aria-ref/e5`, `ariaref/e5`,
 * and bare `e5`/`@e5`.
 */
export function parseAriaRefSelector(selector: string): string | null {
	assertSelectorString(selector);
	const trimmed = selector.trim();
	for (const prefix of ARIA_REF_PREFIXES) {
		if (trimmed.startsWith(prefix)) {
			const id = trimmed.slice(prefix.length).trim();
			return /^e\d+$/.test(id) ? id : null;
		}
	}
	const bare = /^@?(e\d+)$/.exec(trimmed);
	return bare ? bare[1]! : null;
}