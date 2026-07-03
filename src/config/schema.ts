import { z } from "zod";
import { StorageBackendIdSchema } from "../core/storage/interface";

// Distinct from log-entry.ts's TranscriptionEngineSchema ("webspeech" |
// "whisper-1"), which tags which engine actually produced a given
// transcript. This one is the user's *choice* of engine in Settings — kept
// separate so "whisper-1" (an OpenAI model id) never leaks into UI code
// that only needs to know "webspeech vs whisper".
export const TranscriptionEngineChoiceSchema = z.enum(["webspeech", "whisper"]);
export type TranscriptionEngineChoice = z.infer<typeof TranscriptionEngineChoiceSchema>;

/**
 * ============================================================================
 * APP CONFIG SCHEMA — LOCAL ONLY
 * ============================================================================
 *
 * This is the one schema in the app that must NEVER be written through a
 * StorageAdapter. It lives in IndexedDB (core/storage local persistence,
 * task #6) exclusively. It holds credentials; the moment any field here ends
 * up in a file synced to the user's Drive/R2/Oracle bucket, BYOK is broken.
 *
 * Phase 1 default: transcription.engine = "webspeech" (free, zero setup).
 * Whisper is opt-in — flips the dev guide's stated default, see the roadmap
 * discussion: requiring an OpenAI key before first use is too high a bar
 * for a beta fisherman's first ten minutes with the app.
 */

export const CloudflareR2ConfigSchema = z.object({
  endpoint: z.string().url(),
  bucket: z.string(),
  accessKeyId: z.string(),
  secretAccessKey: z.string(),
});
export type CloudflareR2Config = z.infer<typeof CloudflareR2ConfigSchema>;

export const OracleOciConfigSchema = z.object({
  endpoint: z.string().url(),
  bucket: z.string(),
  accessKeyId: z.string(),
  secretAccessKey: z.string(),
});
export type OracleOciConfig = z.infer<typeof OracleOciConfigSchema>;

export const GoogleDriveConfigSchema = z.object({
  connected: z.boolean(),
  accessToken: z.string().nullable(), // short-lived, memory-preferred; persisted here only for PWA reload continuity
  refreshToken: z.string().nullable(),
  folderId: z.string().nullable(),
  tokenExpiresAt: z.number().int().nullable(), // epoch ms; absent/null means "no persisted token"
});
export type GoogleDriveConfig = z.infer<typeof GoogleDriveConfigSchema>;

export const AppConfigSchema = z.object({
  version: z.string(),

  storage: z.object({
    activeBackend: StorageBackendIdSchema.nullable(),
    googleDrive: GoogleDriveConfigSchema.partial().optional(),
    cloudflareR2: CloudflareR2ConfigSchema.partial().optional(),
    oracleOci: OracleOciConfigSchema.partial().optional(),
  }),

  transcription: z.object({
    engine: TranscriptionEngineChoiceSchema.default("webspeech"),
    whisperApiKey: z.string().optional(),
    language: z.string().default("en"),
  }),

  recording: z.object({
    maxDurationMs: z.number().int().positive().default(300_000),
    autoStopSilenceMs: z.number().int().nonnegative().default(3_000),
    shakeToRecord: z.boolean().default(false),
  }),

  ui: z.object({
    darkMode: z.boolean().default(true),
    relativeTimestamps: z.boolean().default(true),
  }),
});
export type AppConfig = z.infer<typeof AppConfigSchema>;

export function defaultAppConfig(): AppConfig {
  return {
    version: "1.0",
    storage: { activeBackend: null },
    transcription: { engine: "webspeech", language: "en" },
    recording: { maxDurationMs: 300_000, autoStopSilenceMs: 3_000, shakeToRecord: false },
    ui: { darkMode: true, relativeTimestamps: true },
  };
}
