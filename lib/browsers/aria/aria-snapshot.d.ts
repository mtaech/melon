/**
 * ARIA snapshot capture for puppeteer pages. Ported from oh-my-pi
 * `aria/aria-snapshot.ts`; the committed Playwright bundle is read from the
 * package assets instead of a text import.
 */
import type { ElementHandle, Page } from "puppeteer-core";
export interface AriaSnapshotOptions {
    /** Maximum tree depth to render. */
    depth?: number;
    /** Append `[box=x,y,w,h]` bounding boxes to each node. */
    boxes?: boolean;
}
export declare function captureAriaSnapshot(page: Page, root: ElementHandle | null, options?: AriaSnapshotOptions): Promise<string>;
export declare function resolveAriaRefHandle(page: Page, ref: string): Promise<ElementHandle | null>;
/**
 * Guard the selector funnels: tab.click/type/fill/waitFor* take string
 * selectors only. Throws a recovery-naming ToolError for handles/promises.
 */
export declare function assertSelectorString(selector: unknown): asserts selector is string;
/**
 * Recognize a snapshot-ref selector and return the bare ref id, else null.
 * Accepts `aria-ref=e5` (Playwright-MCP style), `aria-ref/e5`, `ariaref/e5`,
 * and bare `e5`/`@e5`.
 */
export declare function parseAriaRefSelector(selector: string): string | null;
