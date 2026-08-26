/**
 * Per-session staging of previewed rewrites. A preview registers a staged
 * entry; `apply` replays the same rewrite against live file contents, verifies
 * it against the staged counts, then writes. Entries expire after TTL and the
 * registry is size-capped (oldest evicted first).
 */
import { randomUUID } from "node:crypto";
const TTL_MS = 10 * 60_000;
const MAX_ENTRIES = 50;
export class StagingRegistry {
    entries = new Map();
    create(input) {
        this.prune();
        const entry = {
            ...input,
            id: randomUUID().replaceAll("-", "").slice(0, 12),
            createdAt: Date.now(),
        };
        this.entries.set(entry.id, entry);
        return entry;
    }
    get(id, sessionId) {
        this.prune();
        const entry = this.entries.get(id);
        if (!entry || entry.sessionId !== sessionId)
            return undefined;
        return entry;
    }
    drop(id) {
        return this.entries.delete(id);
    }
    /** Remove expired entries and evict the oldest beyond the cap. */
    prune() {
        const now = Date.now();
        for (const [id, entry] of this.entries) {
            if (now - entry.createdAt > TTL_MS)
                this.entries.delete(id);
        }
        while (this.entries.size > MAX_ENTRIES) {
            let oldest;
            for (const [id, entry] of this.entries) {
                if (!oldest || entry.createdAt < oldest.createdAt)
                    oldest = { id, createdAt: entry.createdAt };
            }
            if (!oldest)
                break;
            this.entries.delete(oldest.id);
        }
    }
}
export const staging = new StagingRegistry();
