/**
 * A fisherman with wet gloves who taps stop and pockets the phone
 * immediately may never look at the screen again for that capture — the
 * "Saved" label alone isn't unmissable. A distinct haptic pattern is a
 * second, glove-proof confirmation channel. Silently no-ops where
 * unsupported (iOS Safari has no Vibration API at all) — this is a bonus
 * signal, never the only one.
 */
export function vibrateSaved(): void {
  navigator.vibrate?.(60);
}

export function vibrateFailed(): void {
  navigator.vibrate?.([60, 80, 60]);
}
