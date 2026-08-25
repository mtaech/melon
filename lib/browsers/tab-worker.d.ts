import type { ElementHandle } from "puppeteer-core";
import type { Transport } from "./types.js";
export interface OpTimeouts {
    budgetBound: number;
    quickOpMs: number;
    actionOpMs: number;
}
export declare function resolveOpTimeouts(cellTimeoutMs: number): OpTimeouts;
export declare function resolveWaitTimeout(cellTimeoutMs: number, explicit?: number): number;
export declare function normalizeSelector(selector: string): string;
/** A handle with the actionability primitives the API surfaces on `id(n)`/`ref(eN)`. */
export interface ActionableHandle extends ElementHandle {
    click(opts?: {
        delay?: number;
    }): Promise<void>;
    hover(): Promise<void>;
    focus(): Promise<void>;
    type(text: string, opts?: {
        delay?: number;
    }): Promise<void>;
    getBoundingBox(): Promise<{
        x: number;
        y: number;
        width: number;
        height: number;
    } | null>;
}
export declare class WorkerCore {
    #private;
    constructor(transport: Transport, cliMode: boolean);
    nextElementId(): number;
    cacheElement(id: number, handle: ElementHandle): void;
}
