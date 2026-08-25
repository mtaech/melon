export declare function isLoopbackRelayUrl(url: string): boolean;
export interface EnsureRelayDaemonOptions {
    cdpUrl: string;
    token?: string;
    signal?: AbortSignal;
}
/**
 * Ensure a relay answers at `cdpUrl`.
 * Returns false when a loopback relay could not be started or verified.
 */
export declare function ensureRelayDaemon(options: EnsureRelayDaemonOptions): Promise<boolean>;
