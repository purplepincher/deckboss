import { describe, it, expect } from "vitest";
import { queryEntries } from "../../src/core/tensor-log/query-engine";
import { newEntrySkeleton } from "../../src/core/types/log-entry";
import { applyCorrections, buildRetractCorrection } from "../../src/core/tensor-log/entry-builder";
import type { EffectiveLogEntry } from "../../src/core/types/log-entry";

const DEVICE_ID = crypto.randomUUID();

function makeEffective(overrides: {
  id?: string;
  daysAgo?: number;
  text?: string;
  lat?: number;
  lon?: number;
  entityType?: "gear" | "species";
  retracted?: boolean;
}): EffectiveLogEntry {
  const ts = new Date();
  ts.setDate(ts.getDate() - (overrides.daysAgo ?? 0));

  const raw = newEntrySkeleton({
    id: overrides.id ?? crypto.randomUUID(),
    timestamp: ts.toISOString(),
    gps:
      overrides.lat !== undefined
        ? {
            latitude: overrides.lat,
            longitude: overrides.lon ?? 0,
            accuracy: 5,
            altitude: null,
            heading: null,
            speed: null,
            timestamp: ts.toISOString(),
            source: "gps",
          }
        : null,
    audio: null,
    source: "voice",
  });
  raw.transcript = { text: overrides.text ?? "some log text", confidence: 0.9, language: "en", engine: "webspeech" };
  if (overrides.entityType) {
    raw.entities = [{ type: overrides.entityType, value: "x", confidence: 0.9 }];
  }
  if (overrides.retracted) {
    raw.corrections.push(buildRetractCorrection(DEVICE_ID, "test"));
  }
  return applyCorrections(raw);
}

describe("queryEntries", () => {
  it("filters by case-insensitive text substring", () => {
    const entries = [makeEffective({ text: "Crab pots off the point" }), makeEffective({ text: "engine temp 182" })];
    const results = queryEntries(entries, { text: "CRAB" });
    expect(results).toHaveLength(1);
    expect(results[0]?.transcript?.text).toContain("Crab");
  });

  it("hides retracted entries by default, includes them when asked", () => {
    const entries = [makeEffective({ retracted: true }), makeEffective({})];
    expect(queryEntries(entries)).toHaveLength(1);
    expect(queryEntries(entries, { includeRetracted: true })).toHaveLength(2);
  });

  it("filters by date range inclusively", () => {
    const entries = [makeEffective({ daysAgo: 10 }), makeEffective({ daysAgo: 1 })];
    const start = new Date();
    start.setDate(start.getDate() - 3);
    const results = queryEntries(entries, { startDate: start });
    expect(results).toHaveLength(1);
  });

  it("filters by geo radius using Haversine distance", () => {
    const near = makeEffective({ lat: 44.65, lon: -63.57 });
    const far = makeEffective({ lat: 10, lon: 10 });
    const results = queryEntries([near, far], { near: { lat: 44.6476, lon: -63.5728, radiusKm: 50 } });
    expect(results).toHaveLength(1);
    expect(results[0]?.id).toBe(near.id);
  });

  it("filters by entity type", () => {
    const entries = [makeEffective({ entityType: "gear" }), makeEffective({ entityType: "species" })];
    const results = queryEntries(entries, { entities: ["species"] });
    expect(results).toHaveLength(1);
  });

  it("sorts newest first and respects limit/offset", () => {
    const entries = [makeEffective({ daysAgo: 2 }), makeEffective({ daysAgo: 0 }), makeEffective({ daysAgo: 1 })];
    const results = queryEntries(entries, { limit: 2 });
    expect(results).toHaveLength(2);
    expect(new Date(results[0]!.timestamp).getTime()).toBeGreaterThan(new Date(results[1]!.timestamp).getTime());
  });
});
