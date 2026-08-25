/**
 * Wire protocol between the tab supervisor and its tab workers.
 * Ported from oh-my-pi `tab-protocol.ts`; `Bun.Transferable` and the pi-ai
 * content types are replaced with local plain-JSON types (image payloads ride
 * as base64 strings through Node worker_threads' structured clone).
 */
export {};
