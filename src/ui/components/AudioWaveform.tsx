import { useEffect, useRef, useState } from "react";
import { AudioPlayer } from "../../core/audio/player";

export function AudioWaveform({ blob }: { blob: Blob | null }) {
  const playerRef = useRef<AudioPlayer | null>(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  useEffect(() => {
    if (!blob) return;
    const player = new AudioPlayer();
    player.load(blob);
    playerRef.current = player;

    const offTime = player.onTimeUpdate(setCurrentTime);
    const offEnded = player.onEnded(() => setPlaying(false));

    return () => {
      offTime();
      offEnded();
      player.dispose();
      playerRef.current = null;
    };
  }, [blob]);

  if (!blob) return null;

  const toggle = () => {
    const player = playerRef.current;
    if (!player) return;
    if (playing) {
      player.pause();
    } else {
      if (duration === 0) setDuration(player.duration || 0);
      player.play();
    }
    setPlaying(!playing);
  };

  return (
    <div className="audio-waveform">
      <button onClick={toggle} aria-label={playing ? "Pause" : "Play"}>
        {playing ? "❚❚" : "▶"}
      </button>
      <input
        type="range"
        min={0}
        max={playerRef.current?.duration || 1}
        step={0.1}
        value={currentTime}
        onChange={(e) => playerRef.current?.seekTo(Number(e.target.value))}
      />
      <span>{Math.round(currentTime)}s</span>
    </div>
  );
}
