import type { ResolvedOp } from "./engine.js";
export interface StagedRewrite {
    id: string;
    sessionId: string;
    ops: ResolvedOp[];
    paths: string[];
    createdAt: number;
    totalReplacements: number;
    filesTouched: string[];
    perFileCount: Record<string, number>;
    /** Absolute resolved file list the preview operated on. */
    files: string[];
}
export declare class StagingRegistry {
    private entries;
    create(input: Omit<StagedRewrite, "id" | "createdAt">): StagedRewrite;
    get(id: string, sessionId: string): StagedRewrite | undefined;
    drop(id: string): boolean;
    /** Remove expired entries and evict the oldest beyond the cap. */
    prune(): void;
}
export declare const staging: StagingRegistry;
