import { playDing } from "./chime";
import { countdown } from "./countdown";
import { el, message } from "./dom";
import { logId } from "./logs";
import type { ActivityBase, Workout, WorkoutLibrary } from "./store-schema";
import {
  createWorkout,
  deleteWorkout,
  moveActivity,
  nameTaken,
  replaceWorkout,
  selectedWorkout,
  setsDone,
  type Step,
  workoutSteps,
} from "./workout";

/** Status, errors and running one flow at a time. App does this on the mic pages. */
export interface PageHost {
  /** Runs one flow at a time, showing any error it ends with. */
  run(flow: () => Promise<void>): Promise<void>;
  /** Disables these controls whenever a flow is running. */
  lockWhileBusy(...controls: { disabled: boolean }[]): void;
  setStatus(text: string): void;
  showError(text: string): void;
}

/** What differs between workouts of counted reps and workouts of timed sets. */
export interface WorkoutKind<A extends ActivityBase> {
  /** the id of the add-activity form's field for each set's reps or seconds */
  amountField: string;
  /** where the workouts are saved, for errors */
  file: string;
  load(): Promise<WorkoutLibrary<A>>;
  save(library: WorkoutLibrary<A>): Promise<void>;
  /** Reads the add-activity form's fields, or says what's wrong with them. */
  parse(name: string, amount: string, sets: string): A | string;
  describeActivity(activity: A): string;
  describeStep(step: Step<A>): string;
  /** Shows what the next set asks for before it starts, or clears it when there is none. */
  showUpcoming(step: Step<A> | undefined): void;
  /** Runs one set. Called inside the host's `run`. */
  runSet(step: Step<A>, run: { runId: string; workout: string }): Promise<void>;
  /** Ends the running set early, for End workout. */
  stopSet(): void;
}

/** How far through the workout a run has got, kept after an error so it can resume. */
interface Progress {
  runId: string;
  /** steps finished */
  step: number;
}

function pageElements(amountField: string) {
  return {
    builder: el<HTMLFieldSetElement>("builder"),
    select: el<HTMLSelectElement>("workout-select"),
    newWorkout: el<HTMLButtonElement>("new-workout"),
    deleteWorkout: el<HTMLButtonElement>("delete-workout"),
    workoutName: el<HTMLInputElement>("workout-name"),
    activities: el<HTMLOListElement>("activities"),
    noActivities: el<HTMLParagraphElement>("no-activities"),
    addForm: el<HTMLFormElement>("add-activity"),
    name: el<HTMLInputElement>("activity-name"),
    amount: el<HTMLInputElement>(amountField),
    sets: el<HTMLInputElement>("activity-sets"),
    rest: el<HTMLInputElement>("rest"),
    alternateSets: el<HTMLInputElement>("alternate-sets"),
    start: el<HTMLButtonElement>("start"),
    restart: el<HTMLButtonElement>("restart"),
    now: el<HTMLParagraphElement>("now"),
    workoutControls: el<HTMLDivElement>("workout-controls"),
    skipRest: el<HTMLButtonElement>("skip-rest"),
    endWorkout: el<HTMLButtonElement>("end-workout"),
  };
}

/** The workout builder and runner shared by the routine and simple pages. */
export class WorkoutPage<A extends ActivityBase> {
  private readonly host: PageHost;
  private readonly kind: WorkoutKind<A>;
  private readonly ui: ReturnType<typeof pageElements>;
  private library: WorkoutLibrary<A> = { workouts: [] };
  /** the shown workout, always one of the library's */
  private workout: Workout<A> = createWorkout(this.library, crypto.randomUUID());
  /** false when the saved workouts couldn't be read, so saving can't overwrite them */
  private loaded = false;
  /** the latest save, so saves land in order */
  private saving: Promise<void> = Promise.resolve();
  private progress: Progress | null = null;
  private running = false;
  private endRequested = false;
  /** Ends the current rest early. */
  private endRest: (() => void) | null = null;

  constructor(host: PageHost, kind: WorkoutKind<A>) {
    this.host = host;
    this.kind = kind;
    this.ui = pageElements(kind.amountField);
  }

  async init(): Promise<void> {
    // Only the start buttons lock with the host; the builder is disabled while a workout runs.
    this.host.lockWhileBusy(this.ui.start, this.ui.restart);
    this.ui.select.addEventListener("change", () => this.choose(this.ui.select.value));
    this.ui.newWorkout.addEventListener("click", () => this.newWorkout());
    this.ui.deleteWorkout.addEventListener("click", () => this.deleteWorkout());
    this.ui.workoutName.addEventListener("change", () => this.rename());
    this.ui.addForm.addEventListener("submit", (event) => {
      event.preventDefault();
      this.addActivity();
    });
    this.ui.rest.addEventListener("change", () => {
      const rest = Number(this.ui.rest.value);
      if (!Number.isInteger(rest) || rest < 0) {
        this.host.showError("Enter a rest of 0 seconds or more.");
        this.ui.rest.value = String(this.workout.restSeconds);
        return;
      }
      this.update({ ...this.workout, restSeconds: rest });
    });
    this.ui.alternateSets.addEventListener("change", () =>
      this.update({ ...this.workout, alternateSets: this.ui.alternateSets.checked }),
    );
    this.ui.start.addEventListener("click", () => void this.host.run(() => this.runWorkout()));
    this.ui.restart.addEventListener("click", () => {
      this.progress = null;
      this.render();
      this.showNext();
    });
    this.ui.skipRest.addEventListener("click", () => this.endRest?.());
    this.ui.endWorkout.addEventListener("click", () => {
      this.endRequested = true;
      this.kind.stopSet();
      this.endRest?.();
    });

    try {
      this.library = await this.kind.load();
      this.loaded = true;
    } catch (err) {
      this.host.showError(`Couldn't load the saved workouts: ${message(err)}`);
    }
    // With nothing saved yet, start a first workout. It's saved once it's changed.
    const shown = selectedWorkout(this.library);
    if (shown) this.workout = shown;
    else this.library = { lastWorkout: this.workout.id, workouts: [this.workout] };
    this.render();
    this.showNext();
  }

  // ---- choosing ----

  private choose(id: string): void {
    const chosen = this.library.workouts.find((w) => w.id === id);
    if (!chosen) return;
    this.workout = chosen;
    this.library = { ...this.library, lastWorkout: id };
    this.shown();
  }

  private newWorkout(): void {
    const workout = createWorkout(this.library, crypto.randomUUID());
    this.library = { lastWorkout: workout.id, workouts: [...this.library.workouts, workout] };
    this.workout = workout;
    this.shown();
    this.ui.workoutName.select();
  }

  private deleteWorkout(): void {
    const { name, activities } = this.workout;
    if (activities.length > 0 && !confirm(`Delete the workout "${name}"?`)) return;
    let library = deleteWorkout(this.library, this.workout.id);
    let next = selectedWorkout(library);
    if (!next) {
      next = createWorkout(library, crypto.randomUUID());
      library = { lastWorkout: next.id, workouts: [next] };
    }
    this.library = library;
    this.workout = next;
    this.shown();
  }

  private rename(): void {
    const name = this.ui.workoutName.value.trim();
    let problem: string | null = null;
    if (name === "") problem = "Enter a name for the workout.";
    else if (nameTaken(this.library, name, this.workout.id)) problem = `There's already a workout called "${name}".`;
    if (problem) {
      this.host.showError(problem);
      this.ui.workoutName.value = this.workout.name;
      return;
    }
    this.update({ ...this.workout, name });
  }

  /** Shows a newly chosen workout and saves the choice. A run part-way through the old one can't resume. */
  private shown(): void {
    this.progress = null;
    this.render();
    this.showNext();
    void this.save();
  }

  // ---- building ----

  private addActivity(): void {
    const activity = this.kind.parse(this.ui.name.value, this.ui.amount.value, this.ui.sets.value);
    if (typeof activity === "string") {
      this.host.showError(activity);
      return;
    }
    this.update({ ...this.workout, activities: [...this.workout.activities, activity] });
    // Keep the amount and sets, since the next activity often matches them.
    this.ui.name.value = "";
    this.ui.name.focus();
  }

  /** Shows and saves a change to the shown workout. */
  private update(workout: Workout<A>): void {
    this.workout = workout;
    this.library = replaceWorkout(this.library, workout);
    this.shown();
  }

  /** Saves the whole library. Saves queue, so an older one can never land after a newer one. */
  private save(): Promise<void> {
    if (!this.loaded) {
      this.host.showError(`Not saving, since the saved workouts couldn't be loaded. Fix ${this.kind.file} and reload.`);
      return Promise.resolve();
    }
    const library = this.library;
    this.saving = this.saving.then(() =>
      this.kind.save(library).catch((err: unknown) => this.host.showError(`Couldn't save the workouts: ${message(err)}`)),
    );
    return this.saving;
  }

  // ---- running ----

  private async runWorkout(): Promise<void> {
    const workout = this.workout;
    const steps = workoutSteps(workout);
    if (steps.length === 0) throw new Error("Add an activity to the workout first.");
    const progress = this.progress ?? { runId: logId(new Date()), step: 0 };
    this.progress = progress;
    this.running = true;
    this.ui.builder.disabled = true;
    this.endRequested = false;
    this.ui.workoutControls.hidden = false;
    try {
      while (progress.step < steps.length && !this.endRequested) {
        const step = steps[progress.step];
        this.ui.now.textContent = this.kind.describeStep(step);
        this.host.setStatus("Get ready…");
        this.render();
        await this.kind.runSet(step, { runId: progress.runId, workout: workout.name });
        progress.step++;
        this.render();
        if (progress.step < steps.length && !this.endRequested) await this.rest(steps[progress.step], workout.restSeconds);
      }
      this.progress = null;
      this.ui.now.textContent = this.endRequested ? "Workout ended" : "Workout complete";
      this.host.setStatus(this.endRequested ? "Ready" : "Well done!");
    } finally {
      this.running = false;
      this.ui.builder.disabled = false;
      this.endRest = null;
      this.ui.skipRest.hidden = true;
      this.ui.workoutControls.hidden = true;
      this.render();
      // After an error, show where Resume picks up.
      if (this.progress) this.showNext();
    }
  }

  /** Counts down the rest before `next` and dings when it's over, or with no rest set, waits for Start next set. */
  private async rest(next: Step<A>, seconds: number): Promise<void> {
    this.ui.now.textContent = `Next: ${this.kind.describeStep(next)}`;
    this.kind.showUpcoming(next);
    this.ui.skipRest.textContent = seconds === 0 ? "Start next set" : "Skip rest";
    this.ui.skipRest.hidden = false;
    let finished: Promise<boolean>;
    if (seconds === 0) {
      this.host.setStatus("Rest. Press Start next set when you're ready.");
      finished = new Promise((resolve) => (this.endRest = () => resolve(false)));
    } else {
      const timer = countdown(seconds, (left) => this.host.setStatus(`Rest: ${left} s`));
      this.endRest = timer.stop;
      finished = timer.finished;
    }
    const timeUp = await finished;
    this.endRest = null;
    this.ui.skipRest.hidden = true;
    if (timeUp) playDing();
  }

  // ---- rendering ----

  private render(): void {
    this.ui.select.replaceChildren(...this.library.workouts.map((w) => new Option(w.name, w.id)));
    this.ui.select.value = this.workout.id;
    this.ui.workoutName.value = this.workout.name;
    this.ui.rest.value = String(this.workout.restSeconds);
    this.ui.alternateSets.checked = this.workout.alternateSets ?? false;
    const steps = workoutSteps(this.workout);
    const done = this.progress?.step ?? 0;
    const current = this.running ? steps[done]?.activityIndex : undefined;
    this.ui.activities.replaceChildren(
      ...this.workout.activities.map((activity, i) => {
        const item = document.createElement("li");
        const finished = setsDone(steps, done, i);
        item.classList.toggle("current", i === current);
        item.classList.toggle("done", finished === activity.sets);
        const name = document.createElement("span");
        name.className = "activity-name";
        name.textContent = activity.name;
        const detail = document.createElement("span");
        detail.className = "activity-detail";
        detail.textContent = this.kind.describeActivity(activity);
        if (this.progress) detail.textContent += finished === activity.sets ? " · ✓" : ` · ${finished}/${activity.sets} sets done`;
        item.append(
          name,
          detail,
          button("↑", `Move ${activity.name} up`, () => this.update(moveActivity(this.workout, i, i - 1))),
          button("↓", `Move ${activity.name} down`, () => this.update(moveActivity(this.workout, i, i + 1))),
          button("✕", `Remove ${activity.name}`, () =>
            this.update({ ...this.workout, activities: this.workout.activities.filter((_, j) => j !== i) }),
          ),
        );
        return item;
      }),
    );
    this.ui.noActivities.hidden = this.workout.activities.length > 0;
    this.ui.start.textContent = this.progress && !this.running ? "Resume workout" : "Start workout";
    this.ui.restart.hidden = !this.progress || this.running;
  }

  /** Shows the set the start button will run. */
  private showNext(): void {
    const next = workoutSteps(this.workout)[this.progress?.step ?? 0];
    this.ui.now.textContent = next ? `${this.progress ? "Next" : "First"}: ${this.kind.describeStep(next)}` : "";
    this.kind.showUpcoming(next);
  }
}

function button(text: string, label: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement("button");
  b.type = "button";
  b.textContent = text;
  b.title = label;
  b.setAttribute("aria-label", label);
  b.addEventListener("click", onClick);
  return b;
}
