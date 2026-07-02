import type { GPSReading } from "../core/types/log-entry";

const EARTH_RADIUS_KM = 6371;

/** Haversine great-circle distance in km — used by query-engine's `near` filter. */
export function distanceKm(
  a: { lat: number; lon: number },
  b: { lat: number; lon: number },
): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);

  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(h));
}

export function formatLatLon(gps: Pick<GPSReading, "latitude" | "longitude">): string {
  const latDir = gps.latitude >= 0 ? "N" : "S";
  const lonDir = gps.longitude >= 0 ? "E" : "W";
  return `${Math.abs(gps.latitude).toFixed(4)}°${latDir}, ${Math.abs(gps.longitude).toFixed(4)}°${lonDir}`;
}

/** GPS accuracy above this is flagged in the UI but never blocks recording. */
export const POOR_ACCURACY_THRESHOLD_M = 50;

export function isPoorAccuracy(gps: GPSReading | null): boolean {
  return gps !== null && gps.accuracy > POOR_ACCURACY_THRESHOLD_M;
}
