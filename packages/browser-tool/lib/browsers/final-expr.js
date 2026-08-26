/**
 * Final-expression injection for run cells, ported from oh-my-pi's
 * `returnFinalExpression` (eval/js/shared/rewrite-imports.ts) minus the
 * import/TS rewriting: when a cell ends in a top-level expression statement or
 * an explicit `return`, it is rewritten to `await __setFinalExpr((expr))` so
 * the runtime can surface the value to the caller.
 */
import { parse } from "@babel/parser";
export function injectFinalExpression(code) {
    let body;
    try {
        body = parse(code, {
            sourceType: "module",
            allowAwaitOutsideFunction: true,
            allowReturnOutsideFunction: true,
            allowImportExportEverywhere: true,
            errorRecovery: true,
            plugins: ["typescript"],
        }).program.body;
    }
    catch {
        // Unparseable cells run verbatim; the runtime will surface the error.
        return { source: code, returned: false };
    }
    let lastIndex = body.length - 1;
    while (lastIndex >= 0 && body[lastIndex]?.type === "EmptyStatement")
        lastIndex--;
    const last = lastIndex >= 0 ? body[lastIndex] : undefined;
    if (last?.type === "ExpressionStatement") {
        const statement = last;
        if (statement.expression.start == null || statement.expression.end == null)
            return { source: code, returned: false };
        return {
            source: `${code.slice(0, statement.start ?? 0)}await __setFinalExpr((${code.slice(statement.expression.start, statement.expression.end)}));${code.slice(statement.end ?? code.length)}`,
            returned: true,
        };
    }
    if (last?.type === "ReturnStatement") {
        const ret = last;
        if (!ret.argument || ret.argument.start == null || ret.argument.end == null)
            return { source: code, returned: false };
        return {
            source: `${code.slice(0, ret.start ?? 0)}await __setFinalExpr((${code.slice(ret.argument.start, ret.argument.end)}));${code.slice(ret.end ?? code.length)}`,
            returned: true,
        };
    }
    return { source: code, returned: false };
}
