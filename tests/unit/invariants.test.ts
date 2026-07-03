import { describe, it, expect } from "vitest";
import { assertWriteIsAdditive, InvariantViolationError } from "../../src/core/tensor-log/invariants";
import { newEntrySkeleton } from "../../src/core/types/log-entry";
import { buildAmendCorrection, buildRetractCorrection } from "../../src/core/tensor-log/entry-builder";

const DEVICE_ID = crypto.randomUUID();

function baseEntry() {
  return newEntrySkeleton({
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    gps: null,
    audio: null,
    source: "voice",
  });
}

describe("assertWriteIsAdditive", () => {
  it("allows the first write for a brand-new entry unconditionally", () => {
    const entry = baseEntry();
    expect(() => assertWriteIsAdditive(undefined, entry)).not.toThrow();
  });

  it("allows appending a new correction", () => {
    const previous = baseEntry();
    const next = { ...previous, corrections: [buildAmendCorrection({ tags: ["x"] }, DEVICE_ID)] };
    expect(() => assertWriteIsAdditive(previous, next)).not.toThrow();
  });

  it("allows a sync-merge-shaped write (superset of existing corrections)", () => {
    const c1 = buildAmendCorrection({ tags: ["from-this-device"] }, DEVICE_ID);
    const c2 = buildRetractCorrection(DEVICE_ID, "from-remote-device");
    const previous = { ...baseEntry(), corrections: [c1] };
    const merged = { ...previous, corrections: [c1, c2] }; // conflict-resolver.mergeEntries's shape
    expect(() => assertWriteIsAdditive(previous, merged)).not.toThrow();
  });

  it("rejects removing a previously-committed correction", () => {
    const c1 = buildAmendCorrection({ tags: ["x"] }, DEVICE_ID);
    const previous = { ...baseEntry(), corrections: [c1] };
    const next = { ...previous, corrections: [] };
    expect(() => assertWriteIsAdditive(previous, next)).toThrow(InvariantViolationError);
  });

  it("rejects modifying a previously-committed correction", () => {
    const c1 = buildAmendCorrection({ tags: ["original"] }, DEVICE_ID);
    const previous = { ...baseEntry(), corrections: [c1] };
    const tampered = { ...c1, reason: "sneaky edit" };
    const next = { ...previous, corrections: [tampered] };
    expect(() => assertWriteIsAdditive(previous, next)).toThrow(InvariantViolationError);
  });

  it("rejects changing an immutable capture field", () => {
    const previous = baseEntry();
    const next = { ...previous, timestamp: new Date(Date.now() + 100_000).toISOString() };
    expect(() => assertWriteIsAdditive(previous, next)).toThrow(InvariantViolationError);
  });

  it("rejects changing gps after creation", () => {
    const previous = baseEntry();
    const next = {
      ...previous,
      gps: {
        latitude: 1,
        longitude: 1,
        accuracy: 5,
        altitude: null,
        heading: null,
        speed: null,
        timestamp: new Date().toISOString(),
        source: "gps" as const,
      },
    };
    expect(() => assertWriteIsAdditive(previous, next)).toThrow(InvariantViolationError);
  });

  it("rejects changing transcript directly (must use a correction)", () => {
    const previous = baseEntry();
    previous.transcript = { text: "original", confidence: 0.9, language: "en", engine: "webspeech" };
    const next = {
      ...previous,
      transcript: { text: "mutated", confidence: 0.9, language: "en", engine: "webspeech" },
    };
    expect(() => assertWriteIsAdditive(previous, next)).toThrow(InvariantViolationError);
  });

  it("rejects changing entities directly (must use a correction)", () => {
    const previous = baseEntry();
    previous.entities = [{ type: "gear", value: "crab pots", confidence: 0.9 }];
    const next = {
      ...previous,
      entities: [{ type: "species", value: "lobster", confidence: 0.9 }],
    };
    expect(() => assertWriteIsAdditive(previous, next)).toThrow(InvariantViolationError);
  });

  it("rejects changing tags directly (must use a correction)", () => {
    const previous = baseEntry();
    previous.tags = ["original"];
    const next = {
      ...previous,
      tags: ["mutated"],
    };
    expect(() => assertWriteIsAdditive(previous, next)).toThrow(InvariantViolationError);
  });

  it("allows re-writing an entry with corrections unchanged (idempotent write)", () => {
    const c1 = buildAmendCorrection({ tags: ["x"] }, DEVICE_ID);
    const previous = { ...baseEntry(), corrections: [c1] };
    const next = { ...previous };
    expect(() => assertWriteIsAdditive(previous, next)).not.toThrow();
  });
});
