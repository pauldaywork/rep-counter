/**
 * Which mic the dropdown should select after its list changes: the current
 * one if still connected, else the last used one, else the first.
 */
export function pickMic(labels: string[], current: string | null, lastMic: string | undefined): string | null {
  if (current !== null && labels.includes(current)) return current;
  if (lastMic !== undefined && labels.includes(lastMic)) return lastMic;
  return labels[0] ?? null;
}
