/**
 * Chromium resolution, puppeteer loading, headless launch, stealth injection,
 * and user-agent override. Ported from oh-my-pi `launch.ts`; `Bun.spawn` →
 * `node:child_process`, `@oh-my-pi/pi-utils/browsers` → `@puppeteer/browsers`,
 * text imports → `readAssetText`.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFile } from "node:child_process";
import { detectBrowserPlatform, resolveBuildId, computeExecutablePath, install, Browser as PpbBrowser } from "@puppeteer/browsers";
import { readAssetText } from "./../asset.js";
import { adoptDonorChromium, findDonorChromium } from "./donor-chromium.js";
import { cacheDir, logger, which, puppeteerExecutablePathFromEnv } from "./../util.js";
import { ToolError } from "./../errors.js";
export const DEFAULT_VIEWPORT = { width: 1365, height: 768, deviceScaleFactor: 1.25 };
/** Per-CDP-message timeout applied to every puppeteer launch/connect (catches genuinely stuck CDP sockets). */
export const BROWSER_PROTOCOL_TIMEOUT_MS = 60_000;
const STEALTH_ACCEPT_LANGUAGE = "en-US,en";
const USER_AGENT_TARGET_TIMEOUT_MS = 5_000;
const USER_AGENT_TARGET_TYPES = new Set(["page", "webview", "background_page"]);
const PUPPETEER_SOURCE_URL_SUFFIX = "//# sourceURL=__puppeteer_evaluation_script__";
const ENABLE_AUTOMATION_FLAG = "--enable-automation";
/**
 * Puppeteer default launch flags suppressed for stealth. Ported verbatim from
 * oh-my-pi (its "stealthIgnoreDefaultArgs"); Edge is the stability exception.
 */
const STEALTH_IGNORE_DEFAULT_ARGS = [
    ENABLE_AUTOMATION_FLAG,
    "--disable-extensions",
    "--disable-default-apps",
    "--disable-component-extensions-with-background-pages",
    "--disable-popup-blocking",
    "--disable-client-side-phishing-detection",
    "--allow-pre-commit-input",
    "--disable-ipc-flooding-protection",
    "--metrics-recording-only",
];
function isMicrosoftEdgeExecutable(executablePath) {
    if (!executablePath)
        return false;
    const normalizedPath = executablePath.replaceAll("\\", "/").toLowerCase();
    const executableName = normalizedPath.slice(normalizedPath.lastIndexOf("/") + 1);
    return executableName === "msedge.exe" || executableName === "microsoft edge";
}
function stealthIgnoreDefaultArgs(executablePath) {
    // Edge keeps `--enable-automation`: it can exit before CDP opens when the
    // flag is stripped. Our explicit --disable-blink-features=AutomationControlled
    // still handles navigator.webdriver.
    if (isMicrosoftEdgeExecutable(executablePath))
        return STEALTH_IGNORE_DEFAULT_ARGS.filter(f => f !== ENABLE_AUTOMATION_FLAG);
    return STEALTH_IGNORE_DEFAULT_ARGS;
}
let puppeteerModule;
export async function loadPuppeteer() {
    if (!puppeteerModule) {
        puppeteerModule = (await import("puppeteer-core")).default;
    }
    return puppeteerModule;
}
let puppeteerModuleWorker;
export async function loadPuppeteerInWorker() {
    if (puppeteerModuleWorker)
        return puppeteerModuleWorker;
    puppeteerModuleWorker = (await import("puppeteer-core")).default;
    return puppeteerModuleWorker;
}
let chromiumExecutablePromise;
let resolvedChromium; // undefined = unchecked; null = not found
function isExecutableFile(p) {
    try {
        const st = fs.statSync(p);
        if (!st.isFile())
            return false;
        if (process.platform === "win32")
            return true;
        fs.accessSync(p, fs.constants.X_OK);
        return true;
    }
    catch {
        return false;
    }
}
async function isChromiumExecutable(p) {
    if (!isExecutableFile(p))
        return false;
    // The version probe rejects non-Chromium `chrome`/`chromium` wrapper
    // scripts that appear on a Linux PATH. On Windows/macOS the candidates are
    // fixed GUI application paths; executing them is harmful (#8445).
    if (process.platform !== "linux")
        return true;
    try {
        const probeTimeoutMs = 3000;
        const stdout = await new Promise(resolve => {
            const child = execFile(p, ["--version"], { timeout: probeTimeoutMs + 500 }, (error, out) => {
                if (error)
                    resolve(null);
                else
                    resolve(out);
            });
            // execFile already kills on timeout; nothing else to do.
            void child;
        });
        if (stdout === null)
            return false;
        return /Chrom|Edg/i.test(stdout);
    }
    catch {
        return false;
    }
}
/** Flatpak application id published by the Ungoogled Chromium project. */
const UNGOOGLED_CHROMIUM_FLATPAK_ID = "io.github.ungoogled_software.ungoogled_chromium";
function systemChromiumCandidates(platform = process.platform, home = os.homedir()) {
    const candidates = [];
    switch (platform) {
        case "darwin": {
            for (const root of ["/Applications", path.join(home, "Applications")]) {
                candidates.push(path.join(root, "Google Chrome.app/Contents/MacOS/Google Chrome"), path.join(root, "Google Chrome Beta.app/Contents/MacOS/Google Chrome Beta"), path.join(root, "Google Chrome Dev.app/Contents/MacOS/Google Chrome Dev"), path.join(root, "Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary"), path.join(root, "Chromium.app/Contents/MacOS/Chromium"), path.join(root, "Microsoft Edge.app/Contents/MacOS/Microsoft Edge"));
            }
            break;
        }
        case "linux": {
            const names = ["google-chrome-stable", "google-chrome", "chromium", "chromium-browser", "chrome"];
            for (const name of names) {
                const found = which(name);
                if (found)
                    candidates.push(found);
            }
            candidates.push("/usr/bin/google-chrome-stable", "/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser", "/snap/bin/chromium", "/var/lib/flatpak/exports/bin/com.google.Chrome", "/var/lib/flatpak/exports/bin/org.chromium.Chromium");
            let onNixos = false;
            try {
                onNixos = fs.existsSync("/etc/NIXOS");
            }
            catch {
                // ignore
            }
            if (onNixos) {
                candidates.push(path.join(home, ".nix-profile/bin/chromium"), "/run/current-system/sw/bin/chromium");
            }
            for (const name of ["ungoogled-chromium", "ungoogled-chromium-browser"]) {
                const found = which(name);
                if (found)
                    candidates.push(found);
            }
            candidates.push("/usr/bin/ungoogled-chromium", "/usr/bin/ungoogled-chromium-browser", `/var/lib/flatpak/exports/bin/${UNGOOGLED_CHROMIUM_FLATPAK_ID}`, path.join(home, ".local/share/flatpak/exports/bin", UNGOOGLED_CHROMIUM_FLATPAK_ID));
            break;
        }
        case "win32": {
            const programFiles = process.env.ProgramFiles ?? "C:\\Program Files";
            const programFilesX86 = process.env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)";
            const localAppData = process.env.LOCALAPPDATA ?? path.join(home, "AppData\\Local");
            candidates.push(path.join(programFiles, "Google\\Chrome\\Application\\chrome.exe"), path.join(programFilesX86, "Google\\Chrome\\Application\\chrome.exe"), path.join(localAppData, "Google\\Chrome\\Application\\chrome.exe"), path.join(programFiles, "Chromium\\Application\\chrome.exe"), path.join(localAppData, "Chromium\\Application\\chrome.exe"), path.join(programFiles, "Microsoft\\Edge\\Application\\msedge.exe"), path.join(programFilesX86, "Microsoft\\Edge\\Application\\msedge.exe"));
            break;
        }
    }
    return candidates;
}
async function resolveSystemChromium() {
    if (resolvedChromium !== undefined)
        return resolvedChromium ?? undefined;
    const seen = new Set();
    for (const candidate of systemChromiumCandidates()) {
        if (!candidate || seen.has(candidate))
            continue;
        seen.add(candidate);
        if (await isChromiumExecutable(candidate)) {
            resolvedChromium = candidate;
            logger.debug("Using system Chrome/Chromium", { path: candidate });
            return candidate;
        }
    }
    resolvedChromium = null;
    return undefined;
}
/** Chrome for Testing cache directory under the package cache dir. */
export function getPuppeteerDir() {
    return path.join(cacheDir(), "puppeteer");
}
/**
 * Resolve the Chromium executable puppeteer will launch: env override first,
 * then a detected system Chromium (non-macOS), then a Chrome for Testing
 * install under the package cache dir (downloaded on first use).
 */
export async function ensureChromiumExecutable() {
    const envPath = puppeteerExecutablePathFromEnv();
    if (envPath)
        return envPath;
    const preferManagedChromium = process.platform === "darwin";
    if (!preferManagedChromium) {
        const sysChrome = await resolveSystemChromium();
        if (sysChrome)
            return sysChrome;
    }
    chromiumExecutablePromise ??= (async () => {
        const platform = detectBrowserPlatform();
        if (!platform) {
            logger.warn("Could not detect browser platform; relying on puppeteer default resolution");
            return undefined;
        }
        const cacheDirPath = getPuppeteerDir();
        const buildId = await resolveBuildId(PpbBrowser.CHROME, platform, "stable");
        const executablePath = computeExecutablePath({ browser: PpbBrowser.CHROME, buildId, cacheDir: cacheDirPath, platform });
        if (fs.existsSync(executablePath))
            return executablePath;
        // Before paying for a download, adopt a Chromium another @puppeteer/browsers
        // consumer already has (oh-my-pi's cache, puppeteer's own default cache).
        const donor = findDonorChromium(platform, buildId);
        if (donor !== undefined)
            return adoptDonorChromium(donor, cacheDirPath);
        logger.warn("Downloading Chromium (Chrome for Testing) — first browser use", { buildId, platform, cacheDir: cacheDirPath });
        await install({
            browser: PpbBrowser.CHROME,
            buildId,
            cacheDir: cacheDirPath,
            platform,
        });
        return executablePath;
    })().catch(err => {
        chromiumExecutablePromise = undefined;
        throw new ToolError(`Failed to install Chromium for puppeteer: ${err.message}. ` +
            "Set PUPPETEER_EXECUTABLE_PATH to use an existing Chrome/Chromium binary, or install one manually.");
    });
    try {
        return await chromiumExecutablePromise;
    }
    catch (err) {
        if (!preferManagedChromium)
            throw err;
        // macOS: Chrome for Testing unavailable → degrade to system Chrome bundle.
        const sysChrome = await resolveSystemChromium();
        if (!sysChrome)
            throw err;
        logger.warn("Chrome for Testing unavailable; falling back to the system Chrome bundle", {
            path: sysChrome,
            error: err.message,
        });
        return sysChrome;
    }
}
/** Base Chromium argv shared by launches: sandbox/stealth flags, window size, proxy env. */
export function buildHeadlessLaunchArgs(viewport) {
    const launchArgs = [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-blink-features=AutomationControlled",
        `--window-size=${viewport.width},${viewport.height}`,
    ];
    const proxy = process.env.PUPPETEER_PROXY;
    if (proxy) {
        launchArgs.push(`--proxy-server=${proxy}`);
        const bypassLoopback = process.env.PUPPETEER_PROXY_BYPASS_LOOPBACK?.toLowerCase();
        if (bypassLoopback === "true" || bypassLoopback === "1" || bypassLoopback === "yes" || bypassLoopback === "on") {
            launchArgs.push("--proxy-bypass-list=<-loopback>");
        }
    }
    const ignoreCert = process.env.PUPPETEER_PROXY_IGNORE_CERT_ERRORS?.toLowerCase();
    if (ignoreCert === "true" || ignoreCert === "1" || ignoreCert === "yes" || ignoreCert === "on") {
        launchArgs.push("--ignore-certificate-errors");
    }
    return launchArgs;
}
export async function launchHeadlessBrowser(opts) {
    const vp = opts.viewport ?? DEFAULT_VIEWPORT;
    const initialViewport = {
        width: vp.width,
        height: vp.height,
        deviceScaleFactor: vp.deviceScaleFactor ?? DEFAULT_VIEWPORT.deviceScaleFactor,
    };
    const puppeteer = await loadPuppeteer();
    const launchArgs = buildHeadlessLaunchArgs(initialViewport);
    for (const arg of opts.args ?? []) {
        if (!launchArgs.includes(arg))
            launchArgs.push(arg);
    }
    // Own the profile directory (puppeteer treats an explicit --user-data-dir as
    // non-temporary, so its eager cleanup hook can't reject with EBUSY); we
    // remove it on our terms via removeUserDataDir.
    let userDataDir;
    if (!launchArgs.some(arg => arg.startsWith("--user-data-dir"))) {
        userDataDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "dsh-chrome-profile-"));
        launchArgs.push(`--user-data-dir=${userDataDir}`);
    }
    try {
        const executablePath = await ensureChromiumExecutable();
        const browser = await puppeteer.launch({
            headless: opts.headless,
            defaultViewport: opts.headless ? initialViewport : null,
            executablePath,
            args: launchArgs,
            ignoreDefaultArgs: [...new Set([...stealthIgnoreDefaultArgs(executablePath), ...(opts.ignoreDefaultArgs ?? [])])],
            protocolTimeout: BROWSER_PROTOCOL_TIMEOUT_MS,
        });
        return { browser, userDataDir };
    }
    catch (error) {
        if (userDataDir)
            await removeUserDataDir(userDataDir);
        throw error;
    }
}
/** Remove an owned Chromium profile dir, tolerating transient EBUSY/EPERM locks. */
export async function removeUserDataDir(dir) {
    try {
        await fs.promises.rm(dir, { recursive: true, force: true });
    }
    catch {
        logger.warn("Left Chromium profile directory in place after cleanup failure", { dir });
    }
}
export async function applyViewport(page, viewport) {
    if (!viewport) {
        await page.setViewport(DEFAULT_VIEWPORT);
        return;
    }
    await page.setViewport({
        width: viewport.width,
        height: viewport.height,
        deviceScaleFactor: viewport.deviceScaleFactor ?? DEFAULT_VIEWPORT.deviceScaleFactor,
    });
}
function resolvePageClient(page) {
    const pageWithClient = page;
    if (!pageWithClient._client)
        return null;
    return typeof pageWithClient._client === "function" ? pageWithClient._client() : pageWithClient._client;
}
const patchedClients = new WeakSet();
/**
 * Strip puppeteer's synthetic `//# sourceURL=__puppeteer_evaluation_script__`
 * marker from Runtime.evaluate / Runtime.callFunctionOn payloads so the
 * automation tell never shows in V8 stack/debugger listings.
 */
function patchSourceUrl(page) {
    const client = resolvePageClient(page);
    if (!client)
        return;
    const clientKey = client;
    if (patchedClients.has(clientKey))
        return;
    patchedClients.add(clientKey);
    const originalSend = client.send.bind(client);
    client.send = async (method, params) => {
        const next = async (payload) => {
            try {
                return await originalSend(method, payload);
            }
            catch (error) {
                if (error instanceof Error &&
                    error.message.includes("Protocol error (Network.getResponseBody): No resource with given identifier found")) {
                    return undefined;
                }
                throw error;
            }
        };
        if (!method || !params)
            return next(params);
        const key = method === "Runtime.evaluate"
            ? "expression"
            : method === "Runtime.callFunctionOn"
                ? "functionDeclaration"
                : null;
        if (!key)
            return next(params);
        const value = params[key];
        if (typeof value !== "string" || !value.includes(PUPPETEER_SOURCE_URL_SUFFIX))
            return next(params);
        const patchedParams = { ...params, [key]: value.replace(PUPPETEER_SOURCE_URL_SUFFIX, "") };
        return next(patchedParams);
    };
}
async function resolveMacOsProductVersion() {
    if (os.platform() !== "darwin")
        return "";
    try {
        const plist = fs.readFileSync("/System/Library/CoreServices/SystemVersion.plist", "utf8");
        return plist.match(/<key>ProductVersion<\/key>\s*<string>([^<]+)<\/string>/)?.[1] ?? "";
    }
    catch {
        return "";
    }
}
function resolveHostArchitecture() {
    if (os.arch() === "arm64")
        return "arm";
    if (os.arch().includes("64"))
        return "x86";
    return "";
}
function resolveHostBitness() {
    return os.arch().includes("64") ? "64" : "";
}
async function resolveUserAgentOverride(page) {
    const rawUserAgent = await page.browser().userAgent();
    let userAgent = rawUserAgent.replace("HeadlessChrome/", "Chrome/");
    if (userAgent.includes("Linux") && !userAgent.includes("Android")) {
        userAgent = userAgent.replace(/\(([^)]+)\)/, "(Windows NT 10.0; Win64; x64)");
    }
    const uaVersionMatch = userAgent.match(/Chrome\/([\d|.]+)/);
    const browserVersionMatch = (await page.browser().version()).match(/\/([\d|.]+)/);
    const legacyVersion = uaVersionMatch?.[1] ?? browserVersionMatch?.[1] ?? "0";
    const fullVersion = browserVersionMatch?.[1] ?? legacyVersion;
    const majorVersion = Number.parseInt(legacyVersion.split(".")[0] ?? "0", 10) || 0;
    const isAndroid = userAgent.includes("Android");
    const isMac = userAgent.includes("Mac OS X");
    const isWindows = userAgent.includes("Windows");
    const platform = isMac ? "MacIntel" : isAndroid ? "Android" : userAgent.includes("Linux") ? "Linux" : "Win32";
    const platformFull = isMac ? "macOS" : isAndroid ? "Android" : userAgent.includes("Linux") ? "Linux" : "Windows";
    const platformVersion = isMac
        ? await resolveMacOsProductVersion()
        : userAgent.includes("Android ")
            ? (userAgent.match(/Android ([^;]+)/)?.[1] ?? "")
            : isWindows
                ? (userAgent.match(/Windows NT ([\d.]+)/)?.[1] ?? "")
                : "";
    const architecture = isAndroid ? "" : resolveHostArchitecture();
    const bitness = isAndroid ? "" : resolveHostBitness();
    const model = isAndroid ? (userAgent.match(/Android.*?;\s([^)]+)/)?.[1] ?? "") : "";
    const brandOrders = [
        [0, 1, 2],
        [0, 2, 1],
        [1, 0, 2],
        [1, 2, 0],
        [2, 0, 1],
        [2, 1, 0],
    ];
    const order = brandOrders[majorVersion % brandOrders.length] ?? brandOrders[0];
    const escapedChars = [" ", " ", ";"];
    const greaseyBrand = `${escapedChars[order[0]]}Not${escapedChars[order[1]]}A${escapedChars[order[2]]}Brand`;
    const brands = [];
    brands[order[0]] = { brand: greaseyBrand, version: "99" };
    brands[order[1]] = { brand: "Chromium", version: String(majorVersion) };
    brands[order[2]] = { brand: "Google Chrome", version: String(majorVersion) };
    const fullVersionList = brands.map(({ brand }) => ({
        brand,
        version: brand === greaseyBrand ? "99.0.0.0" : fullVersion,
    }));
    return {
        userAgent,
        platform,
        acceptLanguage: STEALTH_ACCEPT_LANGUAGE,
        userAgentMetadata: {
            brands,
            fullVersion,
            fullVersionList,
            platform: platformFull,
            platformVersion,
            architecture,
            bitness,
            model,
            mobile: isAndroid,
        },
    };
}
function wrapSession(session) {
    return {
        send: async (method, params) => session.send(method, params),
    };
}
async function sendUserAgentOverride(client, override) {
    try {
        await client.send("Network.enable");
    }
    catch {
        // ignore
    }
    try {
        await client.send("Network.setUserAgentOverride", override);
    }
    catch (error) {
        logger.debug("Failed to apply Network user agent override", {
            error: error instanceof Error ? error.message : String(error),
        });
    }
    try {
        await client.send("Emulation.setUserAgentOverride", override);
    }
    catch (error) {
        logger.debug("Failed to apply Emulation user agent override", {
            error: error instanceof Error ? error.message : String(error),
        });
    }
}
function targetInfoSupportsUserAgentOverride(targetInfo) {
    return Boolean(targetInfo?.type && USER_AGENT_TARGET_TYPES.has(targetInfo.type));
}
function targetSupportsUserAgentOverride(target) {
    return targetInfoSupportsUserAgentOverride({ type: target.type() });
}
async function applyTargetUserAgentOverride(target, override) {
    const session = await target.createCDPSession();
    try {
        await sendUserAgentOverride(wrapSession(session), override);
    }
    finally {
        await session.detach().catch(() => undefined);
    }
}
async function withSoftTimeout(promise, timeoutMs, label) {
    let timeout;
    const timeoutPromise = new Promise(resolve => {
        timeout = setTimeout(() => {
            logger.debug(`Timed out applying ${label}`);
            resolve(undefined);
        }, timeoutMs);
    });
    try {
        return await Promise.race([
            promise.catch(error => {
                logger.debug(`Failed to apply ${label}`, { error: error instanceof Error ? error.message : String(error) });
                return undefined;
            }),
            timeoutPromise,
        ]);
    }
    finally {
        if (timeout)
            clearTimeout(timeout);
    }
}
const STEALTH_PATCH_SCRIPTS = [
    "00_stealth_tampering.txt",
    "01_stealth_activity.txt",
    "02_stealth_hairline.txt",
    "03_stealth_botd.txt",
    "04_stealth_iframe.txt",
    "05_stealth_webgl.txt",
    "06_stealth_screen.txt",
    "07_stealth_fonts.txt",
    "08_stealth_audio.txt",
    "09_stealth_locale.txt",
    "10_stealth_plugins.txt",
    "11_stealth_hardware.txt",
    "12_stealth_codecs.txt",
    "13_stealth_worker.txt",
].map(name => ({ name, src: readAssetText("stealth", name) }));
/** Build the browser-page stealth bootstrap source (ported verbatim from oh-my-pi). */
export function buildStealthInjectionScript() {
    const joint = STEALTH_PATCH_SCRIPTS.map(({ src }) => `
	try {
		${src};
	} catch (e) {}
`).join(";\n");
    return `(() => {
				const Page_Function_toString = Function.prototype.toString;
				const Page_FunctionToStringDescriptor = Object.getOwnPropertyDescriptor(Function.prototype, "toString");
				const Page_Proxy = Proxy;
				const Page_WeakMap = WeakMap;
				const Page_WeakMap_get = Page_WeakMap.prototype.get;
				const Page_WeakMap_set = Page_WeakMap.prototype.set;
				// Native function cache - captured before any tampering.
				let iframe = null;
				const container = document.head ?? document.documentElement;
				if (container) {
					iframe = document.createElement("iframe");
					iframe.style.display = "none";
					container.appendChild(iframe);
					if (!iframe.contentWindow) iframe = null;
				}
				try {
					const nativeWindow = iframe ? iframe.contentWindow : window;

					const Function_toString = nativeWindow.Function.prototype.toString;
					const Object_getOwnPropertyDescriptor = nativeWindow.Object.getOwnPropertyDescriptor;
					const Object_getOwnPropertyDescriptors = nativeWindow.Object.getOwnPropertyDescriptors;
					const Object_getPrototypeOf = nativeWindow.Object.getPrototypeOf;
					const Object_defineProperty = nativeWindow.Object.defineProperty;
					const Object_getOwnPropertyDescriptorOriginal = nativeWindow.Object.getOwnPropertyDescriptor;
					const Object_create = nativeWindow.Object.create;
					const Object_keys = nativeWindow.Object.keys;
					const Object_getOwnPropertyNames = nativeWindow.Object.getOwnPropertyNames;
					const Object_entries = nativeWindow.Object.entries;
					const Object_setPrototypeOf = nativeWindow.Object.setPrototypeOf;
					const Object_assign = nativeWindow.Object.assign;
					const Window_setTimeout = nativeWindow.setTimeout;
					const Math_random = nativeWindow.Math.random;
					const Math_floor = nativeWindow.Math.floor;
					const Math_max = nativeWindow.Math.max;
					const Math_min = nativeWindow.Math.min;
					const Window_Event = nativeWindow.Event;
					const Promise_resolve = nativeWindow.Promise.resolve.bind(nativeWindow.Promise);
					const Window_Blob = nativeWindow.Blob;
					const Window_Proxy = nativeWindow.Proxy;
					const Reflect_get = nativeWindow.Reflect.get;
					const Reflect_set = nativeWindow.Reflect.set;
					const Reflect_apply = nativeWindow.Reflect.apply;
					const Reflect_construct = nativeWindow.Reflect.construct;
					const Reflect_defineProperty = nativeWindow.Reflect.defineProperty;
					const Reflect_deleteProperty = nativeWindow.Reflect.deleteProperty;
					const Reflect_getOwnPropertyDescriptor = nativeWindow.Reflect.getOwnPropertyDescriptor;
					const Reflect_getPrototypeOf = nativeWindow.Reflect.getPrototypeOf;
					const Reflect_has = nativeWindow.Reflect.has;
					const Reflect_isExtensible = nativeWindow.Reflect.isExtensible;
					const Reflect_ownKeys = nativeWindow.Reflect.ownKeys;
					const Reflect_preventExtensions = nativeWindow.Reflect.preventExtensions;
					const Reflect_setPrototypeOf = nativeWindow.Reflect.setPrototypeOf;
					const Intl_DateTimeFormat = nativeWindow.Intl.DateTimeFormat;
					const Date_constructor = nativeWindow.Date;

					const nativeFunctionSources = new Page_WeakMap();
					const makeNativeString = (name) => "function " + (name || "") + "() { [native code] }";
					const registerNativeSource = (fn, source) => {
						if (typeof fn === "function") Reflect_apply(Page_WeakMap_set, nativeFunctionSources, [fn, source]);
						return fn;
					};
					const patchToString = (fn, name) => registerNativeSource(fn, makeNativeString(name));
					if (${STEALTH_PATCH_SCRIPTS.length > 0 ? "true" : "false"}) {
						const functionToStringProxy = new Page_Proxy(Page_Function_toString, {
							apply(target, thisArg, args) {
								const source = Reflect_apply(Page_WeakMap_get, nativeFunctionSources, [thisArg]);
								if (source) return source;
								return Reflect_apply(target, thisArg, args || []);
							},
							get(target, key, receiver) {
								return Reflect_get(target, key, receiver);
							},
						});
						registerNativeSource(functionToStringProxy, makeNativeString("toString"));
						Object_defineProperty(Function.prototype, "toString", {
							...(Page_FunctionToStringDescriptor || {
								writable: true,
								configurable: true,
								enumerable: false,
							}),
							value: functionToStringProxy,
						});
					}

					${joint}
				} finally {
					if (iframe && iframe.parentNode) iframe.parentNode.removeChild(iframe);
				}})();`;
}
async function injectStealthScripts(page) {
    await page.evaluateOnNewDocument(buildStealthInjectionScript());
}
/** Apply stealth patches + UA override to a headless page. Idempotent within a tab. */
export async function applyStealthPatches(browser, page, state) {
    patchSourceUrl(page);
    if (!state.override) {
        state.override = await resolveUserAgentOverride(page);
    }
    const client = resolvePageClient(page);
    if (client) {
        await sendUserAgentOverride(client, state.override);
    }
    const targetState = { browserSession: state.browserSession, override: state.override };
    await configureUserAgentTargets(browser, targetState);
    state.browserSession = targetState.browserSession;
    await injectStealthScripts(page);
}
/** Configure UA override on the browser + auto-attach to new targets. */
async function configureUserAgentTargets(browser, state, targetTimeoutMs = USER_AGENT_TARGET_TIMEOUT_MS) {
    if (!state.browserSession) {
        state.browserSession = await browser.target().createCDPSession();
        await state.browserSession.send("Target.setAutoAttach", {
            autoAttach: true,
            waitForDebuggerOnStart: false,
            flatten: true,
        });
        state.browserSession.on("Target.attachedToTarget", async (event) => {
            if (!targetInfoSupportsUserAgentOverride(event.targetInfo))
                return;
            const connection = state.browserSession?.connection();
            const session = connection?.session(event.sessionId);
            if (!session)
                return;
            await withSoftTimeout(sendUserAgentOverride(wrapSession(session), state.override), targetTimeoutMs, "new target user-agent override");
        });
    }
    const targets = browser.targets().filter(targetSupportsUserAgentOverride);
    await Promise.all(targets.map(async (target) => {
        await withSoftTimeout(applyTargetUserAgentOverride(target, state.override), targetTimeoutMs, "target user-agent override");
    }));
}
export { systemChromiumCandidates, isChromiumExecutable };
