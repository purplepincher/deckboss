import { describe, it, expect } from "vitest";
import { parseAskQuery } from "../../src/services/ask-parser";
import type { GPSPosition } from "../../src/services/ask-parser";

const NOW = new Date("2026-07-03T14:31:16Z");
const HERE: GPSPosition = { lat: 44.6476, lon: -63.5728 };

function date(iso: string): Date {
  return new Date(iso);
}

describe("parseAskQuery", () => {
  describe("date terms", () => {
    it("parses 'today'", () => {
      const { params, chips } = parseAskQuery("today", null, { now: NOW });
      expect(params.startDate).toEqual(date("2026-07-03T00:00:00.000Z"));
      expect(params.endDate).toEqual(date("2026-07-03T23:59:59.999Z"));
      expect(chips).toEqual([{ kind: "dateRange", value: "today", matchedText: "today" }]);
    });

    it("parses 'yesterday'", () => {
      const { params, chips } = parseAskQuery("yesterday", null, { now: NOW });
      expect(params.startDate).toEqual(date("2026-07-02T00:00:00.000Z"));
      expect(params.endDate).toEqual(date("2026-07-02T23:59:59.999Z"));
      expect(chips).toEqual([{ kind: "dateRange", value: "yesterday", matchedText: "yesterday" }]);
    });

    it("parses 'this week' (Sunday start)", () => {
      const { params, chips } = parseAskQuery("this week", null, { now: NOW });
      expect(params.startDate).toEqual(date("2026-06-28T00:00:00.000Z"));
      expect(params.endDate).toEqual(date("2026-07-04T23:59:59.999Z"));
      expect(chips).toEqual([{ kind: "dateRange", value: "this week", matchedText: "this week" }]);
    });

    it("parses 'last week'", () => {
      const { params, chips } = parseAskQuery("last week", null, { now: NOW });
      expect(params.startDate).toEqual(date("2026-06-21T00:00:00.000Z"));
      expect(params.endDate).toEqual(date("2026-06-27T23:59:59.999Z"));
      expect(chips).toEqual([{ kind: "dateRange", value: "last week", matchedText: "last week" }]);
    });

    it("parses 'last month'", () => {
      const { params, chips } = parseAskQuery("last month", null, { now: NOW });
      expect(params.startDate).toEqual(date("2026-06-01T00:00:00.000Z"));
      expect(params.endDate).toEqual(date("2026-06-30T23:59:59.999Z"));
      expect(chips).toEqual([{ kind: "dateRange", value: "last month", matchedText: "last month" }]);
    });

    it("parses month name 'in June'", () => {
      const { params, chips } = parseAskQuery("in June", null, { now: NOW });
      expect(params.startDate).toEqual(date("2026-06-01T00:00:00.000Z"));
      expect(params.endDate).toEqual(date("2026-06-30T23:59:59.999Z"));
      expect(chips).toEqual([{ kind: "dateRange", value: "in June", matchedText: "in June" }]);
    });

    it("parses standalone month name 'June'", () => {
      const { params, chips } = parseAskQuery("June", null, { now: NOW });
      expect(params.startDate).toEqual(date("2026-06-01T00:00:00.000Z"));
      expect(params.endDate).toEqual(date("2026-06-30T23:59:59.999Z"));
      expect(chips).toEqual([{ kind: "dateRange", value: "June", matchedText: "June" }]);
    });

    it("parses 'last June' as the previous year", () => {
      const { params, chips } = parseAskQuery("last June", null, { now: NOW });
      expect(params.startDate).toEqual(date("2025-06-01T00:00:00.000Z"));
      expect(params.endDate).toEqual(date("2025-06-30T23:59:59.999Z"));
      expect(chips).toEqual([{ kind: "dateRange", value: "last June", matchedText: "last June" }]);
    });

    it("parses specific date 'June 12th'", () => {
      const { params, chips } = parseAskQuery("June 12th", null, { now: NOW });
      expect(params.startDate).toEqual(date("2026-06-12T00:00:00.000Z"));
      expect(params.endDate).toEqual(date("2026-06-12T23:59:59.999Z"));
      expect(chips).toEqual([{ kind: "dateRange", value: "June 12th", matchedText: "June 12th" }]);
    });

    it("chooses the previous year for a future standalone month", () => {
      // In July, "August" should map to August of the previous year.
      const { params } = parseAskQuery("August", null, { now: NOW });
      expect(params.startDate).toEqual(date("2025-08-01T00:00:00.000Z"));
      expect(params.endDate).toEqual(date("2025-08-31T23:59:59.999Z"));
    });
  });

  describe("vocabulary hits", () => {
    it("maps species words to the species entity filter and keeps them in free text", () => {
      const { params, chips } = parseAskQuery("chinook", null, { now: NOW });
      expect(params.entities).toEqual(["species"]);
      expect(params.text).toBe("chinook");
      expect(chips).toEqual([
        { kind: "species", value: "chinook", matchedText: "chinook" },
        { kind: "text", value: "chinook", matchedText: "chinook" },
      ]);
    });

    it("maps gear words to the gear entity filter and keeps them in free text", () => {
      const { params, chips } = parseAskQuery("crab pots", null, { now: NOW });
      expect(params.entities).toEqual(["gear"]);
      expect(params.text).toBe("crab pots");
      expect(chips).toEqual([
        { kind: "gear", value: "crab pots", matchedText: "crab pots" },
        { kind: "text", value: "crab pots", matchedText: "crab pots" },
      ]);
    });

    it("maps weather words to the weather entity filter", () => {
      const { params } = parseAskQuery("wind and fog", null, { now: NOW });
      expect(params.entities).toContain("weather");
      expect(params.text).toBe("wind and fog");
    });

    it("collapses multiple species hits into a single species entity filter", () => {
      const { params, chips } = parseAskQuery("chinook and coho", null, { now: NOW });
      expect(params.entities).toEqual(["species"]);
      const speciesChips = chips.filter((c) => c.kind === "species");
      expect(speciesChips).toHaveLength(2);
      expect(params.text).toBe("chinook and coho");
    });

    it("detects multi-word species phrases like 'pink salmon'", () => {
      const { params, chips } = parseAskQuery("pink salmon", null, { now: NOW });
      expect(params.entities).toEqual(["species"]);
      expect(chips).toContainEqual({
        kind: "species",
        value: "pink salmon",
        matchedText: "pink salmon",
      });
    });
  });

  describe("location terms", () => {
    it("adds a near filter when GPS is available", () => {
      const { params, chips, warnings } = parseAskQuery("near here", HERE, { now: NOW });
      expect(params.near).toEqual({ lat: HERE.lat, lon: HERE.lon, radiusKm: 2 });
      expect(chips).toEqual([
        { kind: "near", value: "near here", matchedText: "near here" },
      ]);
      expect(warnings).toEqual([]);
    });

    it("emits a warning and an ignored-location chip when GPS is missing", () => {
      const { params, chips, warnings } = parseAskQuery("near here", null, { now: NOW });
      expect(params.near).toBeUndefined();
      expect(chips).toEqual([
        { kind: "ignoredLocation", value: "near here", matchedText: "near here" },
      ]);
      expect(warnings).toEqual(["Location requested but no GPS position is available."]);
    });

    it("supports 'around here' and 'this spot'", () => {
      const around = parseAskQuery("around here", HERE, { now: NOW });
      expect(around.params.near).toBeDefined();
      expect(around.chips[0]?.kind).toBe("near");

      const spot = parseAskQuery("this spot", HERE, { now: NOW });
      expect(spot.params.near).toBeDefined();
      expect(spot.chips[0]?.kind).toBe("near");
    });

    it("uses the supplied radiusKm", () => {
      const { params } = parseAskQuery("here", HERE, { now: NOW, radiusKm: 5 });
      expect(params.near).toEqual({ lat: HERE.lat, lon: HERE.lon, radiusKm: 5 });
    });
  });

  describe("filler stripping", () => {
    it.each([
      ["show me", "show me chinook"],
      ["when did I", "when did I see halibut"],
      ["find", "find crab pots"],
      ["any", "any wind yesterday"],
      ["how many", "how many tuna this week"],
    ])("strips leading '%s'", (_label, input) => {
      const { params } = parseAskQuery(input, null, { now: NOW });
      expect(params.text).not.toMatch(/^show me\b/i);
      expect(params.text).not.toMatch(/^when did I\b/i);
      expect(params.text).not.toMatch(/^find\b/i);
      expect(params.text).not.toMatch(/^any\b/i);
      expect(params.text).not.toMatch(/^how many\b/i);
    });

    it("leaves filler-looking words in the middle of the query", () => {
      const { params } = parseAskQuery("chinook show me something", null, { now: NOW });
      expect(params.text).toBe("chinook show me something");
    });
  });

  describe("free-text fallback", () => {
    it("falls through entirely to free text when nothing is recognizable", () => {
      const { params, chips } = parseAskQuery("purple monkey dishwasher", null, { now: NOW });
      expect(params.text).toBe("purple monkey dishwasher");
      expect(params.entities).toBeUndefined();
      expect(params.startDate).toBeUndefined();
      expect(params.endDate).toBeUndefined();
      expect(params.near).toBeUndefined();
      expect(chips).toEqual([
        { kind: "text", value: "purple monkey dishwasher", matchedText: "purple monkey dishwasher" },
      ]);
    });
  });

  describe("combined queries", () => {
    it("parses 'chinook last week near here'", () => {
      const { params, chips, warnings } = parseAskQuery("chinook last week near here", HERE, {
        now: NOW,
      });
      expect(params.entities).toEqual(["species"]);
      expect(params.startDate).toEqual(date("2026-06-21T00:00:00.000Z"));
      expect(params.endDate).toEqual(date("2026-06-27T23:59:59.999Z"));
      expect(params.near).toEqual({ lat: HERE.lat, lon: HERE.lon, radiusKm: 2 });
      expect(params.text).toBe("chinook");
      expect(warnings).toEqual([]);

      const chipKinds = chips.map((c) => c.kind);
      expect(chipKinds).toContain("species");
      expect(chipKinds).toContain("dateRange");
      expect(chipKinds).toContain("near");
      expect(chipKinds).toContain("text");
    });

    it("keeps vocabulary words in free text while removing dates and locations", () => {
      const { params } = parseAskQuery("show me halibut in June near here", HERE, { now: NOW });
      expect(params.text).toBe("halibut");
      expect(params.entities).toEqual(["species"]);
      expect(params.startDate).toBeDefined();
      expect(params.near).toBeDefined();
    });
  });
});
