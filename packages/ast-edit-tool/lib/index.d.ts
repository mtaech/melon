import { type AstEditConfig } from "./config.js";
import { type Context } from "./deps.js";
export declare const name = "dsh-ast-edit-tool";
export declare const inject: string[];
export declare const Config: import("@deepseek-ai/schemastery").default<Schemastery.ObjectS<{
    enabled: import("@deepseek-ai/schemastery").default<boolean, boolean>;
    maxFiles: import("@deepseek-ai/schemastery").default<number, number>;
    maxRenderChanges: import("@deepseek-ai/schemastery").default<number, number>;
    binaryPath: import("@deepseek-ai/schemastery").default<string, string>;
}>, Schemastery.ObjectT<{
    enabled: import("@deepseek-ai/schemastery").default<boolean, boolean>;
    maxFiles: import("@deepseek-ai/schemastery").default<number, number>;
    maxRenderChanges: import("@deepseek-ai/schemastery").default<number, number>;
    binaryPath: import("@deepseek-ai/schemastery").default<string, string>;
}>>;
export interface AstEditValue {
    ok: boolean;
    action: "preview" | "apply" | "reject";
    applied: boolean;
    totalReplacements: number;
    filesTouched: number;
    filesSearched: number;
    limitReached: boolean;
    stagedId?: string;
    message?: string;
    changes?: Array<{
        file: string;
        line: number;
        column: number;
        before: string;
        after: string;
    }>;
    parseErrors?: Array<{
        kind: string;
        file?: string;
        message: string;
    }>;
}
export declare function apply(ctx: Context, options?: Partial<AstEditConfig>): (() => void) | void;
