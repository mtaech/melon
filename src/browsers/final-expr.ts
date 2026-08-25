/**
 * Final-expression injection for run cells, ported from oh-my-pi's
 * `returnFinalExpression` (eval/js/shared/rewrite-imports.ts) minus the
 * import/TS rewriting: when a cell ends in a top-level expression statement or
 * an explicit `return`, it is rewritten to `await __setFinalExpr((expr))` so
 * the runtime can surface the value to the caller.
 */
import { parse } from "@babel/parser";

interface FinalInjection {
	source: string;
	/** True when the trailing expression was captured by `__setFinalExpr`. */
	returned: boolean;
}

interface BodyNode {
	type: string;
	start?: number | null;
	end?: number | null;
}

interface ExpressionLike extends BodyNode {
	expression: { start?: number | null; end?: number | null };
}

interface ReturnLike extends BodyNode {
	argument?: { start?: number | null; end?: number | null } | null;
}

export function injectFinalExpression(code: string): FinalInjection {
	let body: BodyNode[];
	try {
		body = parse(code, {
			sourceType: "module",
			allowAwaitOutsideFunction: true,
			allowReturnOutsideFunction: true,
			allowImportExportEverywhere: true,
			errorRecovery: true,
			plugins: ["typescript"],
		}).program.body as BodyNode[];
	} catch {
		// Unparseable cells run verbatim; the runtime will surface the error.
		return { source: code, returned: false };
	}
	let lastIndex = body.length - 1;
	while (lastIndex >= 0 && body[lastIndex]?.type === "EmptyStatement") lastIndex--;
	const last = lastIndex >= 0 ? body[lastIndex] : undefined;
	if (last?.type === "ExpressionStatement") {
		const statement = last as ExpressionLike;
		if (statement.expression.start == null || statement.expression.end == null) return { source: code, returned: false };
		return {
			source: `${code.slice(0, statement.start ?? 0)}await __setFinalExpr((${code.slice(statement.expression.start, statement.expression.end)}));${code.slice(statement.end ?? code.length)}`,
			returned: true,
		};
	}
	if (last?.type === "ReturnStatement") {
		const ret = last as ReturnLike;
		if (!ret.argument || ret.argument.start == null || ret.argument.end == null) return { source: code, returned: false };
		return {
			source: `${code.slice(0, ret.start ?? 0)}await __setFinalExpr((${code.slice(ret.argument.start, ret.argument.end)}));${code.slice(ret.end ?? code.length)}`,
			returned: true,
		};
	}
	return { source: code, returned: false };
}