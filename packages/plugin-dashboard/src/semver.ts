/** Minimal semver parsing/comparison and git-tag version extraction. */

export interface SemVer {
	major: number;
	minor: number;
	patch: number;
	/** Prerelease identifiers as written per semver spec 2.0.0; null = release version. */
	prerelease: string | null;
}

export function parseSemver(input: string): SemVer | null {
	const m = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(input.trim());
	if (!m) return null;
	return {
		major: Number(m[1]),
		minor: Number(m[2]),
		patch: Number(m[3]),
		prerelease: m[4] ? m[4] : null,
	};
}

/** Numeric comparison with prerelease precedence: release > any prerelease. */
export function compareSemver(a: SemVer, b: SemVer): -1 | 0 | 1 {
	if (a.major !== b.major) return a.major < b.major ? -1 : 1;
	if (a.minor !== b.minor) return a.minor < b.minor ? -1 : 1;
	if (a.patch !== b.patch) return a.patch < b.patch ? -1 : 1;
	if (a.prerelease === null && b.prerelease === null) return 0;
	if (a.prerelease === null) return 1; // release > prerelease
	if (b.prerelease === null) return -1;
	// both prerelease: compare dot-separated identifiers
	const aIds = a.prerelease.split(".");
	const bIds = b.prerelease.split(".");
	const max = Math.max(aIds.length, bIds.length);
	for (let i = 0; i < max; i++) {
		const ai = aIds[i];
		const bi = bIds[i];
		if (ai === undefined) return -1;
		if (bi === undefined) return 1;
		const aNum = /^\d+$/.test(ai);
		const bNum = /^\d+$/.test(bi);
		if (aNum && bNum) {
			const an = Number(ai);
			const bn = Number(bi);
			if (an !== bn) return an < bn ? -1 : 1;
		} else if (aNum !== bNum) {
			return aNum ? -1 : 1; // numeric identifiers have lower precedence
		} else {
			if (ai !== bi) return ai < bi ? -1 : 1;
		}
	}
	return 0;
}

export function formatSemver(v: SemVer): string {
	const base = `${v.major}.${v.minor}.${v.patch}`;
	return v.prerelease === null ? base : `${base}-${v.prerelease}`;
}

/** Parse a git tag like `v1.2.3` / `1.2.3-rc.1`; non-semver tags return null. */
export function extractTagVersion(tag: string): SemVer | null {
	const cleaned = tag.replace(/^v/, "");
	return parseSemver(cleaned);
}