import type { GPSReading } from "../../core/types/log-entry";
import { formatLatLon, isPoorAccuracy } from "../../utils/gps";

export function GPSBadge({ gps }: { gps: GPSReading | null }) {
  if (!gps) {
    return (
      <span className="gps-badge">
        <span className="status-dot warn" /> No GPS
      </span>
    );
  }

  const poor = isPoorAccuracy(gps);
  return (
    <span className="gps-badge" title={`Accuracy: ${gps.accuracy.toFixed(1)}m`}>
      <span className={`status-dot ${poor ? "warn" : "ok"}`} />
      {formatLatLon(gps)}
      {poor ? " (weak fix)" : ""}
    </span>
  );
}
