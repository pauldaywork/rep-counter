import type { Activity, ActivityBase, TimedActivity, Workout, WorkoutLibrary } from "./store-schema";

/**
 * One set of one activity, in the order the workout runs them: the activity's fields,
 * with its name as `activity`, its place in the workout and the set's number.
 */
export type Step<A extends ActivityBase> = Omit<A, "name"> & {
  activityIndex: number;
  activity: string;
  /** 1-based */
  set: number;
};

export type WorkoutStep = Step<Activity>;
export type TimedStep = Step<TimedActivity>;

/**
 * Every set of the workout in order: all of the first activity's sets, then the next activity's.
 * With alternateSets, each pair of activities takes turns a set at a time, then runs the longer one's
 * leftover sets in a row. An unpaired last activity runs on its own.
 */
export function workoutSteps<A extends ActivityBase>(workout: Workout<A>): Step<A>[] {
  const setsOf = (activityIndex: number): Step<A>[] => {
    const a = workout.activities[activityIndex];
    const { name, ...fields } = a;
    return Array.from({ length: a.sets }, (_, i) => ({ ...fields, activityIndex, activity: name, set: i + 1 }) as Step<A>);
  };
  if (!workout.alternateSets) return workout.activities.flatMap((_, i) => setsOf(i));
  const steps: Step<A>[] = [];
  for (let i = 0; i < workout.activities.length; i += 2) {
    const first = setsOf(i);
    const second = i + 1 < workout.activities.length ? setsOf(i + 1) : [];
    for (let set = 0; set < Math.max(first.length, second.length); set++) {
      if (set < first.length) steps.push(first[set]);
      if (set < second.length) steps.push(second[set]);
    }
  }
  return steps;
}

const reps = (n: number) => `${n} ${n === 1 ? "rep" : "reps"}`;

export function describeStep(step: WorkoutStep): string {
  return `${step.activity} · set ${step.set} of ${step.sets} · ${reps(step.reps)}`;
}

export function describeTimedStep(step: TimedStep): string {
  return `${step.activity} · set ${step.set} of ${step.sets} · ${step.seconds} s`;
}

export function describeActivity(activity: Activity): string {
  return `${activity.sets} × ${reps(activity.reps)}`;
}

export function describeTimedActivity(activity: TimedActivity): string {
  return `${activity.sets} × ${activity.seconds} s`;
}

/** How many of an activity's sets are among the first `completed` steps. */
export function setsDone(steps: { activityIndex: number }[], completed: number, activityIndex: number): number {
  return steps.slice(0, completed).filter((s) => s.activityIndex === activityIndex).length;
}

/** A whole number of at least 1 typed into a field, or null. */
function parseCount(text: string): number | null {
  const n = Number(text);
  return text.trim() !== "" && Number.isInteger(n) && n >= 1 ? n : null;
}

/** Reads the add-activity form's fields, or says what's wrong with them. */
export function parseActivity(name: string, reps: string, sets: string): Activity | string {
  const trimmed = name.trim();
  if (trimmed === "") return "Enter the activity's name.";
  const repCount = parseCount(reps);
  if (repCount === null) return "Enter at least 1 rep per set.";
  const setCount = parseCount(sets);
  if (setCount === null) return "Enter at least 1 set.";
  return { name: trimmed, reps: repCount, sets: setCount };
}

/** Reads the simple page's add-activity fields, or says what's wrong with them. */
export function parseTimedActivity(name: string, seconds: string, sets: string): TimedActivity | string {
  const trimmed = name.trim();
  if (trimmed === "") return "Enter the activity's name.";
  const secondCount = parseCount(seconds);
  if (secondCount === null) return "Enter at least 1 second per set.";
  const setCount = parseCount(sets);
  if (setCount === null) return "Enter at least 1 set.";
  return { name: trimmed, seconds: secondCount, sets: setCount };
}

/** The workout with activity `from` moved to position `to`. */
export function moveActivity<A extends ActivityBase>(workout: Workout<A>, from: number, to: number): Workout<A> {
  if (to < 0 || to >= workout.activities.length) return workout;
  const activities = [...workout.activities];
  const [moved] = activities.splice(from, 1);
  activities.splice(to, 0, moved);
  return { ...workout, activities };
}

/** An empty workout named "Workout N", with the lowest N no saved workout already uses. */
export function createWorkout<A extends ActivityBase>(library: WorkoutLibrary<A>, id: string): Workout<A> {
  let n = 1;
  while (nameTaken(library, `Workout ${n}`)) n++;
  return { id, name: `Workout ${n}`, activities: [], restSeconds: 60 };
}

/** Whether another workout already has this name, ignoring case and outer spaces. */
export function nameTaken(library: WorkoutLibrary<ActivityBase>, name: string, exceptId?: string): boolean {
  const wanted = name.trim().toLowerCase();
  return library.workouts.some((w) => w.id !== exceptId && w.name.trim().toLowerCase() === wanted);
}

/** The workout the page should show: the last one chosen, or else the first. */
export function selectedWorkout<A extends ActivityBase>(library: WorkoutLibrary<A>): Workout<A> | undefined {
  return library.workouts.find((w) => w.id === library.lastWorkout) ?? library.workouts[0];
}

/** The library with `workout` in place of the saved workout with its id. */
export function replaceWorkout<A extends ActivityBase>(library: WorkoutLibrary<A>, workout: Workout<A>): WorkoutLibrary<A> {
  return { ...library, workouts: library.workouts.map((w) => (w.id === workout.id ? workout : w)) };
}

/** The library without workout `id`, choosing the one after it, or before it if it was last. */
export function deleteWorkout<A extends ActivityBase>(library: WorkoutLibrary<A>, id: string): WorkoutLibrary<A> {
  const index = library.workouts.findIndex((w) => w.id === id);
  if (index === -1) return library;
  const workouts = library.workouts.filter((w) => w.id !== id);
  const next = workouts[Math.min(index, workouts.length - 1)];
  return { lastWorkout: next?.id, workouts };
}
