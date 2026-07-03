import { z } from "zod";
import { isoDateString, uuidV4 } from "../types/common";

/**
 * ============================================================================
 * SYNC QUEUE SCHEMA
 * ============================================================================
 *
 * Every operation that touches the network goes through this queue — the
 * app never calls a StorageAdapter method directly from UI code. That's what
 * makes offline-first free: recording, editing, and browsing all just write
 * to IndexedDB and enqueue a job; queue.ts drains it whenever
 * useOfflineStatus reports we're connected.
 */

export const SyncJobTypeSchema = z.enum([
  "upload_entry", // write one LogEntry's .md file
  "upload_audio", // write one entry's audio blob
  "delete_entry", // propagate a retract (still additive on disk — see log-entry.ts)
  "whisper_retry", // retry a Whisper transcription once the device is back online
  "download_manifest",
  "download_file",
]);
export type SyncJobType = z.infer<typeof SyncJobTypeSchema>;

// Payload shapes per job type — keeps queue.ts's processor exhaustively
// typed instead of casting `any` at the point of use.
export const SyncJobPayloadSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("upload_entry"), entryId: uuidV4 }),
  z.object({ type: z.literal("upload_audio"), entryId: uuidV4, audioPath: z.string() }),
  z.object({ type: z.literal("delete_entry"), entryId: uuidV4 }),
  z.object({ type: z.literal("whisper_retry"), entryId: uuidV4, language: z.string() }),
  z.object({ type: z.literal("download_manifest") }),
  z.object({ type: z.literal("download_file"), path: z.string() }),
]);
export type SyncJobPayload = z.infer<typeof SyncJobPayloadSchema>;

export const SyncJobSchema = z.object({
  id: uuidV4,
  type: SyncJobTypeSchema,
  payload: SyncJobPayloadSchema,
  priority: z.number().int().min(0).max(1), // 0 = user-initiated, 1 = background
  retries: z.number().int().nonnegative(),
  maxRetries: z.number().int().positive(),
  createdAt: isoDateString,
  lastAttempt: isoDateString.nullable(),
  error: z.string().nullable(),
});
export type SyncJob = z.infer<typeof SyncJobSchema>;

export const SyncStatusSchema = z.enum(["online", "offline", "syncing", "error"]);
export type SyncStatus = z.infer<typeof SyncStatusSchema>;
