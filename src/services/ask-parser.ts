import type { QueryParams } from "../core/tensor-log/query-engine";
import type { EntityType } from "../core/types/log-entry";
import { SPECIES, GEAR, WEATHER, keywordRegex } from "./entity-extractor";

/**
 * GPS position supplied by the caller. `null` means the user's location is
 * not currently available.
 */
export interface GPSPosition {
  lat: number;
  lon: number;
}

/**
 * A single interpreted token from the user's query. Chips are the honesty
 * mechanism: every consumed token is surfaced as a named, removable object
 * so the UI can show how the query was understood.
 */
export interface AskChip {
  kind: "dateRange" | "near" | "species" | "gear" | "weather" | "text" | "ignoredLocation";
  /** Human-readable value for the chip label. */
  value: string;
  /** The exact text in the original input that produced this chip. */
  matchedText: string;
}

/**
 * Result of parsing a raw Ask-Your-Log query.
 */
export interface AskParseResult {
  /** Query parameters ready to pass to `query-engine.ts`. */
  params: QueryParams;
  /** One chip per consumed token, in input order. */
  chips: AskChip[];
  /**
   * Non-fatal issues the caller should surface to the user rather than
   * silently ignore. The canonical example is a location term with no GPS
   * fix available.
   */
  warnings: string[];
}

/**
 * Options for `parseAskQuery`.
 */
export interface AskParserOptions {
  /** Moment in time used for relative date math. Required for testability. */
  now: Date;
  /** Radius for `near` queries. Defaults to 2km per the design memo. */
  radiusKm?: number;
}

const DEFAULT_RADIUS_KM = 2;

interface DateRange {
  start: Date;
  end: Date;
}

interface Span {
  start: number;
  end: number;
  text: string;
}

interface ConsumedMatch extends Span {
  chip: AskChip;
  apply(params: QueryParams): void;
}

const MONTH_NAMES = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
];

const MONTH_ABBREVIATIONS: Record<string, number> = {
  jan: 0,
  feb: 1,
  mar: 2,
  apr: 3,
  may: 4,
  jun: 5,
  jul: 6,
  aug: 7,
  sept: 8,
  sep: 8,
  oct: 9,
  nov: 10,
  dec: 11,
};

const ALL_MONTH_NAMES = [...MONTH_NAMES, ...Object.keys(MONTH_ABBREVIATIONS)];
const MONTH_NAME_PATTERN = ALL_MONTH_NAMES.join("|");

// All date math is done in UTC so the parser behaves the same regardless of
// the runtime timezone. Entry timestamps are ISO strings (UTC), so the
// resulting QueryParams line up with query-engine.ts's comparisons.
function startOfDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0, 0));
}

function endOfDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 23, 59, 59, 999));
}

function addDays(d: Date, days: number): Date {
  const result = new Date(d.getTime());
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

function parseMonth(name: string): number | undefined {
  const lower = name.toLowerCase();
  const fullIndex = MONTH_NAMES.indexOf(lower);
  if (fullIndex >= 0) return fullIndex;
  return MONTH_ABBREVIATIONS[lower];
}

function parseDay(token: string): number {
  const normalized = token.toLowerCase().replace(/(?:st|nd|rd|th)$/, "");
  const day = parseInt(normalized, 10);
  if (Number.isNaN(day) || day < 1 || day > 31) return 1;
  return day;
}

function monthYearFor(now: Date, monthIndex: number): number {
  // If the requested month is in the future relative to now, assume the
  // user means the previous occurrence of that month (log queries are
  // almost always about the past). Otherwise use the current year.
  if (monthIndex > now.getUTCMonth()) {
    return now.getUTCFullYear() - 1;
  }
  return now.getUTCFullYear();
}

function makeThisWeekRange(now: Date): DateRange {
  // Week starts on Sunday.
  const day = now.getUTCDay();
  const start = addDays(startOfDay(now), -day);
  return { start, end: endOfDay(addDays(start, 6)) };
}

function makeLastWeekRange(now: Date): DateRange {
  const thisWeekStart = makeThisWeekRange(now).start;
  const start = addDays(thisWeekStart, -7);
  return { start, end: endOfDay(addDays(start, 6)) };
}

function makeLastMonthRange(now: Date): DateRange {
  const year = now.getUTCMonth() === 0 ? now.getUTCFullYear() - 1 : now.getUTCFullYear();
  const month = now.getUTCMonth() === 0 ? 11 : now.getUTCMonth() - 1;
  const start = new Date(Date.UTC(year, month, 1, 0, 0, 0, 0));
  const end = new Date(Date.UTC(year, month + 1, 0, 23, 59, 59, 999));
  return { start, end };
}

function makeMonthRange(now: Date, monthIndex: number, year?: number): DateRange {
  const resolvedYear = year ?? monthYearFor(now, monthIndex);
  const start = new Date(Date.UTC(resolvedYear, monthIndex, 1, 0, 0, 0, 0));
  const end = new Date(Date.UTC(resolvedYear, monthIndex + 1, 0, 23, 59, 59, 999));
  return { start, end };
}

function makeSpecificDate(now: Date, monthIndex: number, day: number, year?: number): DateRange {
  const resolvedYear = year ?? monthYearFor(now, monthIndex);
  const start = new Date(Date.UTC(resolvedYear, monthIndex, day, 0, 0, 0, 0));
  const end = new Date(Date.UTC(resolvedYear, monthIndex, day, 23, 59, 59, 999));
  return { start, end };
}

function findDateMatches(input: string, now: Date): ConsumedMatch[] {
  const matches: ConsumedMatch[] = [];

  // Specific date: "June 12th", "Jun 5", "last June 12th".
  const specificRe = new RegExp(
    `\\b(last\\s+)?(${MONTH_NAME_PATTERN})\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b`,
    "gi",
  );
  for (const match of input.matchAll(specificRe)) {
    const month = parseMonth(match[2] ?? "");
    if (month === undefined) continue;
    const day = parseDay(match[3] ?? "");
    const matchedText = match[0].trim();
    const isLast = match[1] !== undefined;
    const year = isLast ? now.getUTCFullYear() - 1 : undefined;
    const range = makeSpecificDate(now, month, day, year);
    matches.push({
      start: match.index ?? 0,
      end: (match.index ?? 0) + matchedText.length,
      text: matchedText,
      chip: { kind: "dateRange", value: matchedText, matchedText },
      apply: (params: QueryParams) => {
        params.startDate = range.start;
        params.endDate = range.end;
      },
    });
  }

  // "in <month>" or standalone "<month>", plus "last <month>".
  const monthRe = new RegExp(`\\b(last\\s+)?(?:in\\s+)?(${MONTH_NAME_PATTERN})\\b`, "gi");
  for (const match of input.matchAll(monthRe)) {
    const month = parseMonth(match[2] ?? "");
    if (month === undefined) continue;
    const matchedText = match[0].trim();
    const isLast = match[1] !== undefined;
    const year = isLast ? now.getUTCFullYear() - 1 : undefined;
    const range = makeMonthRange(now, month, year);
    matches.push({
      start: match.index ?? 0,
      end: (match.index ?? 0) + matchedText.length,
      text: matchedText,
      chip: { kind: "dateRange", value: matchedText, matchedText },
      apply: (params: QueryParams) => {
        params.startDate = range.start;
        params.endDate = range.end;
      },
    });
  }

  // Fixed relative phrases.
  const fixedPatterns: Array<[RegExp, (n: Date) => DateRange]> = [
    [/\btoday\b/gi, (n) => ({ start: startOfDay(n), end: endOfDay(n) })],
    [/\byesterday\b/gi, (n) => ({ start: startOfDay(addDays(n, -1)), end: endOfDay(addDays(n, -1)) })],
    [/\bthis week\b/gi, makeThisWeekRange],
    [/\blast week\b/gi, makeLastWeekRange],
    [/\blast month\b/gi, makeLastMonthRange],
  ];

  for (const [re, makeRange] of fixedPatterns) {
    for (const match of input.matchAll(re)) {
      const matchedText = match[0].trim();
      const range = makeRange(now);
      matches.push({
        start: match.index ?? 0,
        end: (match.index ?? 0) + matchedText.length,
        text: matchedText,
        chip: { kind: "dateRange", value: matchedText, matchedText },
        apply: (params: QueryParams) => {
          params.startDate = range.start;
          params.endDate = range.end;
        },
      });
    }
  }

  return matches;
}

function findLocationMatches(
  input: string,
  currentPosition: GPSPosition | null,
  radiusKm: number,
): ConsumedMatch[] {
  const patterns = [
    /\bnear here\b/gi,
    /\baround here\b/gi,
    /\bthis spot\b/gi,
    /\bhere\b/gi,
  ];

  const matches: ConsumedMatch[] = [];
  for (const re of patterns) {
    for (const match of input.matchAll(re)) {
      const matchedText = match[0].trim();
      const start = match.index ?? 0;
      const end = start + matchedText.length;

      if (currentPosition) {
        const position = currentPosition;
        matches.push({
          start,
          end,
          text: matchedText,
          chip: { kind: "near", value: matchedText, matchedText },
          apply: (params: QueryParams) => {
            params.near = { lat: position.lat, lon: position.lon, radiusKm };
          },
        });
      } else {
        matches.push({
          start,
          end,
          text: matchedText,
          chip: { kind: "ignoredLocation", value: matchedText, matchedText },
          apply: () => {
            // Nothing to apply; the term is ignored due to missing GPS.
          },
        });
      }
    }
  }
  return matches;
}

function findVocabularyMatches(input: string): ConsumedMatch[] {
  const vocabularies: Array<["species" | "gear" | "weather", string[]]> = [
    ["species", SPECIES],
    ["gear", GEAR],
    ["weather", WEATHER],
  ];

  const matches: ConsumedMatch[] = [];
  for (const [kind, words] of vocabularies) {
    const re = keywordRegex(words);
    for (const match of input.matchAll(re)) {
      const matchedText = match[0].trim();
      matches.push({
        start: match.index ?? 0,
        end: (match.index ?? 0) + matchedText.length,
        text: matchedText,
        chip: { kind, value: matchedText, matchedText },
        apply: () => {
          // Vocabulary hits update params via the caller after deduplication.
        },
      });
    }
  }
  return matches;
}

const FILLER_PATTERNS = [
  /^\s*show me\b/i,
  /^\s*when did I\b/i,
  /^\s*find me\b/i,
  /^\s*find\b/i,
  /^\s*how many\b/i,
  /^\s*any\b/i,
  /^\s*please\b/i,
  /^\s*can you\b/i,
  /^\s*could you\b/i,
  /^\s*tell me\b/i,
  /^\s*look for\b/i,
  /^\s*search for\b/i,
  /^\s*get me\b/i,
  /^\s*give me\b/i,
  /^\s*i want\b/i,
  /^\s*i'd like\b/i,
  /^\s*let me see\b/i,
  /^\s*did I\b/i,
  /^\s*have I\b/i,
  /^\s*was there\b/i,
  /^\s*were there\b/i,
];

function stripLeadingFiller(input: string): string {
  for (const re of FILLER_PATTERNS) {
    const match = re.exec(input);
    if (match) {
      return input.slice(match[0].length).replace(/^\s+/, "");
    }
  }
  return input;
}

function removeOverlaps<T extends Span>(matches: T[]): T[] {
  const sorted = [...matches].sort((a, b) => {
    if (a.start !== b.start) return a.start - b.start;
    return b.end - a.end; // longer first at same start
  });
  const kept: T[] = [];
  for (const m of sorted) {
    if (!kept.some((k) => m.start < k.end && m.end > k.start)) {
      kept.push(m);
    }
  }
  return kept;
}

function buildFreeText(input: string, removedSpans: Span[]): string {
  const sorted = [...removedSpans].sort((a, b) => a.start - b.start);
  let result = "";
  let last = 0;
  for (const span of sorted) {
    result += input.slice(last, span.start);
    last = span.end;
  }
  result += input.slice(last);
  return result.replace(/\s+/g, " ").trim();
}

/**
 * Parse a raw Ask-Your-Log query string into `QueryParams` and a list of
 * honesty chips describing what was understood.
 *
 * @param input Raw transcript or typed text from the user.
 * @param currentPosition Current GPS fix, or `null` if unavailable.
 * @param options `now` is required so date math is deterministic in tests.
 *                Production callers should pass `new Date()`.
 */
export function parseAskQuery(
  input: string,
  currentPosition: GPSPosition | null,
  options: AskParserOptions,
): AskParseResult {
  const { now, radiusKm = DEFAULT_RADIUS_KM } = options;
  const warnings: string[] = [];
  const params: QueryParams = {};

  // 1. Strip leading filler so it never reaches the free-text filter. The
  //    rest of the pipeline works on the already-stripped string, so filler
  //    does not need to be tracked as a removed span.
  const withoutFiller = stripLeadingFiller(input);

  // 2. Find date terms. These are removed from free text.
  const dateMatches = removeOverlaps(findDateMatches(withoutFiller, now));

  // 3. Find location terms. These are removed from free text.
  const locationMatches = removeOverlaps(findLocationMatches(withoutFiller, currentPosition, radiusKm));
  if (locationMatches.some((m) => m.chip.kind === "ignoredLocation")) {
    warnings.push("Location requested but no GPS position is available.");
  }

  // 4. Find vocabulary hits. These produce entity-type filters AND chips,
  //    but the matched word is intentionally kept in the free-text term.
  const vocabMatches = removeOverlaps(findVocabularyMatches(withoutFiller));
  const foundEntityTypes = new Set<EntityType>();
  for (const m of vocabMatches) {
    foundEntityTypes.add(m.chip.kind as EntityType);
  }
  if (foundEntityTypes.size > 0) {
    params.entities = Array.from(foundEntityTypes);
  }

  // 5. Apply consumed matches to params.
  for (const m of dateMatches) m.apply(params);
  for (const m of locationMatches) m.apply(params);

  // 6. Build chips in input order, then append the free-text chip.
  const chips: AskChip[] = [...dateMatches, ...locationMatches, ...vocabMatches]
    .sort((a, b) => a.start - b.start)
    .map((m) => m.chip);

  const freeText = buildFreeText(withoutFiller, [...dateMatches, ...locationMatches]);
  if (freeText) {
    params.text = freeText;
    chips.push({ kind: "text", value: freeText, matchedText: freeText });
  }

  return { params, chips, warnings };
}
