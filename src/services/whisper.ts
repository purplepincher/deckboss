import type { TranscriptResult } from "../core/types/log-entry";

export class WhisperApiError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "WhisperApiError";
  }
}

/**
 * Thrown when the fetch to OpenAI never reached the network — the device is
 * offline, DNS failed, the connection dropped, etc. Distinct from a HTTP 4xx/5xx
 * response (WhisperApiError) because those are permanent/config problems, not
 * coverage problems. The caller uses this to queue a retry for when the boat is
 * back in cell range rather than giving up on the transcript forever.
 */
export class WhisperNetworkError extends Error {
  constructor(message = "Could not reach the Whisper API.") {
    super(message);
    this.name = "WhisperNetworkError";
  }
}

/**
 * Opt-in transcription upgrade (see config/schema.ts: Phase 1 default is
 * Web Speech, this is the Settings-screen upgrade path). The key never
 * leaves the browser except in this one direct call to OpenAI — no
 * PurplePincher server sits in between, matching SAFETY/privacy §11.1:
 * "the user's own API key."
 */
export async function transcribeWithWhisper(
  blob: Blob,
  apiKey: string,
  language = "en",
): Promise<TranscriptResult> {
  const form = new FormData();
  form.append("file", blob, `audio.${blob.type.includes("mp4") ? "m4a" : "webm"}`);
  form.append("model", "whisper-1");
  if (language) form.append("language", language);

  let res: Response;
  try {
    res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
    });
  } catch {
    // fetch() only throws when it couldn't complete the request at the
    // transport layer — exactly the offline-at-sea case. A reachable server
    // that returns an error status still resolves normally and is handled
    // below as a WhisperApiError.
    throw new WhisperNetworkError("Could not reach the Whisper API — will retry when online.");
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new WhisperApiError(`Whisper API error ${res.status}: ${body}`, res.status);
  }

  const data = (await res.json()) as { text: string };
  // The basic transcriptions endpoint doesn't return a confidence score;
  // 0.95 reflects Whisper's typical accuracy rather than a measured value —
  // shown in UI as "high confidence" rather than a bogus precise number.
  return { text: data.text.trim(), confidence: 0.95, language, engine: "whisper-1" };
}
