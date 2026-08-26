import { readAssetText } from "./../../asset.js";
import { ToolError } from "./../../errors.js";
const ariaBundle = readAssetText("aria-snapshot.bundle.txt");
/**
 * Page-side evaluators built ONCE here in the worker — never inside the page,
 * so page CSP never applies. They run the bundled Playwright ARIA-snapshot
 * sources (CJS) in a throwaway module scope. Puppeteer serializes these to a
 * CDP Runtime.evaluate in the page's MAIN world (the only world where the
 * bundle's `_ariaRef` ref expandos live). Nothing is installed on `window`.
 */
function buildEvaluator(params, call) {
    return new Function(...params.split(",").map(p => p.trim()), `var module = { exports: {} };\n${ariaBundle}\nreturn module.exports.${call};`);
}
// Handles (root) must stay top-level args: Puppeteer only unwraps JSHandles
// passed positionally to page.evaluate, never ones nested inside an object.
const evaluateAriaSnapshot = buildEvaluator("root, request", "ariaSnapshot(root, request)");
const evaluateResolveRef = buildEvaluator("ref", "resolveAriaRef(ref)");
export async function captureAriaSnapshot(page, root, options = {}) {
    const request = { depth: options.depth, boxes: options.boxes };
    return (await page.evaluate(evaluateAriaSnapshot, root, request));
}
export async function resolveAriaRefHandle(page, ref) {
    const handle = (await page.evaluateHandle(evaluateResolveRef, ref));
    const element = handle.asElement();
    if (!element) {
        await handle.dispose().catch(() => undefined);
        return null;
    }
    return element;
}
const ARIA_REF_PREFIXES = ["aria-ref=", "aria-ref/", "ariaref/"];
/**
 * Guard the selector funnels: tab.click/type/fill/waitFor* take string
 * selectors only. Throws a recovery-naming ToolError for handles/promises.
 */
export function assertSelectorString(selector) {
    if (typeof selector === "string")
        return;
    let kind;
    if (selector !== null && typeof selector === "object") {
        kind = "then" in selector && typeof selector.then === "function" ? "a Promise (missing await?)" : "an ElementHandle";
    }
    else {
        kind = `a ${typeof selector}`;
    }
    throw new ToolError(`Browser selector must be a string; got ${kind}. ` +
        "tab.click/type/fill/waitFor take string selectors only — " +
        'call the handle method directly (e.g. (await tab.id(n)).click()) or pass a string like "aria-ref=eN".');
}
/**
 * Recognize a snapshot-ref selector and return the bare ref id, else null.
 * Accepts `aria-ref=e5` (Playwright-MCP style), `aria-ref/e5`, `ariaref/e5`,
 * and bare `e5`/`@e5`.
 */
export function parseAriaRefSelector(selector) {
    assertSelectorString(selector);
    const trimmed = selector.trim();
    for (const prefix of ARIA_REF_PREFIXES) {
        if (trimmed.startsWith(prefix)) {
            const id = trimmed.slice(prefix.length).trim();
            return /^e\d+$/.test(id) ? id : null;
        }
    }
    const bare = /^@?(e\d+)$/.exec(trimmed);
    return bare ? bare[1] : null;
}
