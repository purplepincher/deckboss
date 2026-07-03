export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function mimeToExt(mime: string): string {
  const base = mime.split(";")[0]?.trim().toLowerCase() ?? "";
  switch (base) {
    case "audio/webm":
      return "webm";
    case "audio/mp4":
      return "m4a";
    case "audio/ogg":
      return "ogg";
    case "audio/wav":
      return "wav";
    default:
      return "bin";
  }
}

/** Reads audio duration via an off-DOM <audio> element (metadata-only, no full decode). */
export function readAudioDurationMs(blob: Blob): Promise<number> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const audio = new Audio();

    const cleanup = () => URL.revokeObjectURL(url);

    audio.addEventListener("loadedmetadata", () => {
      const ms = Number.isFinite(audio.duration) ? audio.duration * 1000 : 0;
      cleanup();
      resolve(ms);
    });
    audio.addEventListener("error", () => {
      cleanup();
      reject(new Error("Failed to read audio duration"));
    });

    audio.src = url;
  });
}
