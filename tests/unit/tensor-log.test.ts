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

const TRANSCRIPT = { text: "Set twelve crab pots starboard rail eighty fathom", confidence: 0.94, language: "en", engine: "webspeech" as const };

describe("entry-serializer <-> entry-parser round trip", () => {
  it("preserves a new-shape entry (transcript in corrections) through serialize -> parse", async () => {
    const entry = await buildEntry({
      audioBlob: null,
      gps: mockGps(),
      transcript: TRANSCRIPT,
      source: "voice",
    });
    entry.tags = ["haul", "setup"];

    const markdown = serializeEntry(entry);
    const parsed = parseEntry(markdown);

    expect(parsed).toEqual(entry);
    expect(parsed.transcript).toBeNull();
    expect(parsed.corrections).toHaveLength(1);
    expect(parsed.corrections[0]?.author).toEqual({ kind: "model", engine: "webspeech" });
  });

  it("preserves a legacy-shape entry (transcript set directly on base) through serialize -> parse", () => {
    const entry = newEntrySkeleton({
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      gps: mockGps(),
      audio: { filename: "abc_audio.webm", duration_ms: 8432, format: "audio/webm;codecs=opus", size_bytes: 124780 },
      source: "voice",
    });
    entry.transcript = TRANSCRIPT;
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

  it("renders the effective transcript in the Markdown body even when the base transcript is null", async () => {
    const entry = await buildEntry({
      audioBlob: null,
      gps: null,
      transcript: TRANSCRIPT,
      source: "voice",
    });

    const markdown = serializeEntry(entry);
    expect(markdown).toContain(TRANSCRIPT.text);
  });
});

describe("buildEntry", () => {
  it("never blocks on missing GPS or transcript", async () => {
    const entry = await buildEntry({ audioBlob: null, gps: null, source: "voice" });
    expect(entry.gps).toBeNull();
    expect(entry.transcript).toBeNull();
    expect(entry.corrections).toHaveLength(0);
    expect(entry.id).toBeTruthy();
  });

  it("stores the first transcript as a model-authored correction instead of on the base record", async () => {
    const entry = await buildEntry({
      audioBlob: null,
      gps: null,
      transcript: TRANSCRIPT,
      source: "voice",
    });

    expect(entry.transcript).toBeNull();
    expect(entry.corrections).toHaveLength(1);

    const correction = entry.corrections[0];
    expect(correction?.type).toBe("amend");
    expect(correction?.author).toEqual({ kind: "model", engine: "webspeech" });
    expect(correction?.fields?.transcript).toEqual(TRANSCRIPT);
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

describe("buildAmendCorrection / buildRetractCorrection", () => {
  it("defaults author to human", () => {
    const amend = buildAmendCorrection({ tags: ["x"] });
    expect(amend.author).toEqual({ kind: "human" });

    const retract = buildRetractCorrection("bad entry");
    expect(retract.author).toEqual({ kind: "human" });
  });

  it("accepts an explicit author", () => {
    const modelAuthor = { kind: "model" as const, engine: "whisper-1" as const };
    const amend = buildAmendCorrection({ tags: ["x"] }, "auto-tagged", modelAuthor);
    expect(amend.author).toEqual(modelAuthor);

    const retract = buildRetractCorrection("model error", modelAuthor);
    expect(retract.author).toEqual(modelAuthor);
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

  it("resolves a new-shape entry's transcript from its first correction", async () => {
    const entry = await buildEntry({
      audioBlob: null,
      gps: null,
      transcript: TRANSCRIPT,
      source: "voice",
    });

    const effective = applyCorrections(entry);
    expect(effective.transcript).toEqual(TRANSCRIPT);
  });

  it("honors legacy entries that have transcript set directly on the base record", () => {
    const entry = newEntrySkeleton({ id: crypto.randomUUID(), timestamp: new Date().toISOString(), gps: null, audio: null, source: "voice" });
    entry.transcript = TRANSCRIPT;

    const effective = applyCorrections(entry);
    expect(effective.transcript).toEqual(TRANSCRIPT);
  });

  it("lets a later correction override a legacy entry's directly-stored transcript", () => {
    const entry = newEntrySkeleton({ id: crypto.randomUUID(), timestamp: new Date().toISOString(), gps: null, audio: null, source: "voice" });
    entry.transcript = TRANSCRIPT;
    const corrected = { text: "corrected text", confidence: 0.99, language: "en", engine: "whisper-1" as const };
    entry.corrections.push(buildAmendCorrection({ transcript: corrected }, "human fix"));

    const effective = applyCorrections(entry);
    expect(effective.transcript).toEqual(corrected);
  });
});
