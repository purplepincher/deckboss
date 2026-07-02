import { describe, it, expect } from "vitest";
import { extractEntities } from "../../src/services/entity-extractor";

describe("extractEntities", () => {
  it("extracts gear, depth, and location from the dev guide's example sentence", () => {
    const entities = extractEntities("Set twelve crab pots starboard rail eighty fathom");
    const byType = Object.fromEntries(entities.map((e) => [e.type, e.value]));

    expect(byType.gear).toMatch(/crab pots/i);
    expect(byType.depth).toMatch(/eighty fathom/i);
    expect(byType.location_relative).toMatch(/starboard rail/i);
    expect(byType.quantity).toBe("twelve");
  });

  it("does not double-count a number already consumed by a unit phrase", () => {
    const entities = extractEntities("eighty fathom of water");
    const quantities = entities.filter((e) => e.type === "quantity");
    expect(quantities).toHaveLength(0);
  });

  it("returns an empty array for blank input", () => {
    expect(extractEntities("   ")).toEqual([]);
  });

  it("extracts species and weather independently", () => {
    const entities = extractEntities("Wind picking up, saw a big halibut off the stern");
    const types = entities.map((e) => e.type);
    expect(types).toContain("weather");
    expect(types).toContain("species");
    expect(types).toContain("location_relative");
  });
});
