/**
 * Plugin + tool configuration for dsh-ast-edit-tool. Environment overrides win
 * over the `astEdit` config block (DSH_AST_*), mirroring oh-my-pi and
 * dsh-browser-tool.
 */
import z from "@deepseek-ai/schemastery";
export declare const astEditConfigSchema: z<Schemastery.ObjectS<{
    enabled: z<boolean, boolean>;
    maxFiles: z<number, number>;
    maxRenderChanges: z<number, number>;
    binaryPath: z<string, string>;
}>, Schemastery.ObjectT<{
    enabled: z<boolean, boolean>;
    maxFiles: z<number, number>;
    maxRenderChanges: z<number, number>;
    binaryPath: z<string, string>;
}>>;
export type AstEditConfig = ReturnType<typeof astEditConfigSchema>;
/** Parse environment overrides onto the flat config block. */
export declare function resolveConfig(input: Partial<AstEditConfig>): AstEditConfig;
