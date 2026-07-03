import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { WebSpeechTranscriber } from "../../src/services/webspeech";

type Listener = (ev: unknown) => void;

/** Minimal fake SpeechRecognition — enough to drive onresult/onerror/onend. */
class FakeSpeechRecognition {
  continuous = false;
  interimResults = false;
  lang = "en-US";
  onresult: Listener | null = null;
  onerror: Listener | null = null;
  onend: (() => void) | null = null;
  started = 0;

  start() {
    this.started++;
  }
  stop() {
    this.onend?.();
  }
}

let fakeInstance: FakeSpeechRecognition;

beforeEach(() => {
  fakeInstance = new FakeSpeechRecognition();
  (window as unknown as { SpeechRecognition: unknown }).SpeechRecognition = function (
    this: FakeSpeechRecognition,
  ) {
    return fakeInstance;
  };
});

afterEach(() => {
  delete (window as unknown as { SpeechRecognition?: unknown }).SpeechRecognition;
});

describe("WebSpeechTranscriber — offline/network-failure detection", () => {
  it("hadNetworkError is false on a clean session with no errors", () => {
    const t = new WebSpeechTranscriber();
    t.start();
    const result = t.stop();
    expect(t.hadNetworkError).toBe(false);
    expect(result.text).toBe("");
  });

  it("hadNetworkError is false for benign errors like no-speech", () => {
    const t = new WebSpeechTranscriber();
    t.start();
    fakeInstance.onerror?.({ error: "no-speech" });
    t.stop();
    expect(t.hadNetworkError).toBe(false);
  });

  it("hadNetworkError is true after a network error — this is the offline-at-sea case", () => {
    const t = new WebSpeechTranscriber();
    t.start();
    fakeInstance.onerror?.({ error: "network" });
    const result = t.stop();
    expect(t.hadNetworkError).toBe(true);
    expect(result.text).toBe(""); // still an empty result — the flag is what distinguishes it
  });

  it("resets hadNetworkError on a fresh start() (previous session's failure doesn't leak)", () => {
    const t = new WebSpeechTranscriber();
    t.start();
    fakeInstance.onerror?.({ error: "network" });
    t.stop();
    expect(t.hadNetworkError).toBe(true);

    fakeInstance = new FakeSpeechRecognition();
    (window as unknown as { SpeechRecognition: unknown }).SpeechRecognition = function (
      this: FakeSpeechRecognition,
    ) {
      return fakeInstance;
    };
    t.start();
    expect(t.hadNetworkError).toBe(false);
  });
});
