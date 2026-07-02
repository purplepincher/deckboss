import { newId } from "../../utils/id";
import { nowIso } from "../../utils/date";
import { mimeToExt, readAudioDurationMs } from "../../utils/file";
import { extractEntities } from "../../services/entity-extractor";
import {
  newEntrySkeleton,
  type LogEntry,
  type GPSReading,
  type TranscriptResult,
  type EffectiveLogEntry,
  type Correction,
  type EditableFields,
} from "../types/log-entry";

interface BuildEntryParams {
  audioBlob: Blob | null;
  timestamp?: string; // defaults to now — capture time, not transcription-return time
  gps: GPSReading | null;
  transcript?: TranscriptResult;
  source?: LogEntry["source"];
  threadId?: string;
}

/**
 * The only place a LogEntry gets constructed. GPS or transcript being
 * unavailable never blocks this — a null gps and a null transcript are both
 * valid entries (dev guide §7.1/§7.6: "never block the recording pipeline").
 */
export async function buildEntry(params: BuildEntryParams): Promise<LogEntry> {
  const id = newId();
  const timestamp = params.timestamp ?? nowIso();

  const audio = params.audioBlob ? await buildAudioMeta(params.audioBlob, id) : null;

  const entry = newEntrySkeleton({
    id,
    timestamp,
    gps: params.gps,
    audio,
    source: params.source ?? "voice",
    threadId: params.threadId,
  });

  if (params.transcript) {
    entry.transcript = params.transcript;
    entry.entities = extractEntities(params.transcript.text);
  }

  return entry;
}

async function buildAudioMeta(blob: Blob, id: string) {
  const ext = mimeToExt(blob.type);
  const duration_ms = await readAudioDurationMs(blob).catch(() => 0);
  return {
    filename: `${id}_audio.${ext}`,
    duration_ms,
    format: blob.type || "application/octet-stream",
    size_bytes: blob.size,
  };
}

export function buildAmendCorrection(fields: EditableFields, reason?: string): Correction {
  return {
    id: newId(),
    created_at: nowIso(),
    type: "amend",
    reason,
    fields,
  };
}

export function buildRetractCorrection(reason?: string): Correction {
  return {
    id: newId(),
    created_at: nowIso(),
    type: "retract",
    reason,
  };
}

/**
 * Folds `corrections` over the base entry to produce what the UI actually
 * shows. Applied in array order so later corrections win field-by-field; a
 * `retract` at any point sets `retracted = true` for the rest of the fold
 * (a later amend can't resurrect a retracted entry — undo a retract with
 * another correction type if that's ever needed, don't just stop emitting
 * retracts).
 */
export function applyCorrections(entry: LogEntry): EffectiveLogEntry {
  const { corrections, ...base } = entry;

  let retracted = false;
  let amended = false;
  let lastCorrectionReason: string | null = null;
  let transcript = base.transcript;
  let entities = base.entities;
  let tags = base.tags;

  for (const c of corrections) {
    lastCorrectionReason = c.reason ?? lastCorrectionReason;
    if (c.type === "retract") {
      retracted = true;
      continue;
    }
    amended = true;
    if (c.fields?.transcript) transcript = c.fields.transcript;
    if (c.fields?.entities) entities = c.fields.entities;
    if (c.fields?.tags) tags = c.fields.tags;
  }

  return { ...base, transcript, entities, tags, retracted, amended, lastCorrectionReason };
}
