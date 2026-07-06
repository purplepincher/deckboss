/**
 * Fishing-domain vocabulary for the entity extractor and Ask-Your-Log
 * parser. Kept separate from the generic extraction machinery in
 * `entity-extractor.ts` so the domain-specific word lists can be
 * swapped or extended without touching span/overlap/regex logic — and
 * so a future domain pack (or an ML-trained replacement) can slot in
 * behind the same boundary. See ROADMAP.md "Extension architecture".
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

export const LOCATION_RELATIVE = [
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

export const WEATHER = [
  "wind",
  "swell",
  "fog",
  "rain",
  "chop",
  "chopp?y",
  "calm",
  "glassy",
  "squall",
];
