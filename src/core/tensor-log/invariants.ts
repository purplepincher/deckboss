import type { LogEntry } from "../types/log-entry";

export class InvariantViolationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvariantViolationError";
  }
}

const IMMUTABLE_FIELDS = [
  "id",
  "timestamp",
  "gps",
  "audio",
  "source",
  "thread_id",
  "version",
  "transcript",
  "entities",
  "tags",
] as const satisfies readonly (keyof LogEntry)[];

/**
 * Enforces the one rule this product's trustworthiness rests on: a
 * committed entry is never mutated, only appended to. Called from
 * local-db.ts's putEntry() on every write, regardless of which code path
 * produced the new value — a UI amend/retract, or sync-engine pulling and
 * merging a remote copy (conflict-resolver.ts's mergeEntries() always
 * produces a superset of what was already stored, so it naturally passes
 * this check; it exists to catch anything that doesn't).
 *
 * `previous` is what's currently stored for this id (undefined for a
 * brand-new entry — nothing to protect yet). `next` is about to be
 * written. Throws InvariantViolationError rather than returning a bool:
 * a rejected write here is a bug, not an expected outcome a caller should
 * silently branch on.
 */
export function assertWriteIsAdditive(previous: LogEntry | undefined, next: LogEntry): void {
  if (!previous) return;

  for (const field of IMMUTABLE_FIELDS) {
    if (JSON.stringify(previous[field]) !== JSON.stringify(next[field])) {
      throw new InvariantViolationError(
        `Write rejected: "${field}" is a capture-time fact and cannot change after creation (entry ${next.id}).`,
      );
    }
  }

  const previousById = new Map(previous.corrections.map((c) => [c.id, c]));
  for (const [id, correction] of previousById) {
    const match = next.corrections.find((c) => c.id === id);
    if (!match) {
      throw new InvariantViolationError(
        `Write rejected: correction ${id} was removed from entry ${next.id} — corrections are append-only.`,
      );
    }
    if (JSON.stringify(match) !== JSON.stringify(correction)) {
      throw new InvariantViolationError(
        `Write rejected: correction ${id} on entry ${next.id} was modified — corrections are immutable once committed.`,
      );
    }
  }
}
