/**
 * Which mic the dropdown should select after its list changes: the last mic
 * the user chose if connected (so a reconnected headset is reselected), else
 * the current one if still connected, else the first.
 */
export function pickMic(labels: string[], current: string | null, lastMic: string | undefined): string | null {
  if (lastMic !== undefined && labels.includes(lastMic)) return lastMic;
  if (current !== null && labels.includes(current)) return current;
  return labels[0] ?? null;
}
