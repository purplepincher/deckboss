import { describe, it, expect } from "vitest";
import { getDiscardableEntry, formatDuration } from "../../src/ui/screens/discard-eligibility";
import { newEntrySkeleton } from "../../src/core/types/log-entry";
import { applyCorrections, buildRetractCorrection } from "../../src/core/tensor-log/entry-builder";
import type { AudioMeta, EffectiveLogEntry, EntrySource } from "../../src/core/types/log-entry";

const DEVICE_ID = crypto.randomUUID();
const NOW = new Date("2026-07-03T12:00:00Z").getTime();

function voiceEntry(opts: {
  ageMs?: number;
  source?: EntrySource;
  retracted?: boolean;
  durationMs?: number;
  id?: string;
} = {}): EffectiveLogEntry {
  const ageMs = opts.ageMs ?? 5_000;
  const ts = new Date(NOW - ageMs).toISOString();
  const audio: AudioMeta | null =
    opts.durationMs === undefined
      ? null
      : {
          filename: "x.webm",
          duration_ms: opts.durationMs,
          format: "audio/webm;codecs=opus",
          size_bytes: 1000,
        };
  const raw = newEntrySkeleton({
    id: opts.id ?? crypto.randomUUID(),
    timestamp: ts,
    gps: null,
    audio,
    source: opts.source ?? "voice",
  });
  if (opts.retracted) {
    raw.corrections.push(buildRetractCorrection(DEVICE_ID, "test"));
  }
  return applyCorrections(raw);
}

describe("getDiscardableEntry", () => {
  it("returns the newest entry when it is a fresh voice capture", () => {
    const entry = voiceEntry({ ageMs: 3_000, id: "just-saved" });
    expect(getDiscardableEntry([entry], NOW)?.id).toBe("just-saved");
  });

  it("returns undefined for an empty recent list", () => {
    expect(getDiscardableEntry([], NOW)).toBeUndefined();
  });

  it("rejects a non-voice newest entry (only voice saves are discardable)", () => {
    const entry = voiceEntry({ source: "text", ageMs: 2_000 });
    expect(getDiscardableEntry([entry], NOW)).toBeUndefined();
  });

  it("rejects an already-retracted newest entry", () => {
    const entry = voiceEntry({ retracted: true, ageMs: 2_000 });
    expect(getDiscardableEntry([entry], NOW)).toBeUndefined();
  });

  it("rejects an entry older than the 60s window", () => {
    const entry = voiceEntry({ ageMs: 61_000 });
    expect(getDiscardableEntry([entry], NOW)).toBeUndefined();
  });

  it("rejects an entry timestamped in the future (clock skew / bad data)", () => {
    const entry = voiceEntry({ ageMs: -10_000 });
    expect(getDiscardableEntry([entry], NOW)).toBeUndefined();
  });

  it("accepts an entry exactly at the 60s boundary", () => {
    const entry = voiceEntry({ ageMs: 60_000, id: "boundary" });
    expect(getDiscardableEntry([entry], NOW)?.id).toBe("boundary");
  });

  it("only ever considers recent[0], even when a newer-eligible voice entry sits lower", () => {
    // recent is newest-first; an older eligible entry at index 1 must not be
    // picked when the top entry is ineligible.
    const top = voiceEntry({ source: "text", ageMs: 1_000 });
    const older = voiceEntry({ ageMs: 5_000, id: "older" });
    expect(getDiscardableEntry([top, older], NOW)).toBeUndefined();
  });
});

describe("formatDuration", () => {
  it("formats m:ss with zero-padded seconds", () => {
    expect(formatDuration(0)).toBe("0:00");
    expect(formatDuration(42_000)).toBe("0:42");
    expect(formatDuration(90_000)).toBe("1:30");
    expect(formatDuration(3_725_000)).toBe("62:05");
  });
});
