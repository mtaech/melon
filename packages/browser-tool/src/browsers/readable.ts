/**
 * Extract readable content from raw HTML. Ported from oh-my-pi `readable.ts`;
 * pi-utils dom/readability → linkedom + @mozilla/readability, and the
 * htmlToBasicMarkdown helper → turndown.
 */
import { parseHTML } from "linkedom";
import { Readability } from "@mozilla/readability";
import TurndownService from "turndown";

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

function normalize(text: string | null | undefined): string | undefined {
	const trimmed = text?.trim();
	return trimmed || undefined;
}

export function htmlToBasicMarkdown(html: string): string {
	const turndown = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced", bulletListMarker: "-" });
	turndown.addRule("implicitTables", {
		filter: (node: unknown) =>
			typeof node === "object" && node !== null && (node as { tagName?: string }).tagName === "table",
		replacement: function (_content: string, node: unknown) {
			const rows = Array.from((node as TableLike).querySelectorAll("tr"));
			return rows
				.map(row => {
					const cells = Array.from(row.querySelectorAll("th, td")).map(cell =>
						(cell.textContent ?? "").trim().replace(/\s+/g, " "),
					);
					return `| ${cells.join(" | ")} |`;
				})
				.join("\n");
		},
	});
	return turndown.turndown(html);
}

interface TableCellLike {
	textContent?: string | null;
}
interface TableRowLike extends TableCellLike {
	querySelectorAll(selector: string): ArrayLike<TableCellLike>;
}
interface TableLike {
	querySelectorAll(selector: string): ArrayLike<TableRowLike>;
}

/**
 * Extract readable content from raw HTML: Readability (article-isolation
 * scoring) first, then a CSS selector chain fallback. Returns null if neither
 * path yields usable content.
 */
export async function extractReadableFromHtml(
	html: string,
	url: string,
	format: ReadableFormat,
): Promise<ReadableResult | null> {
	const { document } = parseHTML(html);

	const article = new Readability(document as unknown as Document).parse();
	if (article) {
		const result = toReadableResult(url, format, article.textContent, article.content, {
			title: article.title,
			byline: article.byline,
			excerpt: article.excerpt,
			length: article.length,
		});
		if (result) return result;
	}

	const candidates = [
		document.querySelector("[data-pagefind-body]"),
		document.querySelector("main article"),
		document.querySelector("article"),
		document.querySelector("main"),
		document.querySelector("[role='main']"),
		document.body,
	];
	for (const el of candidates) {
		if (!el) continue;
		const innerHTML = (el as { innerHTML?: string }).innerHTML?.trim();
		const textContent = (el as { textContent?: string | null }).textContent?.trim();
		if (!innerHTML || !textContent) continue;
		const result = toReadableResult(url, format, textContent, innerHTML, {
			title: (document as { title?: string }).title,
			excerpt: textContent.slice(0, 240),
			length: textContent.length,
		});
		if (result) return result;
	}

	return null;
}

function toReadableResult(
	url: string,
	format: ReadableFormat,
	textContent: string | null | undefined,
	htmlContent: string | null | undefined,
	meta: { title?: string | null; byline?: string | null; excerpt?: string | null; length?: number | null },
): ReadableResult | null {
	const text = normalize(textContent);
	const markdown =
		format === "markdown" ? (normalize(htmlToBasicMarkdown(htmlContent ?? "")) ?? text) : undefined;
	const normalizedText = format === "text" ? text : undefined;
	if (!normalizedText && !markdown) return null;
	return {
		url,
		title: normalize(meta.title),
		byline: normalize(meta.byline),
		excerpt: normalize(meta.excerpt),
		contentLength: meta.length ?? text?.length ?? markdown?.length ?? 0,
		text: normalizedText,
		markdown,
	};
}