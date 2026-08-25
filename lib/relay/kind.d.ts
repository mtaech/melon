/** Browser kind selecting the browser relay. */
export interface RelayKind {
    kind: "relay";
    cdpUrl: string;
}
/** Default endpoint of the relay CLI. */
export declare const DEFAULT_RELAY_URL = "http://127.0.0.1:9224";
export interface ResolveRelayKindOptions {
    /** `browser.relay` setting; `DSH_BROWSER_RELAY=0|1` overrides it. */
    settingEnabled?: boolean;
    /** `browser.relayUrl` setting; falls back to {@link DEFAULT_RELAY_URL}. */
    url?: string;
}
export declare function resolveRelayKind(options?: ResolveRelayKindOptions | null, env?: Record<string, string | undefined>): RelayKind | null;
