import { useEffect, useRef, useState } from "react";
import { WebSpeechTranscriber, isWebSpeechSupported } from "../../services/webspeech";

// Safety cap: if the user forgets to tap the mic again, stop listening
// automatically rather than leaving the mic open indefinitely. The design
// memo calls for ~1.5s-of-silence auto-stop, but the v1 WebSpeech wrapper
// has no silence event, so a fixed ceiling is the honest substitute.
const MIC_TIMEOUT_MS = 10_000;

export interface SearchBarProps {
  query: string;
  onQueryChange: (query: string) => void;
  showRetracted: boolean;
  onShowRetractedChange: (show: boolean) => void;
  micDisabled?: boolean;
  micDisabledReason?: string;
}

export function SearchBar({
  query,
  onQueryChange,
  showRetracted,
  onShowRetractedChange,
  micDisabled = false,
  micDisabledReason,
}: SearchBarProps) {
  const [listening, setListening] = useState(false);
  const transcriberRef = useRef<WebSpeechTranscriber | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const webSpeechSupported = isWebSpeechSupported();

  useEffect(() => {
    return () => {
      transcriberRef.current?.stop();
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  const stopListening = () => {
    const t = transcriberRef.current;
    if (!t) return;
    const result = t.stop();
    transcriberRef.current = null;
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    setListening(false);
    if (result.text) {
      onQueryChange(result.text);
    }
  };

  const startListening = () => {
    if (!webSpeechSupported || micDisabled) return;
    const t = new WebSpeechTranscriber();
    transcriberRef.current = t;
    t.start();
    setListening(true);
    timeoutRef.current = setTimeout(() => {
      stopListening();
    }, MIC_TIMEOUT_MS);
  };

  const handleMicClick = () => {
    if (listening) {
      stopListening();
    } else {
      startListening();
    }
  };

  const micAvailable = webSpeechSupported && !micDisabled;
  const micTitle = micDisabled
    ? micDisabledReason || "Voice search unavailable"
    : webSpeechSupported
      ? listening
        ? "Tap to stop listening"
        : "Tap to search by voice"
      : "Voice search not supported in this browser";

  return (
    <div className="search-bar">
      <div className="ask-input-row">
        <input
          type="search"
          className="ask-search-input"
          placeholder="Ask your log..."
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          aria-label="Ask your log"
        />
        <button
          type="button"
          className={`ask-mic-button ${listening ? "listening" : ""} ${!micAvailable ? "disabled" : ""}`}
          onClick={handleMicClick}
          disabled={!micAvailable}
          aria-label={micTitle}
          title={micTitle}
        >
          🎤
        </button>
      </div>
      {listening && <div className="ask-listening-label">Listening&hellip;</div>}
      <label className="search-retracted-toggle">
        <input
          type="checkbox"
          checked={showRetracted}
          onChange={(e) => onShowRetractedChange(e.target.checked)}
        />
        Show retracted
      </label>
    </div>
  );
}
