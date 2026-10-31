const TICK_MS = 250;

export interface Countdown {
  /** true once the time is up, false if stopped first */
  finished: Promise<boolean>;
  /** Ends the countdown early. Does nothing once it has finished. */
  stop(): void;
}

/**
 * Counts down `seconds`, calling `onTick` with the whole seconds left (rounded up)
 * straight away and about every 250 ms after, until the time is up or `stop` is called.
 */
export function countdown(seconds: number, onTick: (left: number) => void): Countdown {
  const endsAt = Date.now() + seconds * 1000;
  let timer: ReturnType<typeof setInterval> | undefined;
  let done = false;
  let settle: (timeUp: boolean) => void = () => {};
  const finished = new Promise<boolean>((resolve) => (settle = resolve));
  const end = (timeUp: boolean) => {
    if (done) return;
    done = true;
    clearInterval(timer);
    settle(timeUp);
  };
  const tick = () => {
    const left = Math.ceil((endsAt - Date.now()) / 1000);
    if (left > 0) onTick(left);
    else end(true);
  };
  tick();
  if (!done) timer = setInterval(tick, TICK_MS);
  return { finished, stop: () => end(false) };
}
