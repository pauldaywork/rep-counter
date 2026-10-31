import "./style.css";
import { createStore } from "./store";
import type { Activity } from "./store-schema";
import { App } from "./ui";
import { describeActivity, describeStep, parseActivity } from "./workout";
import { WorkoutPage } from "./workout-page";

// Everything this page saves goes to data-routine/, apart from the single-set page's data/.
const api = createStore("/api/routine");
const app = new App(api);

void new WorkoutPage<Activity>(app, {
  amountField: "activity-reps",
  file: "data-routine/workouts.json",
  load: () => api.loadWorkouts(),
  save: (library) => api.saveWorkouts(library),
  parse: parseActivity,
  describeActivity,
  describeStep,
  showUpcoming: (step) => app.renderCount(0, step?.reps ?? 0),
  runSet: async (step, run) => {
    await app.runSet({
      target: step.reps,
      routine: { runId: run.runId, workout: run.workout, activity: step.activity, set: step.set, sets: step.sets },
    });
  },
  stopSet: () => app.stopSet(),
}).init();
void app.init();
