/**
 * Extract readable content from raw HTML. Ported from oh-my-pi `readable.ts`;
 * pi-utils dom/readability → linkedom + @mozilla/readability, and the
 * htmlToBasicMarkdown helper → turndown.
 */
import { parseHTML } from "linkedom";
import { Readability } from "@mozilla/readability";
import TurndownService from "turndown";
function normalize(text) {
    const trimmed = text?.trim();
    return trimmed || undefined;
}
export function htmlToBasicMarkdown(html) {
    const turndown = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced", bulletListMarker: "-" });
    turndown.addRule("implicitTables", {
        filter: (node) => typeof node === "object" && node !== null && node.tagName === "table",
        replacement: function (_content, node) {
            const rows = Array.from(node.querySelectorAll("tr"));
            return rows
                .map(row => {
                const cells = Array.from(row.querySelectorAll("th, td")).map(cell => (cell.textContent ?? "").trim().replace(/\s+/g, " "));
                return `| ${cells.join(" | ")} |`;
            })
                .join("\n");
        },
    });
    return turndown.turndown(html);
}
/**
 * Extract readable content from raw HTML: Readability (article-isolation
 * scoring) first, then a CSS selector chain fallback. Returns null if neither
 * path yields usable content.
 */
export async function extractReadableFromHtml(html, url, format) {
    const { document } = parseHTML(html);
    const article = new Readability(document).parse();
    if (article) {
        const result = toReadableResult(url, format, article.textContent, article.content, {
            title: article.title,
            byline: article.byline,
            excerpt: article.excerpt,
            length: article.length,
        });
        if (result)
            return result;
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
        if (!el)
            continue;
        const innerHTML = el.innerHTML?.trim();
        const textContent = el.textContent?.trim();
        if (!innerHTML || !textContent)
            continue;
        const result = toReadableResult(url, format, textContent, innerHTML, {
            title: document.title,
            excerpt: textContent.slice(0, 240),
            length: textContent.length,
        });
        if (result)
            return result;
    }
    return null;
}
function toReadableResult(url, format, textContent, htmlContent, meta) {
    const text = normalize(textContent);
    const markdown = format === "markdown" ? (normalize(htmlToBasicMarkdown(htmlContent ?? "")) ?? text) : undefined;
    const normalizedText = format === "text" ? text : undefined;
    if (!normalizedText && !markdown)
        return null;
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
