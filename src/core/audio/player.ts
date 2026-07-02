/** Thin wrapper over HTMLAudioElement for entry playback with speed control. */
export class AudioPlayer {
  private audio: HTMLAudioElement | null = null;
  private objectUrl: string | null = null;

  load(blob: Blob): void {
    this.dispose();
    this.objectUrl = URL.createObjectURL(blob);
    this.audio = new Audio(this.objectUrl);
  }

  play(): void {
    void this.audio?.play();
  }

  pause(): void {
    this.audio?.pause();
  }

  seekTo(seconds: number): void {
    if (this.audio) this.audio.currentTime = seconds;
  }

  setPlaybackRate(rate: number): void {
    if (this.audio) this.audio.playbackRate = rate;
  }

  get duration(): number {
    return this.audio?.duration ?? 0;
  }

  get currentTime(): number {
    return this.audio?.currentTime ?? 0;
  }

  onTimeUpdate(cb: (currentTime: number) => void): () => void {
    const handler = () => cb(this.audio?.currentTime ?? 0);
    this.audio?.addEventListener("timeupdate", handler);
    return () => this.audio?.removeEventListener("timeupdate", handler);
  }

  onEnded(cb: () => void): () => void {
    this.audio?.addEventListener("ended", cb);
    return () => this.audio?.removeEventListener("ended", cb);
  }

  dispose(): void {
    this.audio?.pause();
    this.audio = null;
    if (this.objectUrl) {
      URL.revokeObjectURL(this.objectUrl);
      this.objectUrl = null;
    }
  }
}
