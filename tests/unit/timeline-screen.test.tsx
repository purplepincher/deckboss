import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { TimelineScreen, computeActiveParams } from "../../src/ui/screens/TimelineScreen";
import { useDeckBossStore } from "../../src/state/store";
import { parseAskQuery } from "../../src/services/ask-parser";
import type { EffectiveLogEntry } from "../../src/core/types/log-entry";

const NOW = new Date("2026-07-03T14:31:16Z");
const HERE = { lat: 44.6476, lon: -63.5728 };

function uuid(n: number): string {
  return `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
}

function makeEntry(overrides: Partial<EffectiveLogEntry> & { timestamp: string }): EffectiveLogEntry {
  return {
    id: uuid(1),
    gps: null,
    audio: null,
    transcript: null,
    entities: [],
    tags: [],
    source: "voice",
    thread_id: uuid(1),
    version: "1",
    retracted: false,
    amended: false,
    lastCorrectionReason: null,
    ...overrides,
  };
}

function renderScreen(props: { now?: Date } = {}) {
  return render(
    <MemoryRouter>
      <TimelineScreen {...props} />
    </MemoryRouter>,
  );
}

describe("computeActiveParams", () => {
  it("keeps all parsed params when no chips are removed", () => {
    const parsed = parseAskQuery("chinook last week near here", HERE, { now: NOW });
    const params = computeActiveParams(parsed, new Set());
    expect(params.entities).toEqual(["species"]);
    expect(params.startDate).toBeDefined();
    expect(params.endDate).toBeDefined();
    expect(params.near).toBeDefined();
    expect(params.text).toBe("chinook");
  });

  it("removes the date range when the dateRange chip is removed", () => {
    const parsed = parseAskQuery("chinook last week", null, { now: NOW });
    const params = computeActiveParams(parsed, new Set([parsed.chips.findIndex((c) => c.kind === "dateRange")]));
    expect(params.startDate).toBeUndefined();
    expect(params.endDate).toBeUndefined();
    expect(params.entities).toEqual(["species"]);
    expect(params.text).toBe("chinook");
  });

  it("removes the near filter when the near chip is removed", () => {
    const parsed = parseAskQuery("chinook near here", HERE, { now: NOW });
    const params = computeActiveParams(parsed, new Set([parsed.chips.findIndex((c) => c.kind === "near")]));
    expect(params.near).toBeUndefined();
    expect(params.entities).toEqual(["species"]);
  });

  it("removes an entity type only when all chips of that kind are removed", () => {
    const parsed = parseAskQuery("chinook and coho", null, { now: NOW });
    const speciesChips = parsed.chips.map((c, i) => ({ c, i })).filter(({ c }) => c.kind === "species");
    expect(speciesChips).toHaveLength(2);

    // Remove one species chip — species filter should stay.
    const oneRemoved = computeActiveParams(parsed, new Set([speciesChips[0]!.i]));
    expect(oneRemoved.entities).toEqual(["species"]);

    // Remove both — species filter should go.
    const bothRemoved = computeActiveParams(parsed, new Set(speciesChips.map(({ i }) => i)));
    expect(bothRemoved.entities).toBeUndefined();
  });

  it("removes the text filter when the text chip is removed", () => {
    const parsed = parseAskQuery("chinook", null, { now: NOW });
    const textChipIndex = parsed.chips.findIndex((c) => c.kind === "text");
    const params = computeActiveParams(parsed, new Set([textChipIndex]));
    expect(params.text).toBeUndefined();
    expect(params.entities).toEqual(["species"]);
  });

  it("keeps the text filter when only the species chip is removed (overlap case)", () => {
    const parsed = parseAskQuery("chinook", null, { now: NOW });
    const speciesChipIndex = parsed.chips.findIndex((c) => c.kind === "species");
    const params = computeActiveParams(parsed, new Set([speciesChipIndex]));
    expect(params.entities).toBeUndefined();
    expect(params.text).toBe("chinook");
  });
});

describe("TimelineScreen ask-to-timeline wiring", () => {
  const chinookEntry = makeEntry({
    id: uuid(1),
    thread_id: uuid(1),
    timestamp: "2026-07-01T06:12:00.000Z",
    transcript: { text: "two nice chinook off the port rail", confidence: 0.9, language: "en", engine: "webspeech" },
    entities: [
      { type: "species", value: "chinook", confidence: 0.9 },
      { type: "location_relative", value: "port rail", confidence: 0.8 },
    ],
  });

  const crabEntry = makeEntry({
    id: uuid(2),
    thread_id: uuid(2),
    timestamp: "2026-07-02T14:00:00.000Z",
    transcript: { text: "forty crab in the pots", confidence: 0.85, language: "en", engine: "webspeech" },
    entities: [
      { type: "species", value: "crab", confidence: 0.9 },
      { type: "gear", value: "pots", confidence: 0.8 },
    ],
  });

  const oldChinookEntry = makeEntry({
    id: uuid(3),
    thread_id: uuid(3),
    timestamp: "2026-06-25T08:00:00.000Z",
    transcript: { text: "chinook yesterday morning", confidence: 0.85, language: "en", engine: "webspeech" },
    entities: [{ type: "species", value: "chinook", confidence: 0.9 }],
  });

  beforeEach(() => {
    useDeckBossStore.setState({
      entries: [chinookEntry, crabEntry, oldChinookEntry],
      entriesLoaded: true,
    });

    Object.defineProperty(globalThis.navigator, "geolocation", {
      value: {
        getCurrentPosition: vi.fn((success: PositionCallback) => {
          success({
            coords: { latitude: HERE.lat, longitude: HERE.lon, accuracy: 10, altitude: null, heading: null, speed: null },
            timestamp: Date.now(),
          } as GeolocationPosition);
        }),
      },
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("typing a species query shows the interpretation chip and filters the timeline", async () => {
    renderScreen({ now: NOW });
    const input = screen.getByLabelText("Ask your log");

    fireEvent.change(input, { target: { value: "chinook" } });

    await waitFor(() => {
      expect(screen.getByText("Heard:")).toBeInTheDocument();
    });
    // "chinook" produces both a species chip and a text chip.
    expect(screen.getAllByLabelText("Remove chinook")).toHaveLength(2);

    // Both chinook entries should appear; the crab entry should not.
    expect(screen.getByText(/two nice chinook/)).toBeInTheDocument();
    expect(screen.getByText(/chinook yesterday morning/)).toBeInTheDocument();
    expect(screen.queryByText(/forty crab/)).not.toBeInTheDocument();
  });

  it("typing a date query filters to that date range", async () => {
    renderScreen({ now: NOW });
    const input = screen.getByLabelText("Ask your log");

    fireEvent.change(input, { target: { value: "chinook last week" } });

    await waitFor(() => {
      expect(screen.getByText(/last week/)).toBeInTheDocument();
    });

    // Only the June 25 chinook entry is in last week.
    expect(screen.getByText(/chinook yesterday morning/)).toBeInTheDocument();
    expect(screen.queryByText(/two nice chinook/)).not.toBeInTheDocument();
  });

  it("tapping a chip removes that constraint and re-runs the query", async () => {
    renderScreen({ now: NOW });
    const input = screen.getByLabelText("Ask your log");

    fireEvent.change(input, { target: { value: "chinook last week" } });

    await waitFor(() => {
      expect(screen.getByText(/last week/)).toBeInTheDocument();
    });

    // Remove the date chip.
    fireEvent.click(screen.getByLabelText("Remove last week"));

    await waitFor(() => {
      expect(screen.queryByText(/last week/)).not.toBeInTheDocument();
    });

    // Now both chinook entries should be visible.
    expect(screen.getByText(/two nice chinook/)).toBeInTheDocument();
    expect(screen.getByText(/chinook yesterday morning/)).toBeInTheDocument();
  });

  it("shows looseners and a nearest-miss probe when text over-constrains the query", async () => {
    renderScreen({ now: NOW });
    const input = screen.getByLabelText("Ask your log");

    // "halibut" does not appear in any entry, but "last week" has one entry.
    fireEvent.change(input, { target: { value: "halibut last week" } });

    await waitFor(() => {
      expect(screen.getByText("No matches.")).toBeInTheDocument();
    });

    expect(screen.getByText("Any time")).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText(/Nothing mentions .*halibut/)).toBeInTheDocument();
    });

    // Tapping "Show those" removes the text chip and shows the week-old entry.
    fireEvent.click(screen.getByText("Show those"));

    await waitFor(() => {
      expect(screen.getByText(/chinook yesterday morning/)).toBeInTheDocument();
    });
  });
});
