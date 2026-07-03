import { Link } from "react-router-dom";
import type { EffectiveLogEntry, EntityType } from "../../core/types/log-entry";
import { relativeTime, formatClock } from "../../utils/date";
import { formatLatLon } from "../../utils/gps";

const CHIP_CLASS: Partial<Record<EntityType, string>> = {
  gear: "gear",
  species: "species",
  weather: "alert",
};

export function LogCard({ entry, relative = true }: { entry: EffectiveLogEntry; relative?: boolean }) {
  // "No transcript yet" implies it's still coming — for the default Web
  // Speech engine that's usually not true (it only transcribes live, there's
  // no retry-later path once the recording stops), so the empty state has
  // to be honest: the audio is safe, there just isn't text for it.
  const preview = entry.transcript?.text?.slice(0, 80) || "No transcript — audio saved";

  return (
    <Link to={`/entry/${entry.id}`} className={`log-card ${entry.retracted ? "retracted" : ""}`}>
      <div className="log-card-top">
        <span>{relative ? relativeTime(entry.timestamp) : formatClock(entry.timestamp)}</span>
        <span>{entry.gps ? formatLatLon(entry.gps) : "no GPS"}</span>
      </div>
      <div className="log-card-text">
        {preview}
        {entry.transcript && entry.transcript.text.length > 80 ? "…" : ""}
      </div>
      <div className="log-card-chips">
        {entry.entities.slice(0, 4).map((e, i) => (
          <span key={i} className={`chip ${CHIP_CLASS[e.type] ?? ""}`}>
            {e.value}
          </span>
        ))}
        {entry.amended && <span className="chip">edited</span>}
      </div>
    </Link>
  );
}
