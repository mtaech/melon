interface FinalInjection {
    source: string;
    /** True when the trailing expression was captured by `__setFinalExpr`. */
    returned: boolean;
}
export declare function injectFinalExpression(code: string): FinalInjection;
export {};
