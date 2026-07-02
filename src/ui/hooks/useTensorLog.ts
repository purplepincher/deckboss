import { useEffect, useMemo } from "react";
import { useDeckBossStore } from "../../state/store";
import { queryEntries, type QueryParams } from "../../core/tensor-log/query-engine";

export function useTensorLog(params: QueryParams = {}) {
  const entries = useDeckBossStore((s) => s.entries);
  const entriesLoaded = useDeckBossStore((s) => s.entriesLoaded);
  const loadEntries = useDeckBossStore((s) => s.loadEntries);

  useEffect(() => {
    if (!entriesLoaded) void loadEntries();
  }, [entriesLoaded, loadEntries]);

  // Stable string key so a fresh params object every render doesn't
  // re-filter on every keystroke of an unrelated component.
  const paramsKey = JSON.stringify(params);
  const results = useMemo(
    () => queryEntries(entries, params),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [entries, paramsKey],
  );

  return { results, loading: !entriesLoaded, refresh: loadEntries };
}
