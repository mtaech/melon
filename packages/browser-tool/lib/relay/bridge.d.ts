/** Transport-agnostic websocket surface the bridge writes to. */
export interface RelaySocket {
    send(text: string): void;
    close(): void;
}
/**
 * Multiplexing CDP bridge between downstream puppeteer connections and the
 * relay extension. One instance per relay server; all state lives here so an
 * extension service-worker restart only has to re-handshake.
 */
export declare class RelayBridge {
    #private;
    constructor(opts?: {
        log?: (message: string, data?: Record<string, unknown>) => void;
        /** Group tabs the agent actively drives under one per-window Chrome tab group. */
        group?: {
            title: string;
            color: string;
        } | null;
    });
    /** True once the extension has completed its hello handshake. */
    get ready(): boolean;
    /** Payload for `GET /json/version`. */
    versionInfo(wsUrl: string): Record<string, string>;
    /** Payload for `GET /json/list` (debugging aid; per-target endpoints are not served). */
    listTargets(): Array<Record<string, string>>;
    extConnected(socket: RelaySocket): void;
    extClosed(socket: RelaySocket): void;
    extMessage(socket: RelaySocket, raw: string): void;
    /** Register a downstream CDP websocket; returns the connection id. */
    cdpConnected(socket: RelaySocket): number;
    cdpClosed(connId: number): void;
    cdpMessage(connId: number, raw: string): void;
}
