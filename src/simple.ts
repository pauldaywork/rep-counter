import "./style.css";
import { playDing } from "./chime";
import { countdown } from "./countdown";
import { el, message } from "./dom";
import { createSimpleStore } from "./store";
import type { TimedActivity } from "./store-schema";
import { describeTimedActivity, describeTimedStep, parseTimedActivity } from "./workout";
import { type PageHost, WorkoutPage } from "./workout-page";

// No mic on this page: each set is a countdown, and only the workouts are saved, to data-simple/.
const api = createSimpleStore();

/** Status, errors and one run at a time, as App gives the mic pages. */
class SimpleHost implements PageHost {
  private readonly status = el<HTMLParagraphElement>("status");
  private readonly error = el<HTMLParagraphElement>("error");
  private readonly controls: { disabled: boolean }[] = [];
  private busy = false;

  lockWhileBusy(...controls: { disabled: boolean }[]): void {
    this.controls.push(...controls);
    for (const control of controls) control.disabled = this.busy;
  }

  async run(flow: () => Promise<void>): Promise<void> {
    if (this.busy) return;
    this.setBusy(true);
    this.error.hidden = true;
    try {
      await flow();
    } catch (err) {
      this.setStatus("Ready");
      this.showError(message(err));
    } finally {
      this.setBusy(false);
    }
  }

  setStatus(text: string): void {
    this.status.textContent = text;
  }

  showError(text: string): void {
    this.error.textContent = text;
    this.error.hidden = false;
  }

  private setBusy(busy: boolean): void {
    this.busy = busy;
    for (const control of this.controls) control.disabled = busy;
  }
}

const host = new SimpleHost();
const timeLeft = el<HTMLParagraphElement>("time-left");
/** Ends the running set's countdown early. */
let stopTimer: (() => void) | null = null;

void new WorkoutPage<TimedActivity>(host, {
  amountField: "activity-seconds",
  file: "data-simple/workouts.json",
  load: () => api.loadWorkouts(),
  save: (library) => api.saveWorkouts(library),
  parse: parseTimedActivity,
  describeActivity: describeTimedActivity,
  describeStep: describeTimedStep,
  showUpcoming: (step) => {
    timeLeft.textContent = String(step?.seconds ?? 0);
  },
  runSet: async (step) => {
    const timer = countdown(step.seconds, (left) => {
      timeLeft.textContent = String(left);
    });
    stopTimer = timer.stop;
    // The cue to start, after the wait, a rest or Skip rest alike.
    playDing();
    host.setStatus("Go!");
    const timeUp = await timer.finished;
    stopTimer = null;
    timeLeft.textContent = "0";
    // The cue to stop. To drop this ding, delete the playDing() call.
    if (timeUp) {
      playDing();
      host.setStatus("Time's up");
    }
  },
  stopSet: () => stopTimer?.(),
  dingAfterRest: false,
}).init();
