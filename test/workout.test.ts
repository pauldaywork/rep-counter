import { describe, expect, it } from "vitest";
import {
  createWorkout,
  deleteWorkout,
  describeStep,
  moveActivity,
  nameTaken,
  parseActivity,
  replaceWorkout,
  selectedWorkout,
  setsDone,
  workoutSteps,
} from "../src/workout";

const workout = {
  id: "w1",
  name: "Legs",
  activities: [
    { name: "Squat", reps: 10, sets: 2 },
    { name: "Push-up", reps: 1, sets: 1 },
  ],
  restSeconds: 60,
};

describe("workoutSteps", () => {
  it("runs every set of each activity before the next activity", () => {
    expect(workoutSteps(workout)).toEqual([
      { activityIndex: 0, activity: "Squat", reps: 10, set: 1, sets: 2 },
      { activityIndex: 0, activity: "Squat", reps: 10, set: 2, sets: 2 },
      { activityIndex: 1, activity: "Push-up", reps: 1, set: 1, sets: 1 },
    ]);
  });

  it("has no steps for an empty workout", () => {
    expect(workoutSteps({ id: "w", name: "Empty", activities: [], restSeconds: 0 })).toEqual([]);
  });
});

it("describes a step", () => {
  const [first, , last] = workoutSteps(workout);
  expect(describeStep(first)).toBe("Squat · set 1 of 2 · 10 reps");
  expect(describeStep(last)).toBe("Push-up · set 1 of 1 · 1 rep");
});

it("counts an activity's finished sets", () => {
  const steps = workoutSteps(workout);
  expect(setsDone(steps, 1, 0)).toBe(1);
  expect(setsDone(steps, 2, 0)).toBe(2);
  expect(setsDone(steps, 2, 1)).toBe(0);
});

describe("parseActivity", () => {
  it("reads valid fields, trimming the name", () => {
    expect(parseActivity("  Squat ", "10", "3")).toEqual({ name: "Squat", reps: 10, sets: 3 });
  });

  it("rejects a blank name, and reps or sets below 1 or not whole", () => {
    expect(parseActivity(" ", "10", "3")).toBe("Enter the activity's name.");
    expect(parseActivity("Squat", "0", "3")).toBe("Enter at least 1 rep per set.");
    expect(parseActivity("Squat", "", "3")).toBe("Enter at least 1 rep per set.");
    expect(parseActivity("Squat", "10", "1.5")).toBe("Enter at least 1 set.");
  });
});

describe("moveActivity", () => {
  it("moves an activity to a new position", () => {
    expect(moveActivity(workout, 1, 0).activities.map((a) => a.name)).toEqual(["Push-up", "Squat"]);
  });

  it("leaves the workout alone when the move would go past either end", () => {
    expect(moveActivity(workout, 0, -1)).toBe(workout);
    expect(moveActivity(workout, 1, 2)).toBe(workout);
  });
});

describe("the workout library", () => {
  const arms = { id: "w2", name: "Arms", activities: [], restSeconds: 30 };
  const core = { id: "w3", name: "Workout 1", activities: [], restSeconds: 30 };
  const library = { lastWorkout: "w2", workouts: [workout, arms, core] };

  it("names a new workout after the lowest unused number", () => {
    expect(createWorkout({ workouts: [] }, "a")).toEqual({ id: "a", name: "Workout 1", activities: [], restSeconds: 60 });
    expect(createWorkout(library, "b").name).toBe("Workout 2");
  });

  it("spots a name already in use, ignoring case and spaces, but not the workout's own", () => {
    expect(nameTaken(library, " arms ")).toBe(true);
    expect(nameTaken(library, "Arms", "w2")).toBe(false);
    expect(nameTaken(library, "Back")).toBe(false);
  });

  it("selects the last chosen workout, or the first when that one is gone", () => {
    expect(selectedWorkout(library)).toBe(arms);
    expect(selectedWorkout({ lastWorkout: "gone", workouts: [workout, arms] })).toBe(workout);
    expect(selectedWorkout({ workouts: [] })).toBeUndefined();
  });

  it("replaces a workout by its id", () => {
    const renamed = { ...arms, name: "Upper body" };
    expect(replaceWorkout(library, renamed).workouts).toEqual([workout, renamed, core]);
  });

  it("deletes a workout and selects its neighbour", () => {
    expect(deleteWorkout(library, "w2")).toEqual({ lastWorkout: "w3", workouts: [workout, core] });
    expect(deleteWorkout(library, "w3")).toEqual({ lastWorkout: "w2", workouts: [workout, arms] });
    expect(deleteWorkout({ workouts: [arms] }, "w2")).toEqual({ lastWorkout: undefined, workouts: [] });
  });
});
