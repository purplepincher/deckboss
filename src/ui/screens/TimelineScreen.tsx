import { useEffect, useMemo, useRef, useState } from "react";
import { useDeckBossStore } from "../../state/store";
import { queryEntries, type QueryParams } from "../../core/tensor-log/query-engine";
import { useTensorLog } from "../hooks/useTensorLog";
import { LogCard } from "../components/LogCard";
import { SearchBar } from "../components/SearchBar";
import { useOfflineStatus } from "../hooks/useOfflineStatus";
import { parseAskQuery, type AskParseResult, type AskChip } from "../../services/ask-parser";
import type { GPSPosition } from "../../services/ask-parser";

const PAGE_SIZE = 20;

const LOCATION_WARNING = "Location requested but no GPS position is available.";

/**
 * Recompute the effective QueryParams from a parse result, minus any chips the
 * user has tapped to remove. This is the removable-chip honesty mechanism: the
 * same word can produce both a species chip and a text chip, and the user can
 * drop either constraint without retyping the query.
 *
 * Exported pure so the chip-to-params mapping can be unit tested without a
 * component harness, matching how this codebase tests logic.
 */
export function computeActiveParams(parsed: AskParseResult, removed: Set<number>): QueryParams {
  const keptChips = parsed.chips.filter((_, i) => !removed.has(i));
  const params: QueryParams = { ...parsed.params };

  if (!keptChips.some((c) => c.kind === "dateRange")) {
    delete params.startDate;
    delete params.endDate;
  }

  if (!keptChips.some((c) => c.kind === "near")) {
    delete params.near;
  }

  const keptEntityTypes = new Set(
    keptChips
      .filter((c): c is AskChip & { kind: "species" | "gear" | "weather" } =>
        ["species", "gear", "weather"].includes(c.kind),
      )
      .map((c) => c.kind),
  );
  if (keptEntityTypes.size === 0) {
    delete params.entities;
  } else {
    params.entities = Array.from(keptEntityTypes);
  }

  if (!keptChips.some((c) => c.kind === "text")) {
    delete params.text;
  }

  return params;
}

function formatDateSpan(dates: Date[]): string {
  if (dates.length === 0) return "";
  const sorted = [...dates].sort((a, b) => a.getTime() - b.getTime());
  const first = sorted[0] ?? new Date();
  const last = sorted[sorted.length - 1] ?? first;
  const sameDay =
    first.getUTCFullYear() === last.getUTCFullYear() &&
    first.getUTCMonth() === last.getUTCMonth() &&
    first.getUTCDate() === last.getUTCDate();
  // Use UTC so the displayed span matches the parser's UTC date math
  // regardless of the test/runtime timezone.
  const opts: Intl.DateTimeFormatOptions = { timeZone: "UTC", month: "short", day: "numeric" };
  if (sameDay) return first.toLocaleDateString(undefined, opts);
  const start = first.toLocaleDateString(undefined, opts);
  const end = last.toLocaleDateString(undefined, opts);
  return `${start} – ${end}`;
}

export function TimelineScreen({ now: nowProp }: { now?: Date } = {}) {
  // Capture the moment once on mount so the parser's date math is stable
  // across renders and deterministic in tests.
  const nowRef = useRef(nowProp ?? new Date());
  const [queryText, setQueryText] = useState("");
  const [parsed, setParsed] = useState<AskParseResult>(() =>
    parseAskQuery("", null, { now: nowRef.current }),
  );
  const [removedChipIndices, setRemovedChipIndices] = useState<Set<number>>(new Set());
  const [showRetracted, setShowRetracted] = useState(false);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [position, setPosition] = useState<GPSPosition | null>(null);
  const offline = useOfflineStatus();

  const entries = useDeckBossStore((s) => s.entries);

  // Parse the query whenever the text or GPS fix changes. A fresh parse resets
  // any removed chips because the user's words have changed.
  useEffect(() => {
    setParsed(parseAskQuery(queryText, position, { now: nowRef.current }));
    setRemovedChipIndices(new Set());
  }, [queryText, position]);

  // Read the current GPS fix once on mount. A failure is not fatal — the
  // parser will surface an ignored-location chip if the user mentions "here".
  useEffect(() => {
    if (!("geolocation" in navigator)) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => setPosition({ lat: pos.coords.latitude, lon: pos.coords.longitude }),
      () => setPosition(null),
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 60_000 },
    );
  }, []);

  const activeParams = useMemo(
    () => computeActiveParams(parsed, removedChipIndices),
    [parsed, removedChipIndices],
  );

  const params: QueryParams = useMemo(
    () => ({ ...activeParams, includeRetracted: showRetracted, limit: visibleCount }),
    [activeParams, showRetracted, visibleCount],
  );

  const { results, loading } = useTensorLog(params);

  const handleQueryChange = (text: string) => {
    setQueryText(text);
    setVisibleCount(PAGE_SIZE);
  };

  const removeChip = (index: number) => {
    setRemovedChipIndices((prev) => new Set([...prev, index]));
    setVisibleCount(PAGE_SIZE);
  };

  const removeDateConstraints = () => {
    setRemovedChipIndices((prev) => {
      const next = new Set(prev);
      parsed.chips.forEach((c, i) => {
        if (c.kind === "dateRange") next.add(i);
      });
      return next;
    });
    setVisibleCount(PAGE_SIZE);
  };

  const removeLocationConstraints = () => {
    setRemovedChipIndices((prev) => {
      const next = new Set(prev);
      parsed.chips.forEach((c, i) => {
        if (c.kind === "near" || c.kind === "ignoredLocation") next.add(i);
      });
      return next;
    });
    setVisibleCount(PAGE_SIZE);
  };

  const looseners = [] as { key: string; label: string; onClick: () => void }[];
  if (activeParams.startDate || activeParams.endDate) {
    looseners.push({ key: "time", label: "Any time", onClick: removeDateConstraints });
  }
  if (activeParams.near) {
    looseners.push({ key: "place", label: "Anywhere", onClick: removeLocationConstraints });
  }
  if (!showRetracted) {
    looseners.push({
      key: "retracted",
      label: "Include retracted",
      onClick: () => {
        setShowRetracted(true);
        setVisibleCount(PAGE_SIZE);
      },
    });
  }

  // Nearest-miss probe: silently run the same query without the text term. If
  // that has hits, offer a one-tap loosener instead of a dead end.
  const probeParams: QueryParams = useMemo(() => {
    const probe = { ...activeParams, includeRetracted: showRetracted };
    delete probe.text;
    return probe;
  }, [activeParams, showRetracted]);

  const probeResults = useMemo(() => queryEntries(entries, probeParams), [entries, probeParams]);

  const showProbe = results.length === 0 && activeParams.text && probeResults.length > 0;

  const summaryText = useMemo(() => {
    if (loading) return "";
    if (results.length === 0) return "";
    const count = `${results.length} ${results.length === 1 ? "entry" : "entries"}`;
    const span = formatDateSpan(results.map((e) => new Date(e.timestamp)));
    return span ? `${count} · ${span}` : count;
  }, [results, loading]);

  const hasVisibleIgnoredLocation = parsed.chips.some(
    (c, i) => c.kind === "ignoredLocation" && !removedChipIndices.has(i),
  );
  const visibleWarnings = hasVisibleIgnoredLocation
    ? parsed.warnings
    : parsed.warnings.filter((w) => w !== LOCATION_WARNING);

  return (
    <div>
      <SearchBar
        query={queryText}
        onQueryChange={handleQueryChange}
        showRetracted={showRetracted}
        onShowRetractedChange={(show) => {
          setShowRetracted(show);
          setVisibleCount(PAGE_SIZE);
        }}
        micDisabled={offline}
        micDisabledReason="Voice search needs signal — type instead."
      />

      {parsed.chips.length > 0 && (
        <div className="ask-chips-row">
          <span className="ask-chips-label">Heard:</span>
          {parsed.chips.map((chip, i) =>
            removedChipIndices.has(i) ? null : (
              <button
                key={`${chip.kind}-${i}-${chip.matchedText}`}
                type="button"
                className={`ask-chip ask-chip-${chip.kind}`}
                onClick={() => removeChip(i)}
                aria-label={`Remove ${chip.value}`}
                title={`Remove ${chip.value}`}
              >
                {chip.value} <span aria-hidden="true">×</span>
              </button>
            ),
          )}
        </div>
      )}

      {visibleWarnings.length > 0 && (
        <div className="ask-warnings">
          {visibleWarnings.map((w, i) => (
            <div key={i} className="ask-warning">
              {w}
            </div>
          ))}
        </div>
      )}

      {summaryText && <div className="ask-summary">{summaryText}</div>}

      {loading && <p>Loading&hellip;</p>}

      {!loading && results.length === 0 && (
        <div className="ask-empty">
          {parsed.chips.length === 0 ? (
            <p>No entries yet. Tap Record to add your first log.</p>
          ) : (
            <>
              <p>No matches.</p>
              {looseners.length > 0 && (
                <div className="ask-looseners">
                  {looseners.map((l) => (
                    <button key={l.key} type="button" className="ask-loosener" onClick={l.onClick}>
                      {l.label}
                    </button>
                  ))}
                </div>
              )}
              {showProbe && (
                <div className="ask-probe">
                  Nothing mentions &ldquo;{activeParams.text}&rdquo; with these filters —{" "}
                  {probeResults.length} entries without it.{" "}
                  <button
                    type="button"
                    className="ask-loosener"
                    onClick={() => {
                      const textChipIndex = parsed.chips.findIndex((c) => c.kind === "text");
                      if (textChipIndex >= 0) removeChip(textChipIndex);
                    }}
                  >
                    Show those
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {results.map((entry) => (
        <LogCard key={entry.id} entry={entry} />
      ))}

      {results.length >= visibleCount && (
        <button className="btn" onClick={() => setVisibleCount((n) => n + PAGE_SIZE)}>
          Load more&hellip;
        </button>
      )}
    </div>
  );
}
