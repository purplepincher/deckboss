import type { Entity } from "../core/types/log-entry";

/**
 * Phase 1 entity extraction: keyword lists + regex, no ML dependency. Good
 * enough for "crab pot", "eighty fathom", "185 degrees" — populates
 * LogEntry.entities so query-engine's `entities` filter and Phase 3's
 * ML-training export both have structured data to work from. Upgrades to
 * real NLP in Phase 3; this module's job is just to not block on that.
 */

export const SPECIES = [
  "chinook",
  "coho",
  "pink salmon",
  "chum",
  "sockeye",
  "salmon",
  "lingcod",
  "halibut",
  "rockfish",
  "sablefish",
  "albacore",
  "tuna",
  "dungeness",
  "crab",
  "shrimp",
  "prawn",
  "snapper",
  "cod",
  "herring",
];

export const GEAR = [
  "crab pots?",
  "crab traps?",
  "gillnet",
  "longline",
  "troll gear",
  "seine",
  "traps?",
  "pots?",
  "rod",
  "reel",
  "net",
  "line",
  "hook",
  "buoy",
  "anchor",
];

const LOCATION_RELATIVE = [
  "port rail",
  "starboard rail",
  "port side",
  "starboard side",
  "port",
  "starboard",
  "bow",
  "stern",
  "amidships",
  "rail",
];

export const WEATHER = ["wind", "swell", "fog", "rain", "chop", "chopp?y", "calm", "glassy", "squall"];

const NUMBER_WORDS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
  twenty: 20,
  thirty: 30,
  forty: 40,
  fifty: 50,
  sixty: 60,
  seventy: 70,
  eighty: 80,
  ninety: 90,
  hundred: 100,
};

const NUMBER_TOKEN = `(?:\\d+(?:\\.\\d+)?|${Object.keys(NUMBER_WORDS).join("|")})`;

const DEPTH_RE = new RegExp(`\\b(${NUMBER_TOKEN})\\s*(fathoms?)\\b`, "gi");
const MEASUREMENT_RE = new RegExp(
  `\\b(${NUMBER_TOKEN})\\s*(degrees?|°|feet|ft|meters?|m|knots?|gallons?|gal)\\b`,
  "gi",
);
const STANDALONE_QUANTITY_RE = new RegExp(`\\b(${NUMBER_TOKEN})\\b`, "gi");

export function keywordRegex(words: string[]): RegExp {
  return new RegExp(`\\b(${words.join("|")})\\b`, "gi");
}

interface Span {
  start: number;
  end: number;
}

function overlaps(span: Span, spans: Span[]): boolean {
  return spans.some((s) => span.start < s.end && span.end > s.start);
}

export function extractEntities(text: string): Entity[] {
  if (!text.trim()) return [];

  const entities: Entity[] = [];
  const consumed: Span[] = [];

  for (const match of text.matchAll(DEPTH_RE)) {
    const full = match[0] ?? "";
    const start = match.index ?? 0;
    const span = { start, end: start + full.length };
    entities.push({ type: "depth", value: full.trim(), confidence: 0.88 });
    consumed.push(span);
  }

  for (const match of text.matchAll(MEASUREMENT_RE)) {
    const full = match[0] ?? "";
    const start = match.index ?? 0;
    const span = { start, end: start + full.length };
    if (overlaps(span, consumed)) continue;
    entities.push({ type: "measurement", value: full.trim(), confidence: 0.85 });
    consumed.push(span);
  }

  for (const match of text.matchAll(STANDALONE_QUANTITY_RE)) {
    const full = match[0] ?? "";
    const start = match.index ?? 0;
    const span = { start, end: start + full.length };
    if (overlaps(span, consumed)) continue;
    entities.push({ type: "quantity", value: full.trim(), confidence: 0.75 });
    consumed.push(span);
  }

  for (const [words, type] of [
    [GEAR, "gear"],
    [SPECIES, "species"],
    [LOCATION_RELATIVE, "location_relative"],
    [WEATHER, "weather"],
  ] as const) {
    for (const match of text.matchAll(keywordRegex(words))) {
      const full = match[0] ?? "";
      entities.push({ type, value: full.trim(), confidence: 0.9 });
    }
  }

  return entities;
}
