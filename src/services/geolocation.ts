import type { GPSReading } from "../core/types/log-entry";

export class GeolocationError extends Error {
  constructor(
    message: string,
    public readonly code?: number,
  ) {
    super(message);
    this.name = "GeolocationError";
  }
}

const DEFAULT_TIMEOUT_MS = 10_000;
const CACHE_TTL_MS = 60_000;

let lastReading: GPSReading | null = null;
let lastReadingAt = 0;

function fromPosition(pos: GeolocationPosition): GPSReading {
  return {
    latitude: pos.coords.latitude,
    longitude: pos.coords.longitude,
    accuracy: pos.coords.accuracy,
    altitude: pos.coords.altitude,
    heading: pos.coords.heading,
    speed: pos.coords.speed,
    timestamp: new Date(pos.timestamp).toISOString(),
    source: "gps",
  };
}

/**
 * Throws GeolocationError on failure/timeout/permission-denial — callers
 * (entry-builder via RecordScreen) catch this and pass `gps: null` rather
 * than letting a GPS failure block the recording. Serves a cached reading
 * (<=60s old) instead of a fresh hardware read when possible, per §7.6:
 * marine tablets have limited battery and repeated high-accuracy fixes are
 * expensive.
 */
export async function getCurrentPosition(
  options: { timeout?: number; maxAge?: number } = {},
): Promise<GPSReading> {
  if (!("geolocation" in navigator)) {
    throw new GeolocationError("Geolocation not supported in this browser.");
  }

  const maxAge = options.maxAge ?? CACHE_TTL_MS;
  if (lastReading && Date.now() - lastReadingAt < maxAge) {
    return lastReading;
  }

  return new Promise<GPSReading>((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const reading = fromPosition(pos);
        lastReading = reading;
        lastReadingAt = Date.now();
        resolve(reading);
      },
      (err) => reject(new GeolocationError(err.message, err.code)),
      { enableHighAccuracy: true, timeout: options.timeout ?? DEFAULT_TIMEOUT_MS, maximumAge: maxAge },
    );
  });
}

/**
 * Continuous position updates for the optional breadcrumb trail / map view.
 * Callers must pair this with document.visibilityState so it's only active
 * while the app is foregrounded — this module doesn't police that itself.
 */
export function watchPosition(
  callback: (reading: GPSReading) => void,
  onError?: (err: GeolocationError) => void,
): () => void {
  if (!("geolocation" in navigator)) {
    onError?.(new GeolocationError("Geolocation not supported in this browser."));
    return () => {};
  }

  const watchId = navigator.geolocation.watchPosition(
    (pos) => {
      const reading = fromPosition(pos);
      lastReading = reading;
      lastReadingAt = Date.now();
      callback(reading);
    },
    (err) => onError?.(new GeolocationError(err.message, err.code)),
    { enableHighAccuracy: true },
  );

  return () => navigator.geolocation.clearWatch(watchId);
}
