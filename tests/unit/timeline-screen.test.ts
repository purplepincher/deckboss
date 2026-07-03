import { describe, it, expect } from "vitest";
import { filtersToQueryParams } from "../../src/ui/screens/TimelineScreen";
import type { SearchFilters } from "../../src/ui/components/SearchBar";

function baseFilters(overrides: Partial<SearchFilters> = {}): SearchFilters {
  return {
    text: "",
    dateRange: "all",
    entityType: "all",
    showRetracted: false,
    ...overrides,
  };
}

describe("filtersToQueryParams", () => {
  // Regression test for the "no way back to a retracted entry" gap: the
  // retraction confirmation dialog promises entries are "never deleted",
  // but until this toggle existed nothing in the UI ever set
  // includeRetracted: true, so a retracted entry (correctly kept in
  // storage) had no discoverable path back into view.
  it("leaves includeRetracted unset (falsy) when the toggle is off", () => {
    const params = filtersToQueryParams(baseFilters({ showRetracted: false }), 20);
    expect(params.includeRetracted).toBeFalsy();
  });

  it("sets includeRetracted: true when 'Show retracted' is on", () => {
    const params = filtersToQueryParams(baseFilters({ showRetracted: true }), 20);
    expect(params.includeRetracted).toBe(true);
  });

  it("still applies the other filters alongside includeRetracted", () => {
    const params = filtersToQueryParams(
      baseFilters({ showRetracted: true, text: "crab", entityType: "gear" }),
      5,
    );
    expect(params.includeRetracted).toBe(true);
    expect(params.text).toBe("crab");
    expect(params.entities).toEqual(["gear"]);
    expect(params.limit).toBe(5);
  });
});
