/**
 * Upgrade and uninstall planning/application. Executable commands run through
 * an injected CommandRunner — in the dsh deployment that is an adapter over
 * `ctx.subprocess`; tests inject a fake. package.json is backed up before any
 * mutation and restored when the command fails.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { parseGithubSpec, sourceOf } from "./profile.js";
import { compareSemver, parseSemver } from "./semver.js";
export function shellQuote(s) {
    return `'${s.replace(/'/g, `'\\''`)}'`;
}
function npmSpecifier(original, latest) {
    const s = original.trim();
    if (s.startsWith("~"))
        return `~${latest}`;
    if (s.startsWith("^"))
        return `^${latest}`;
    return latest;
}
export async function planUpgrade(profile, name, registry, installed, installedCommit) {
    const currentSpecifier = profile.dependencies[name];
    if (!currentSpecifier) {
        return { name, source: "unknown", installedVersion: null, installedCommit: null, currentSpecifier: "(no dependency)", targetLabel: "-", targetCommit: null, newSpecifier: "", command: "", wouldChange: false, error: `${name} is not a dependency of this profile` };
    }
    const source = sourceOf(currentSpecifier);
    const profileDir = profile.dir;
    const settings = { name, installedVersion: installed?.version ?? null, installedCommit, currentSpecifier, targetLabel: "", targetCommit: null, newSpecifier: "", command: "", wouldChange: false };
    if (source === "git") {
        const gh = parseGithubSpec(currentSpecifier);
        if (!gh) {
            return { ...settings, source, targetLabel: "-", error: `unsupported git specifier ${JSON.stringify(currentSpecifier)}` };
        }
        const info = await registry.latestGit(gh.user, gh.repo);
        if (info.error) {
            return { ...settings, source, targetLabel: "-", error: `cannot reach ${gh.user}/${gh.repo}: ${info.error}` };
        }
        const ref = info.latestTag ?? info.headSha;
        if (!ref) {
            return { ...settings, source, targetLabel: "no refs", error: "remote has no tags and no HEAD" };
        }
        const spec = `github:${gh.user}/${gh.repo}#${ref}`;
        const targetLabel = info.latestTag ?? `HEAD ${info.headSha?.slice(0, 7)}`;
        const wouldChange = installedCommit === null || (info.latestTagCommit ?? info.headSha) !== installedCommit;
        return {
            ...settings,
            source,
            targetLabel,
            targetCommit: info.latestTagCommit ?? info.headSha,
            newSpecifier: spec,
            command: `cd ${shellQuote(profileDir)} && pnpm add ${name}@${spec}`,
            wouldChange,
        };
    }
    if (source === "local") {
        return { ...settings, source, targetLabel: "-", error: "local (file:/link:) dependencies are not upgradeable" };
    }
    // npm registry
    const info = await registry.latestNpm(name);
    if (info.error || !info.latest) {
        return { ...settings, source: "npm", targetLabel: "-", error: info.error ?? `${name}: no version found on the registry` };
    }
    const installedVersion = installed?.version ?? null;
    let wouldChange = true;
    if (installedVersion) {
        const a = parseSemver(installedVersion);
        const b = parseSemver(info.latest);
        wouldChange = !a || !b || compareSemver(b, a) > 0;
    }
    return {
        ...settings,
        source: "npm",
        targetLabel: info.latest,
        newSpecifier: npmSpecifier(currentSpecifier, info.latest),
        command: `cd ${shellQuote(profileDir)} && pnpm add ${name}@${info.latest}`,
        wouldChange,
    };
}
/** Apply the upgrade: backup → patch package.json → run pnpm install (restore on failure). */
export async function applyUpgrade(profileDir, plan, runner) {
    if (plan.error)
        throw new Error(plan.error);
    if (!plan.newSpecifier)
        throw new Error(`${plan.name}: no new specifier to apply`);
    const pkgPath = path.join(profileDir, "package.json");
    const original = await fs.readFile(pkgPath, "utf8");
    const data = JSON.parse(original);
    if (!data.dependencies || !(plan.name in data.dependencies)) {
        throw new Error(`${plan.name} is not a dependency of this profile`);
    }
    const backupPath = `${pkgPath}.dshbak-${Date.now()}`;
    await fs.writeFile(backupPath, original);
    data.dependencies[plan.name] = plan.newSpecifier;
    await fs.writeFile(pkgPath, `${JSON.stringify(data, null, 2)}\n`);
    const { code, output } = await runner(["pnpm", "install"], { cwd: profileDir, timeoutMs: 600_000 });
    if (code !== 0) {
        await fs.writeFile(pkgPath, original).catch(() => undefined);
        throw new Error(`pnpm install exited ${code}: ${output.trim().split("\n").slice(-8).join("\n")}`);
    }
    return { backupPath, output };
}
/** Plan the removal of a package from the profile (deps and/or bundles). */
export function planUninstall(profile, name) {
    const inDependencies = name in profile.dependencies;
    const inBundles = Array.isArray(profile.bundles) && profile.bundles.includes(name);
    if (!inDependencies && !inBundles) {
        return { name, isCore: false, inDependencies, inBundles, wouldRemove: false, error: `${name} is not part of this profile` };
    }
    const core = /^@deepseek-ai\//.test(name) || /^@deepseek-harness-tui\//.test(name);
    if (core) {
        return { name, isCore: true, inDependencies, inBundles, wouldRemove: false, error: `${name} is a core dsh package and cannot be uninstalled` };
    }
    return { name, isCore: false, inDependencies, inBundles, wouldRemove: true };
}
/**
 * Apply the uninstall: pnpm remove for a dependency, then drop the entry from
 * `dsh.profile.bundles`. Backs up package.json first and restores it on
 * failure. The pnpm step rewrites package.json itself, so the bundles edit
 * happens afterwards to avoid being clobbered.
 */
export async function applyUninstall(profileDir, plan, runner) {
    if (plan.error || !plan.wouldRemove)
        throw new Error(plan.error ?? `${plan.name}: nothing to uninstall`);
    const pkgPath = path.join(profileDir, "package.json");
    const original = await fs.readFile(pkgPath, "utf8");
    const backupPath = `${pkgPath}.dshbak-${Date.now()}`;
    await fs.writeFile(backupPath, original);
    const output = [];
    try {
        if (plan.inDependencies) {
            const { code, output: out } = await runner(["pnpm", "remove", plan.name], { cwd: profileDir, timeoutMs: 600_000 });
            output.push(out);
            if (code !== 0)
                throw new Error(`pnpm remove exited ${code}: ${out.trim().split("\n").slice(-8).join("\n")}`);
        }
        const data = JSON.parse(await fs.readFile(pkgPath, "utf8"));
        const bundles = data.dsh?.profile?.bundles;
        if (Array.isArray(bundles)) {
            const next = bundles.filter((b) => b !== plan.name);
            if (next.length !== bundles.length) {
                data.dsh = {
                    ...(data.dsh ?? {}),
                    profile: { ...(data.dsh?.profile ?? {}), bundles: next },
                };
                await fs.writeFile(pkgPath, `${JSON.stringify(data, null, 2)}\n`);
            }
        }
        return { backupPath, output: output.join("\n") };
    }
    catch (error) {
        await fs.writeFile(pkgPath, original).catch(() => undefined);
        throw error;
    }
}
