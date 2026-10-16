import type { Activity, Workout, WorkoutLibrary } from "./store-schema";

/** One set of one activity, in the order the workout runs them. */
export interface WorkoutStep {
  activityIndex: number;
  activity: string;
  reps: number;
  /** 1-based */
  set: number;
  sets: number;
}

/** Every set of the workout in order: all of the first activity's sets, then the next activity's. */
export function workoutSteps(workout: Workout): WorkoutStep[] {
  return workout.activities.flatMap((a, activityIndex) =>
    Array.from({ length: a.sets }, (_, i) => ({ activityIndex, activity: a.name, reps: a.reps, set: i + 1, sets: a.sets })),
  );
}

export function describeStep(step: WorkoutStep): string {
  return `${step.activity} · set ${step.set} of ${step.sets} · ${step.reps} ${step.reps === 1 ? "rep" : "reps"}`;
}

/** How many of an activity's sets are among the first `completed` steps. */
export function setsDone(steps: WorkoutStep[], completed: number, activityIndex: number): number {
  return steps.slice(0, completed).filter((s) => s.activityIndex === activityIndex).length;
}

/** Reads the add-activity form's fields, or says what's wrong with them. */
export function parseActivity(name: string, reps: string, sets: string): Activity | string {
  const trimmed = name.trim();
  if (trimmed === "") return "Enter the activity's name.";
  const repCount = Number(reps);
  if (reps.trim() === "" || !Number.isInteger(repCount) || repCount < 1) return "Enter at least 1 rep per set.";
  const setCount = Number(sets);
  if (sets.trim() === "" || !Number.isInteger(setCount) || setCount < 1) return "Enter at least 1 set.";
  return { name: trimmed, reps: repCount, sets: setCount };
}

/** The workout with activity `from` moved to position `to`. */
export function moveActivity(workout: Workout, from: number, to: number): Workout {
  if (to < 0 || to >= workout.activities.length) return workout;
  const activities = [...workout.activities];
  const [moved] = activities.splice(from, 1);
  activities.splice(to, 0, moved);
  return { ...workout, activities };
}

/** An empty workout named "Workout N", with the lowest N no saved workout already uses. */
export function createWorkout(library: WorkoutLibrary, id: string): Workout {
  let n = 1;
  while (nameTaken(library, `Workout ${n}`)) n++;
  return { id, name: `Workout ${n}`, activities: [], restSeconds: 60 };
}

/** Whether another workout already has this name, ignoring case and outer spaces. */
export function nameTaken(library: WorkoutLibrary, name: string, exceptId?: string): boolean {
  const wanted = name.trim().toLowerCase();
  return library.workouts.some((w) => w.id !== exceptId && w.name.trim().toLowerCase() === wanted);
}

/** The workout the page should show: the last one chosen, or else the first. */
export function selectedWorkout(library: WorkoutLibrary): Workout | undefined {
  return library.workouts.find((w) => w.id === library.lastWorkout) ?? library.workouts[0];
}

/** The library with `workout` in place of the saved workout with its id. */
export function replaceWorkout(library: WorkoutLibrary, workout: Workout): WorkoutLibrary {
  return { ...library, workouts: library.workouts.map((w) => (w.id === workout.id ? workout : w)) };
}

/** The library without workout `id`, choosing the one after it, or before it if it was last. */
export function deleteWorkout(library: WorkoutLibrary, id: string): WorkoutLibrary {
  const index = library.workouts.findIndex((w) => w.id === id);
  if (index === -1) return library;
  const workouts = library.workouts.filter((w) => w.id !== id);
  const next = workouts[Math.min(index, workouts.length - 1)];
  return { lastWorkout: next?.id, workouts };
}
