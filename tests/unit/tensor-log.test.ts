import { describe, it, expect } from "vitest";
import { serializeEntry } from "../../src/core/tensor-log/entry-serializer";
import { parseEntry, EntryParseError } from "../../src/core/tensor-log/entry-parser";
import { buildEntry, applyCorrections, buildAmendCorrection, buildRetractCorrection } from "../../src/core/tensor-log/entry-builder";
import { newEntrySkeleton } from "../../src/core/types/log-entry";

function mockGps() {
  return {
    latitude: 44.6476,
    longitude: -63.5728,
    accuracy: 4.2,
    altitude: null,
    heading: null,
    speed: null,
    timestamp: new Date().toISOString(),
    source: "gps" as const,
  };
}

describe("entry-serializer <-> entry-parser round trip", () => {
  it("preserves every field through serialize -> parse", () => {
    const entry = newEntrySkeleton({
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      gps: mockGps(),
      audio: { filename: "abc_audio.webm", duration_ms: 8432, format: "audio/webm;codecs=opus", size_bytes: 124780 },
      source: "voice",
    });
    entry.transcript = { text: "Set twelve crab pots starboard rail eighty fathom", confidence: 0.94, language: "en", engine: "webspeech" };
    entry.entities = [
      { type: "gear", value: "crab pots", confidence: 0.97 },
      { type: "depth", value: "eighty fathom", confidence: 0.88 },
    ];
    entry.tags = ["haul", "setup"];

    const markdown = serializeEntry(entry);
    const parsed = parseEntry(markdown);

    expect(parsed).toEqual(entry);
  });

  it("round-trips an entry with corrections", () => {
    const entry = newEntrySkeleton({
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      gps: null,
      audio: null,
      source: "text",
    });
    entry.transcript = { text: "original text", confidence: 0.8, language: "en", engine: "webspeech" };
    entry.corrections.push(buildAmendCorrection({ tags: ["corrected"] }, "typo fix"));
    entry.corrections.push(buildRetractCorrection("wrong vessel"));

    const parsed = parseEntry(serializeEntry(entry));
    expect(parsed.corrections).toHaveLength(2);
    expect(parsed.corrections[1]?.type).toBe("retract");
  });

  it("throws EntryParseError on missing frontmatter", () => {
    expect(() => parseEntry("just some text, no frontmatter")).toThrow(EntryParseError);
  });

  it("throws EntryParseError on schema violation", () => {
    const bad = `---\nid: "not-a-uuid"\n---\n\nbody`;
    expect(() => parseEntry(bad)).toThrow(EntryParseError);
  });
});

describe("buildEntry", () => {
  it("never blocks on missing GPS or transcript", async () => {
    const entry = await buildEntry({ audioBlob: null, gps: null, source: "voice" });
    expect(entry.gps).toBeNull();
    expect(entry.transcript).toBeNull();
    expect(entry.id).toBeTruthy();
  });

  it("runs entity extraction when a transcript is provided", async () => {
    const entry = await buildEntry({
      audioBlob: null,
      gps: null,
      transcript: { text: "twelve crab pots starboard rail eighty fathom", confidence: 0.9, language: "en", engine: "webspeech" },
      source: "voice",
    });
    const types = entry.entities.map((e) => e.type);
    expect(types).toContain("gear");
    expect(types).toContain("depth");
    expect(types).toContain("location_relative");
  });
});

describe("applyCorrections", () => {
  it("returns the base entry unchanged when there are no corrections", () => {
    const entry = newEntrySkeleton({ id: crypto.randomUUID(), timestamp: new Date().toISOString(), gps: null, audio: null, source: "voice" });
    const effective = applyCorrections(entry);
    expect(effective.retracted).toBe(false);
    expect(effective.amended).toBe(false);
  });

  it("overlays amended fields without mutating the stored entry", () => {
    const entry = newEntrySkeleton({ id: crypto.randomUUID(), timestamp: new Date().toISOString(), gps: null, audio: null, source: "voice" });
    entry.tags = ["original"];
    entry.corrections.push(buildAmendCorrection({ tags: ["fixed"] }, "typo"));

    const effective = applyCorrections(entry);
    expect(effective.tags).toEqual(["fixed"]);
    expect(effective.amended).toBe(true);
    expect(entry.tags).toEqual(["original"]); // stored entry is untouched
  });

  it("marks retracted=true and ignores nothing else that came before it", () => {
    const entry = newEntrySkeleton({ id: crypto.randomUUID(), timestamp: new Date().toISOString(), gps: null, audio: null, source: "voice" });
    entry.corrections.push(buildAmendCorrection({ tags: ["kept"] }));
    entry.corrections.push(buildRetractCorrection("bad entry"));

    const effective = applyCorrections(entry);
    expect(effective.retracted).toBe(true);
    expect(effective.tags).toEqual(["kept"]); // amendment still folded in, just hidden by retracted flag
  });
});
