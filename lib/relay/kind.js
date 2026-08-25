/**
 * Browser relay mode: drive the user's own Chrome tabs through the local CDP
 * relay plus its companion extension. The relay impersonates Chrome's CDP
 * discovery endpoint, so beyond kind resolution the entire connected-browser
 * machinery (registry, tab supervisor, tab workers) applies unchanged.
 */
import { parseFlag } from "./../util.js";
/** Default endpoint of the relay CLI. */
export const DEFAULT_RELAY_URL = "http://127.0.0.1:9224";
export function resolveRelayKind(options, env = process.env) {
    if (!parseFlag(env.DSH_BROWSER_RELAY, options?.settingEnabled ?? false)) {
        return null;
    }
    const url = env.DSH_BROWSER_RELAY_URL?.trim() || options?.url?.trim() || DEFAULT_RELAY_URL;
    return { kind: "relay", cdpUrl: url.replace(/\/+$/, "") };
}
