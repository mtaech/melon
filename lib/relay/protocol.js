/**
 * Wire protocol between the relay server and the Chrome extension. Ported
 * verbatim from oh-my-pi `relay/protocol.ts`. The extension dials out to
 * `ws://127.0.0.1:<port>/ext`; the relay drives the extension with numbered
 * RPCs, and the extension pushes tab lifecycle + `chrome.debugger` events.
 */
export {};
