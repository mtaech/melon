export interface ResolvedOp {
    pat: string;
    out: string;
}
/** One effective (content-changing) replacement, in editor-friendly form. */
export interface RewriteMatch {
    /** Real absolute path of the file. */
    file: string;
    /** 0-based line of the match start. */
    line: number;
    /** 0-based column of the match start. */
    column: number;
    /** Matched node text. */
    before: string;
    /** Replacement text (empty when the node is deleted). */
    after: string;
}
export interface RewriteResult {
    /** Effective replacement count per real file. */
    perFileCount: Map<string, number>;
    totalReplacements: number;
    filesTouched: string[];
    /** Effective matches in op order (op rules sorted by pattern string). */
    matches: RewriteMatch[];
    /** Cumulative rewritten content per real file (post-all-ops). */
    finalContents: Map<string, string>;
    /** Non-fatal CLI diagnostics (e.g. pattern parse notes on stderr). */
    warnings: string[];
}
export declare function computeRewrite(binary: string, ops: ResolvedOp[], files: string[], contents: ReadonlyMap<string, string>, signal: AbortSignal): Promise<RewriteResult>;
/** Validate and normalize model-supplied ops; throws on empty/duplicate patterns. */
export declare function resolveOps(ops: ReadonlyArray<{
    pat?: string;
    out?: string;
}>): ResolvedOp[];
