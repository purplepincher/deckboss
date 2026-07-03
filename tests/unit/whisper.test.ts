import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  transcribeWithWhisper,
  WhisperApiError,
  WhisperNetworkError,
} from "../../src/services/whisper";

// jsdom's FormData rejects Node's Blob (which the test suite uses for
// structuredClone compatibility) — see tests/setup.ts. Whisper only needs a
// FormData that can hold its fields for the fetch body; a minimal fake is
// enough for unit-testing the network/API error paths.
class FakeFormData {
  private data = new Map<string, { value: unknown; filename?: string }>();
  append(key: string, value: unknown, filename?: string) {
    this.data.set(key, { value, filename });
  }
}

describe("transcribeWithWhisper", () => {
  const originalFetch = globalThis.fetch;
  const originalFormData = globalThis.FormData;

  beforeEach(() => {
    globalThis.fetch = vi.fn();
    globalThis.FormData = FakeFormData as unknown as typeof FormData;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    globalThis.FormData = originalFormData;
  });

  it("returns a TranscriptResult on a successful API response", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(JSON.stringify({ text: "crab pots in fifty fathoms" }), { status: 200 }),
    );

    const result = await transcribeWithWhisper(new Blob(["audio"]), "sk-test");

    expect(result.text).toBe("crab pots in fifty fathoms");
    expect(result.confidence).toBe(0.95);
    expect(result.engine).toBe("whisper-1");
  });

  it("throws WhisperApiError for a reachable server that returns an error status", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(JSON.stringify({ error: "Invalid API key" }), { status: 401 }),
    );

    await expect(transcribeWithWhisper(new Blob(["audio"]), "sk-bad")).rejects.toBeInstanceOf(
      WhisperApiError,
    );
  });

  it("throws WhisperNetworkError when fetch never reaches the network", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockRejectedValue(
      new TypeError("Failed to fetch"),
    );

    await expect(transcribeWithWhisper(new Blob(["audio"]), "sk-test")).rejects.toBeInstanceOf(
      WhisperNetworkError,
    );
  });
});
