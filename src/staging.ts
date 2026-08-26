/**
 * Per-session staging of previewed rewrites. A preview registers a staged
 * entry; `apply` replays the same rewrite against live file contents, verifies
 * it against the staged counts, then writes. Entries expire after TTL and the
 * registry is size-capped (oldest evicted first).
 */
import { randomUUID } from "node:crypto";
import type { ResolvedOp } from "./engine.js";

export interface StagedRewrite {
	id: string;
	sessionId: string;
	ops: ResolvedOp[];
	paths: string[];
	createdAt: number;
	totalReplacements: number;
	filesTouched: string[];
	perFileCount: Record<string, number>;
	/** Absolute resolved file list the preview operated on. */
	files: string[];
}

const TTL_MS = 10 * 60_000;
const MAX_ENTRIES = 50;

export class StagingRegistry {
	private entries = new Map<string, StagedRewrite>();

	create(input: Omit<StagedRewrite, "id" | "createdAt">): StagedRewrite {
		this.prune();
		const entry: StagedRewrite = {
			...input,
			id: randomUUID().replaceAll("-", "").slice(0, 12),
			createdAt: Date.now(),
		};
		this.entries.set(entry.id, entry);
		return entry;
	}

	get(id: string, sessionId: string): StagedRewrite | undefined {
		this.prune();
		const entry = this.entries.get(id);
		if (!entry || entry.sessionId !== sessionId) return undefined;
		return entry;
	}

	drop(id: string): boolean {
		return this.entries.delete(id);
	}

	/** Remove expired entries and evict the oldest beyond the cap. */
	prune(): void {
		const now = Date.now();
		for (const [id, entry] of this.entries) {
			if (now - entry.createdAt > TTL_MS) this.entries.delete(id);
		}
		while (this.entries.size > MAX_ENTRIES) {
			let oldest: { id: string; createdAt: number } | undefined;
			for (const [id, entry] of this.entries) {
				if (!oldest || entry.createdAt < oldest.createdAt) oldest = { id, createdAt: entry.createdAt };
			}
			if (!oldest) break;
			this.entries.delete(oldest.id);
		}
	}
}

export const staging = new StagingRegistry();