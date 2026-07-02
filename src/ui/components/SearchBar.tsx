import type { EntityType } from "../../core/types/log-entry";

export interface SearchFilters {
  text: string;
  dateRange: "all" | "today" | "week";
  entityType: EntityType | "all";
}

const ENTITY_OPTIONS: { value: EntityType | "all"; label: string }[] = [
  { value: "all", label: "All tags" },
  { value: "species", label: "Species" },
  { value: "gear", label: "Gear" },
  { value: "depth", label: "Depth" },
  { value: "weather", label: "Weather" },
];

export function SearchBar({
  filters,
  onChange,
}: {
  filters: SearchFilters;
  onChange: (filters: SearchFilters) => void;
}) {
  return (
    <div className="search-bar">
      <input
        type="search"
        placeholder="Search transcripts..."
        value={filters.text}
        onChange={(e) => onChange({ ...filters, text: e.target.value })}
      />
      <div className="search-filters">
        <select
          value={filters.dateRange}
          onChange={(e) => onChange({ ...filters, dateRange: e.target.value as SearchFilters["dateRange"] })}
        >
          <option value="all">All time</option>
          <option value="today">Today</option>
          <option value="week">This week</option>
        </select>
        <select
          value={filters.entityType}
          onChange={(e) =>
            onChange({ ...filters, entityType: e.target.value as SearchFilters["entityType"] })
          }
        >
          {ENTITY_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
