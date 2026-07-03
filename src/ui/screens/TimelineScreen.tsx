import { useMemo, useState } from "react";
import { useTensorLog } from "../hooks/useTensorLog";
import { LogCard } from "../components/LogCard";
import { SearchBar, type SearchFilters } from "../components/SearchBar";
import type { QueryParams } from "../../core/tensor-log/query-engine";

const PAGE_SIZE = 20;

function dateRangeToDates(range: SearchFilters["dateRange"]): { startDate?: Date } {
  if (range === "today") {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return { startDate: d };
  }
  if (range === "week") {
    const d = new Date();
    d.setDate(d.getDate() - 7);
    return { startDate: d };
  }
  return {};
}

// Exported (pure, no React) so the filters->QueryParams mapping — in
// particular that "Show retracted" actually flips `includeRetracted` — can
// be unit tested without a component-rendering harness, matching how the
// rest of this codebase tests logic (see tests/unit/*.test.ts).
export function filtersToQueryParams(filters: SearchFilters, limit: number): QueryParams {
  const { startDate } = dateRangeToDates(filters.dateRange);
  return {
    text: filters.text || undefined,
    startDate,
    entities: filters.entityType === "all" ? undefined : [filters.entityType],
    includeRetracted: filters.showRetracted,
    limit,
  };
}

export function TimelineScreen() {
  const [filters, setFilters] = useState<SearchFilters>({
    text: "",
    dateRange: "all",
    entityType: "all",
    showRetracted: false,
  });
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  const params: QueryParams = useMemo(
    () => filtersToQueryParams(filters, visibleCount),
    [filters, visibleCount],
  );

  const { results, loading } = useTensorLog(params);

  return (
    <div>
      <SearchBar
        filters={filters}
        onChange={(f) => {
          setFilters(f);
          setVisibleCount(PAGE_SIZE);
        }}
      />

      {loading && <p>Loading…</p>}
      {!loading && results.length === 0 && <p>No entries yet. Tap Record to add your first log.</p>}

      {results.map((entry) => (
        <LogCard key={entry.id} entry={entry} />
      ))}

      {results.length >= visibleCount && (
        <button className="btn" onClick={() => setVisibleCount((n) => n + PAGE_SIZE)}>
          Load more…
        </button>
      )}
    </div>
  );
}
