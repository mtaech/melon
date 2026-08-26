export interface CollectedFiles {
    /** Absolute, deduplicated, sorted real file paths. */
    files: string[];
    /** Total candidates encountered, including those beyond the cap. */
    searchedCount: number;
    limitReached: boolean;
}
export interface CollectOptions {
    cwd: string;
    maxFiles: number;
    /** node_modules skipping is disabled when a path explicitly names it. */
    allowNodeModules?: boolean;
}
export declare function collectFiles(input: string[], options: CollectOptions): Promise<CollectedFiles>;
