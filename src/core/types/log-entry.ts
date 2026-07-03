import { z } from "zod";
import { isoDateString, uuidV4, SCHEMA_VERSION } from "./common";

/**
 * ============================================================================
 * THE TENSOR LOG SCHEMA
 * ============================================================================
 *
 * One LogEntry = one voice note = one Markdown file on disk. This file is the
 * single source of truth for what a "log entry" is; entry-builder,
 * entry-serializer, entry-parser, query-engine, and every StorageAdapter all
 * read/write this shape and nothing else. If a field needs to change, it
 * changes here first.
 *
 * DIVERGENCE FROM THE PHASE 1 DEV GUIDE, DELIBERATE:
 * The guide's §9.3 UI has direct [Edit] [Delete] buttons that imply mutating
 * or removing the file in place, with last-write-wins conflict resolution.
 * That contradicts a principle already written into this project's
 * foundation docs (activelog-spec: "No editing. Ever. Corrections are
 * events, history is never rewritten — vital for training data provenance
 * and trust") — and more concretely, last-write-wins silently drops data
 * whenever two devices edit the same entry before syncing.
 *
 * So: `retracted` and `corrections` are additive. "Delete" sets
 * retracted=true instead of removing the file. "Edit" appends a Correction
 * instead of overwriting a field. The *effective* entry (what the UI shows)
 * is computed at read time by applyCorrections() in entry-builder.ts — the
 * on-disk record never loses information. This costs two extra fields and
 * one read-time fold; it buys back conflict-free offline sync (see
 * conflict-resolver.ts — two devices' corrections just union, they never
 * conflict) and a write-path invariant that's cheap to enforce mechanically
 * (see invariants.ts) rather than something every future contributor has
 * to remember to preserve by convention.
 *
 * This is NOT justified by, or a claim toward, regulatory/compliance
 * evidentiary value — see the README's disclaimer. That would be a real
 * feature with real requirements (chain of custody, legal review, retention
 * policy) that nobody has decided to pursue. The design earns its keep on
 * sync-safety grounds alone.
 */

export const GPSSourceSchema = z.enum(["gps", "network", "unknown"]);

export const GPSReadingSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  accuracy: z.number().nonnegative(), // meters
  altitude: z.number().nullable(),
  heading: z.number().min(0).max(360).nullable(),
  speed: z.number().nonnegative().nullable(), // m/s
  timestamp: isoDateString,
  source: GPSSourceSchema,
});
export type GPSReading = z.infer<typeof GPSReadingSchema>;

export const AudioFormatSchema = z.enum([
  "audio/webm;codecs=opus",
  "audio/mp4",
  "audio/ogg;codecs=opus",
]);

export const AudioMetaSchema = z.object({
  filename: z.string(),
  duration_ms: z.number().nonnegative(),
  format: z.string(), // free-form; AudioFormatSchema lists the ones we prefer
  size_bytes: z.number().nonnegative(),
});
export type AudioMeta = z.infer<typeof AudioMetaSchema>;

export const TranscriptionEngineSchema = z.enum(["webspeech", "whisper-1"]);

export const TranscriptResultSchema = z.object({
  text: z.string(),
  confidence: z.number().min(0).max(1),
  language: z.string(),
  engine: TranscriptionEngineSchema,
});
export type TranscriptResult = z.infer<typeof TranscriptResultSchema>;

// Broader than the dev guide's four examples — entity-extractor (task #9)
// needs species/weather/person/measurement too, and Phase 3's ML pipeline
// will want a stable closed vocabulary of entity *types* even as the values
// themselves stay free text.
export const EntityTypeSchema = z.enum([
  "gear",
  "quantity",
  "location_relative",
  "depth",
  "species",
  "weather",
  "person",
  "measurement",
  "other",
]);
export type EntityType = z.infer<typeof EntityTypeSchema>;

export const EntitySchema = z.object({
  type: EntityTypeSchema,
  value: z.string(),
  confidence: z.number().min(0).max(1),
});
export type Entity = z.infer<typeof EntitySchema>;

export const EntrySourceSchema = z.enum(["voice", "text", "import"]);
export type EntrySource = z.infer<typeof EntrySourceSchema>;

/**
 * A Correction is the only way an entry changes after creation. `amend`
 * carries a partial overlay of editable fields (never id/timestamp/audio —
 * the capture facts are permanent); `retract` carries just a reason.
 * Corrections are applied in array order at read time.
 */
export const EditableFieldsSchema = z
  .object({
    transcript: TranscriptResultSchema,
    entities: z.array(EntitySchema),
    tags: z.array(z.string()),
  })
  .partial();
export type EditableFields = z.infer<typeof EditableFieldsSchema>;

export const CorrectionAuthorSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("human") }),
  z.object({ kind: z.literal("model"), engine: TranscriptionEngineSchema }),
]);
export type CorrectionAuthor = z.infer<typeof CorrectionAuthorSchema>;

export const CorrectionSchema = z.object({
  id: uuidV4,
  created_at: isoDateString,
  type: z.enum(["amend", "retract"]),
  // Optional, not required: a correction written before this field existed
  // has no `author` on disk. Since this app has no backend and no way to
  // know whether a given local IndexedDB already holds real corrections
  // from before this change, `author` must stay optional forever (or until
  // a version-gated migration is worth writing) — a required field here
  // would mean any pre-existing author-less correction fails
  // LogEntrySchema.parse() on the next write to that entry, silently
  // bricking amend/retract for it. Absent means "assume human" wherever
  // this gets consumed (matches buildAmendCorrection/buildRetractCorrection's
  // own default for new corrections).
  author: CorrectionAuthorSchema.optional(),
  // Optional, not required: a correction written before this field existed
  // has no `deviceId` on disk. New corrections are stamped at creation time;
  // absent means "created before device metadata was recorded."
  deviceId: z.string().uuid().optional(),
  reason: z.string().optional(),
  fields: EditableFieldsSchema.optional(), // present for "amend", absent for "retract"
});
export type Correction = z.infer<typeof CorrectionSchema>;

/**
 * LogEntry — the on-disk record (frontmatter fields + body text). This is
 * exactly what entry-serializer.ts writes and entry-parser.ts reads back.
 *
 * The shape is declared separately from the schema so `LogEntry` (the type
 * every module codes against) stays a plain, fully-typed object — no index
 * signature. `.passthrough()` is applied only to the *schema* used for
 * parsing, so a future version's unknown fields still survive a round-trip
 * through an older client at runtime (mirrors activelog-spec's
 * forward-compatibility rule) without infecting the TS type: a passthrough
 * schema's inferred type carries `[x: string]: unknown`, which silently
 * collapses `Omit<LogEntry, "corrections">` (used below for
 * EffectiveLogEntry) down to `{ [x: string]: unknown }` — every field
 * quietly becomes `unknown` project-wide. Keeping the shape and the
 * passthrough separate avoids that trap entirely.
 */
const logEntryShape = {
  id: uuidV4,
  timestamp: isoDateString, // capture time — the primary key
  gps: GPSReadingSchema.nullable(),
  audio: AudioMetaSchema.nullable(),
  transcript: TranscriptResultSchema.nullable(),
  entities: z.array(EntitySchema),
  tags: z.array(z.string()),
  source: EntrySourceSchema,
  thread_id: uuidV4, // defaults to id; links related entries (Phase 2 AI replies)
  version: z.string(),
  corrections: z.array(CorrectionSchema),
};

export const LogEntrySchema = z.object(logEntryShape).passthrough();
export type LogEntry = z.infer<z.ZodObject<typeof logEntryShape>>;

/**
 * EffectiveLogEntry — the *computed* view after folding `corrections` over
 * `LogEntry`. This is what every UI screen and the query-engine actually
 * read. It is never itself persisted.
 */
export type EffectiveLogEntry = Omit<LogEntry, "corrections"> & {
  retracted: boolean;
  amended: boolean;
  lastCorrectionReason: string | null;
  pendingTranscript?: "whisper_retry" | null;
};

export function newEntrySkeleton(params: {
  id: string;
  timestamp: string;
  gps: GPSReading | null;
  audio: AudioMeta | null;
  source: LogEntry["source"];
  threadId?: string;
}): LogEntry {
  return {
    id: params.id,
    timestamp: params.timestamp,
    gps: params.gps,
    audio: params.audio,
    transcript: null,
    entities: [],
    tags: [],
    source: params.source,
    thread_id: params.threadId ?? params.id,
    version: SCHEMA_VERSION,
    corrections: [],
  };
}
