/**
 * Smoke: after build, verify lib/client.cjs is a ModuleLoader bundle and
 * lib/host.js is present. Run with `pnpm run smoke`.
 */
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");

const client = path.join(root, "lib", "client.cjs");
const host = path.join(root, "lib", "host.js");

if (!existsSync(client)) throw new Error("lib/client.cjs missing — run `pnpm run build` first");
const text = readFileSync(client, "utf8");
if (!text.includes("__ModuleLoader__.load")) throw new Error("client.cjs does not look like a ModuleLoader bundle");
if (!text.includes("dsh-model-select-plus")) throw new Error("client.cjs is missing the plugin id");

if (!existsSync(host)) throw new Error("lib/host.js missing — run `pnpm run build` first");

console.log("smoke OK: lib/client.cjs is a ModuleLoader bundle, lib/host.js present");
