export type ReadableFormat = "text" | "markdown";
export interface ReadableResult {
    url: string;
    title?: string;
    byline?: string;
    excerpt?: string;
    contentLength: number;
    text?: string;
    markdown?: string;
}
export declare function htmlToBasicMarkdown(html: string): string;
/**
 * Extract readable content from raw HTML: Readability (article-isolation
 * scoring) first, then a CSS selector chain fallback. Returns null if neither
 * path yields usable content.
 */
export declare function extractReadableFromHtml(html: string, url: string, format: ReadableFormat): Promise<ReadableResult | null>;
