/**
 * Browser relay mode: drive the user's own Chrome tabs through the local CDP
 * relay plus its companion extension. The relay impersonates Chrome's CDP
 * discovery endpoint, so beyond kind resolution the entire connected-browser
 * machinery (registry, tab supervisor, tab workers) applies unchanged.
 */
import { parseFlag } from "./../util.js";

/** Browser kind selecting the browser relay. */
export interface RelayKind {
	kind: "relay";
	cdpUrl: string;
}

/** Default endpoint of the relay CLI. */
export const DEFAULT_RELAY_URL = "http://127.0.0.1:9224";

export interface ResolveRelayKindOptions {
	/** `browser.relay` setting; `DSH_BROWSER_RELAY=0|1` overrides it. */
	settingEnabled?: boolean;
	/** `browser.relayUrl` setting; falls back to {@link DEFAULT_RELAY_URL}. */
	url?: string;
}

export function resolveRelayKind(
	options?: ResolveRelayKindOptions | null,
	env: Record<string, string | undefined> = process.env,
): RelayKind | null {
	if (!parseFlag(env.DSH_BROWSER_RELAY, options?.settingEnabled ?? false)) {
		return null;
	}
	const url = env.DSH_BROWSER_RELAY_URL?.trim() || options?.url?.trim() || DEFAULT_RELAY_URL;
	return { kind: "relay", cdpUrl: url.replace(/\/+$/, "") };
}