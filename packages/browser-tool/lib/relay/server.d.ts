export interface RelayServerOptions {
    port?: number;
    host?: string;
    /** Secret that browsers verifying the extension must send as `?token=` / `X-Relay-Token`. */
    token?: string;
    log?: (message: string, data?: Record<string, unknown>) => void;
    /** Group driven tabs into a named Chrome tab group. */
    group?: {
        title: string;
        color: string;
    } | null;
}
export interface RelayServerHandle {
    port: number;
    url: string;
    close(): Promise<void>;
}
export declare function startRelayServer(options?: RelayServerOptions): Promise<RelayServerHandle>;
