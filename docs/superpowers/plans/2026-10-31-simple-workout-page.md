# Simple Workout Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `simple.html`, a workout page like the routine page but with no mic: build workouts of timed sets (e.g. hip thrust 3 × 60 s) and run each set as a countdown, with rests between and a ding at the end of each set and rest.

**Architecture:** Activities become generic: `Activity` (reps) and a new `TimedActivity` (seconds) share an `ActivityBase` of name and sets, and `Workout<A>` / `WorkoutLibrary<A>` and the `src/workout.ts` helpers take the activity type as a parameter. The routine page's builder and run loop move out of `src/routine.ts` into a shared `WorkoutPage<A>` class (`src/workout-page.ts`). It talks to a `PageHost` (status, errors, one run at a time), which `App` already satisfies on the routine page and a small mic-free host provides on the simple page, and to a `WorkoutKind<A>` that says how to parse, describe, save and run a set. The save server gets a workouts-only `/api/simple` store in `data-simple/`.

**Tech Stack:** TypeScript 7.0.2, Vite 8.3.4 (dev server, multi-page by plain HTML files), Vitest 5.0.4 (node environment, no DOM), Web Audio for the ding.

**Spec:** Taskwarrior task `5b17013b-764f-4512-9861-8c7c2ee70ff9` (its description and notes; read with `task rc.json.array=on 5b17013b-764f-4512-9861-8c7c2ee70ff9 export`).

## Global Constraints

- The simple page must not load `App` (`src/ui.ts`) or ask for the mic. Its module graph must not include `src/ui.ts`, `src/audio.ts`, `src/meter.ts` or `src/audio-recorder.ts`.
- Each set is a countdown of its seconds showing the activity and set N of M; no reps are counted, entered or shown.
- Keep the routine page's builder and run controls: saved-workout picker, New/Delete, rename, reorder/remove, rest seconds (0 waits for Start next set), Alternate sets in pairs, Skip rest, End workout, Start over/Resume.
- Its only sound is the speaker ding from `src/chime.ts` when a rest ends, and also when a set's time is up (the second wasn't asked for; it is easy to drop, see Task 4).
- Timed workouts (activities of `name`, `seconds`, `sets`) live in `data-simple/workouts.json`, served by a new `/api/simple` store that serves only the workouts routes. The routine page and `data-routine/` stay as they are.
- Save no logs, audio or fixtures; show no mic picker, calibration, meter, tuning, rejections or Save set data.
- Share the builder/run code with `routine.ts` rather than copying it. While moving it, fix the misplaced `alternateSets.checked` line: `render()` must set the checkbox from the shown workout.
- Out of scope: changing the single-set or routine pages beyond the header links and the shared-code move; rep counting; logs; sharing workouts with the routine page.
- Done when `/simple.html` builds, saves and reloads a timed workout, runs every set as a countdown with rests and dings, never asks for the mic, writes only `data-simple/workouts.json`, and `npm test` and `npm run typecheck` pass.
- Commits use Conventional Commits and end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Before you start

This worktree has no `node_modules`. Run `npm ci` once from the worktree root before any test. Run every command from the worktree root. `npm test` replays the audio fixtures too, so it takes a little while; use `npx vitest run <file>` while iterating.

There is no DOM test environment (no jsdom), so page code (`src/workout-page.ts`, `src/routine.ts`, `src/simple.ts`) is checked by `npm run typecheck` and in the browser with `npm run dev`. To look at a page, use the `terminal-browser` skill (or Claude in Chrome) on `http://localhost:5173/...`. Start the dev server with `npm run dev` in the background and stop it when done.

## File map

| File | Task | Responsibility |
|---|---|---|
| `src/store-schema.ts` (modify) | 1 | `ActivityBase`, `TimedActivity`, generic `Workout<A>`/`WorkoutLibrary<A>`, `isTimedWorkoutLibrary` |
| `vite-plugin-store.ts` (modify) | 1 | Shared request routing; `SIMPLE_STORE` and `createSimpleStoreHandler`, workouts only |
| `test/store-plugin.test.ts` (modify) | 1 | `/api/simple` tests; the routine store rejects timed workouts |
| `src/workout.ts` (modify) | 2 | Generic `Step<A>` and helpers; `describeActivity`, timed describe and parse |
| `test/workout.test.ts` (modify) | 2 | Timed helper tests |
| `src/countdown.ts` (create) | 3 | A ticking countdown that can be stopped early |
| `test/countdown.test.ts` (create) | 3 | Countdown tests with fake timers |
| `src/dom.ts` (create) | 3 | `el` and `message`, moved out of `src/ui.ts` so mic-free pages can use them |
| `src/ui.ts`, `src/main.ts` (modify) | 3 | Import `el`/`message` from `src/dom.ts` |
| `src/chime.ts` (modify) | 3 | `playDing()`, moved from `src/routine.ts` |
| `src/workout-page.ts` (create) | 3 | `PageHost`, `WorkoutKind<A>`, `WorkoutPage<A>`: the shared builder and runner |
| `src/routine.ts` (modify) | 3 | Just the rep-counting `WorkoutKind` wired to `App` |
| `src/store.ts` (modify) | 4 | `createSimpleStore()`: the browser side of `/api/simple` |
| `simple.html` (create) | 4 | The simple page's markup |
| `src/simple.ts` (create) | 4 | Mic-free `PageHost` and the timed `WorkoutKind` |
| `src/style.css` (modify) | 4, 5 | `#time-left`, `#activity-seconds`; `.page-links` |
| `index.html`, `routine.html` (modify) | 5 | Header links between the three pages |

---

### Task 1: Timed workouts in the schema and a workouts-only simple store

**Files:**
- Modify: `src/store-schema.ts:12-90` (the `Activity`, `Workout`, `WorkoutLibrary` types and their checks)
- Modify: `vite-plugin-store.ts`
- Test: `test/store-plugin.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces (in `src/store-schema.ts`):
  ```ts
  export interface ActivityBase { name: string; sets: number }
  export interface Activity extends ActivityBase { reps: number }
  export interface TimedActivity extends ActivityBase { seconds: number }
  export interface Workout<A extends ActivityBase = Activity> { id: string; name: string; activities: A[]; restSeconds: number; alternateSets?: boolean }
  export interface WorkoutLibrary<A extends ActivityBase = Activity> { lastWorkout?: string; workouts: Workout<A>[] }
  export type TimedWorkout = Workout<TimedActivity>;
  export type TimedWorkoutLibrary = WorkoutLibrary<TimedActivity>;
  export const isWorkout: (x: unknown) => x is Workout;
  export const isWorkoutLibrary: (x: unknown) => x is WorkoutLibrary;
  export const isTimedWorkoutLibrary: (x: unknown) => x is TimedWorkoutLibrary;
  ```
- Produces (in `vite-plugin-store.ts`): `export const SIMPLE_STORE: Pick<StoreLocation, "prefix" | "dataDir">` (`/api/simple`, `data-simple`) and `export function createSimpleStoreHandler(root: string, location?: Pick<StoreLocation, "prefix" | "dataDir">)`, a Connect-style middleware serving only `GET /workouts` and `PUT /workouts`.

- [ ] **Step 1: Write the failing tests**

In `test/store-plugin.test.ts`, change the import:

```ts
import { createSimpleStoreHandler, createStoreHandler, ROUTINE_STORE } from "../vite-plugin-store";
```

Chain the simple handler after the routine one in `beforeEach`, replacing the `const handler…` to `server = createServer(…);` lines:

```ts
  // Chained as the plugin chains them, so each store sees the others' routes.
  const handler = createStoreHandler(root);
  const routineHandler = createStoreHandler(root, ROUTINE_STORE);
  const simpleHandler = createSimpleStoreHandler(root);
  server = createServer((req, res) => {
    void handler(req, res, () => {
      void routineHandler(req, res, () => {
        void simpleHandler(req, res, () => {
          res.statusCode = 404;
          res.end();
        });
      });
    });
  });
```

In the `/api/routine` describe, make the rejection test also refuse a timed activity. Replace that test with:

```ts
  it("rejects workouts with a nameless activity, no sets, a blank name, a non-boolean alternate-sets flag, a repeated id or a timed activity", async () => {
    const legs = { id: "w1", name: "Legs", activities: [{ name: "Squat", reps: 10, sets: 3 }], restSeconds: 60 };
    const bad = [
      { workouts: [{ ...legs, activities: [{ name: " ", reps: 10, sets: 3 }] }] },
      { workouts: [{ ...legs, activities: [{ name: "Squat", reps: 10, sets: 0 }] }] },
      { workouts: [{ ...legs, restSeconds: -5 }] },
      { workouts: [{ ...legs, alternateSets: "yes" }] },
      { workouts: [{ ...legs, name: "" }] },
      { workouts: [legs, { ...legs, name: "Legs again" }] },
      { workouts: [{ ...legs, activities: [{ name: "Plank", seconds: 60, sets: 3 }] }] },
    ];
    for (const library of bad) expect((await put("/api/routine/workouts", library)).status).toBe(400);
  });
```

Add a new describe block after the `/api/routine` one:

```ts
describe("/api/simple", () => {
  const glutes = {
    id: "w1",
    name: "Glutes",
    activities: [{ name: "hip thrust", seconds: 60, sets: 3 }],
    restSeconds: 30,
    alternateSets: true,
  };

  it("returns no workouts when none are saved, then saves and loads timed workouts in data-simple", async () => {
    expect(await (await fetch(`${base}/api/simple/workouts`)).json()).toEqual({ workouts: [] });
    const library = { lastWorkout: "w1", workouts: [glutes] };
    expect((await put("/api/simple/workouts", library)).status).toBe(200);
    expect(await (await fetch(`${base}/api/simple/workouts`)).json()).toEqual(library);
    expect(JSON.parse(await readFile(path.join(root, "data-simple", "workouts.json"), "utf8"))).toEqual(library);
    expect(await readdir(path.join(root, "data-simple"))).toEqual(["workouts.json"]);
    await expect(readdir(path.join(root, "data-routine"))).rejects.toThrow();
  });

  it("rejects activities that count reps, or have no whole positive seconds, sets or name", async () => {
    const bad = [
      { workouts: [{ ...glutes, activities: [{ name: "hip thrust", reps: 10, sets: 3 }] }] },
      { workouts: [{ ...glutes, activities: [{ name: "hip thrust", seconds: 0, sets: 3 }] }] },
      { workouts: [{ ...glutes, activities: [{ name: "hip thrust", seconds: 1.5, sets: 3 }] }] },
      { workouts: [{ ...glutes, activities: [{ name: "hip thrust", seconds: 60, sets: 0 }] }] },
      { workouts: [{ ...glutes, activities: [{ name: " ", seconds: 60, sets: 3 }] }] },
      { workouts: [glutes, { ...glutes, name: "Glutes again" }] },
    ];
    for (const library of bad) expect((await put("/api/simple/workouts", library)).status).toBe(400);
  });

  it("serves only the workouts routes", async () => {
    expect((await fetch(`${base}/api/simple/calibration`)).status).toBe(404);
    expect((await put("/api/simple/calibration", store)).status).toBe(404);
    expect((await post("/api/simple/fixtures", recording)).status).toBe(404);
    expect((await put("/api/simple/logs/sets/2026-10-15T05-00-00-000Z", {})).status).toBe(404);
    await expect(readdir(path.join(root, "data-simple"))).rejects.toThrow();
  });

  it("reports a corrupt workout file instead of replacing it", async () => {
    await mkdir(path.join(root, "data-simple"), { recursive: true });
    await writeFile(path.join(root, "data-simple", "workouts.json"), "{oops");
    const res = await fetch(`${base}/api/simple/workouts`);
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("data-simple/workouts.json is not valid JSON. Fix or delete it.");
  });
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `npx vitest run test/store-plugin.test.ts`
Expected: FAIL — every test errors because `createSimpleStoreHandler` is not exported (`createSimpleStoreHandler is not a function`).

- [ ] **Step 3: Make the schema generic and add the timed check**

In `src/store-schema.ts`, replace the `Activity`, `Workout` and `WorkoutLibrary` interfaces (lines 12–35) with:

```ts
/** What every kind of activity has: a name and how many sets to do. */
export interface ActivityBase {
  name: string;
  sets: number;
}

/** One exercise in a routine-page workout: `sets` sets of `reps` reps each. */
export interface Activity extends ActivityBase {
  reps: number;
}

/** One exercise in a simple-page workout: `sets` sets of `seconds` seconds each. */
export interface TimedActivity extends ActivityBase {
  seconds: number;
}

/** A named list of activities, run set by set. */
export interface Workout<A extends ActivityBase = Activity> {
  id: string;
  name: string;
  activities: A[];
  /** the rest between sets; 0 waits for a button press instead */
  restSeconds: number;
  /** runs each pair of activities a set of one, then a set of the other, until both are done */
  alternateSets?: boolean;
}

/**
 * Every saved workout, and the one last chosen: data-routine/workouts.json,
 * or data-simple/workouts.json for timed workouts.
 */
export interface WorkoutLibrary<A extends ActivityBase = Activity> {
  lastWorkout?: string;
  workouts: Workout<A>[];
}

export type TimedWorkout = Workout<TimedActivity>;
export type TimedWorkoutLibrary = WorkoutLibrary<TimedActivity>;
```

Then replace `isActivity`, `isWorkout` and `isWorkoutLibrary` (from `function isActivity` to the end of `isWorkoutLibrary`; keep `const isPositiveCount` above them) with:

```ts
const hasName = (x: Record<string, unknown>) => typeof x.name === "string" && x.name.trim() !== "";

function isActivity(x: unknown): x is Activity {
  return isRecord(x) && hasName(x) && isPositiveCount(x.reps) && isPositiveCount(x.sets);
}

function isTimedActivity(x: unknown): x is TimedActivity {
  return isRecord(x) && hasName(x) && isPositiveCount(x.seconds) && isPositiveCount(x.sets);
}

/** A check for workouts whose activities all pass `activityCheck`. */
function workoutCheck<A extends ActivityBase>(activityCheck: (x: unknown) => x is A) {
  return (x: unknown): x is Workout<A> =>
    isRecord(x) &&
    typeof x.id === "string" &&
    x.id !== "" &&
    hasName(x) &&
    Array.isArray(x.activities) &&
    x.activities.every(activityCheck) &&
    isCount(x.restSeconds) &&
    (x.alternateSets === undefined || typeof x.alternateSets === "boolean");
}

/** A check for a library of workouts that pass `workoutCheck`, with no id used twice. */
function libraryCheck<A extends ActivityBase>(isWorkoutOf: (x: unknown) => x is Workout<A>) {
  return (x: unknown): x is WorkoutLibrary<A> => {
    if (!isRecord(x) || !isOptionalString(x.lastWorkout) || !Array.isArray(x.workouts) || !x.workouts.every(isWorkoutOf)) {
      return false;
    }
    const ids = x.workouts.map((w) => w.id);
    return new Set(ids).size === ids.length;
  };
}

export const isWorkout = workoutCheck(isActivity);
export const isWorkoutLibrary = libraryCheck(isWorkout);
export const isTimedWorkoutLibrary = libraryCheck(workoutCheck(isTimedActivity));
```

(`isOptionalString` is a `const` defined further down the file; that's fine, since the returned checks only read it when called.)

- [ ] **Step 4: Split the plugin's routing and add the simple store**

In `vite-plugin-store.ts`, change the schema import to:

```ts
import {
  type ActivityBase,
  isCalibrationLog,
  isSetLog,
  isSetRecording,
  isStoreFile,
  isTimedWorkoutLibrary,
  isWorkoutLibrary,
  type StoreFile,
  type WorkoutLibrary,
} from "./src/store-schema";
```

After `ROUTINE_STORE`, add:

```ts
/** The simple page has no mic, so its store keeps only its timed workouts. */
export const SIMPLE_STORE: Pick<StoreLocation, "prefix" | "dataDir"> = { prefix: "/api/simple", dataDir: "data-simple" };

type Handler = (req: IncomingMessage, res: ServerResponse, next: () => void) => Promise<void>;
/** Serves one request, given as "METHOD /path" below the store's prefix. Returns false for a route it doesn't serve. */
type Routes = (route: string, req: IncomingMessage, res: ServerResponse) => Promise<boolean>;
```

Update the plugin's doc comment and register the simple store:

```ts
/** Serves each store's routes from files in the project. */
export function storePlugin(): Plugin {
  return {
    name: "rep-counter-store",
    configureServer(server) {
      server.middlewares.use(createStoreHandler(server.config.root));
      server.middlewares.use(createStoreHandler(server.config.root, ROUTINE_STORE));
      server.middlewares.use(createSimpleStoreHandler(server.config.root));
    },
  };
}
```

Replace `createStoreHandler` and `readWorkouts` with:

```ts
/** Serves a mic page's calibration, fixtures, logs and workouts. */
export function createStoreHandler(root: string, location: StoreLocation = MAIN_STORE): Handler {
  const { prefix, dataDir, fixturesDir } = location;
  const calibrationFile = path.join(root, dataDir, "calibration.json");
  const logsDir = path.join(root, dataDir, "logs");
  const workouts = workoutRoutes(root, dataDir, isWorkoutLibrary);

  return serve(prefix, async (route, req, res) => {
    // The id becomes a file name, so it may only hold letters, digits and dashes.
    const logRoute = /^PUT \/logs\/(sets|calibrations)\/([0-9A-Za-z-]{1,64})$/.exec(route);
    const audioRoute = /^PUT \/logs\/(sets|calibrations)\/([0-9A-Za-z-]{1,64})\.webm$/.exec(route);
    if (await workouts(route, req, res)) return true;
    if (route === "GET /calibration") {
      send(res, 200, await readStore(calibrationFile, `${dataDir}/calibration.json`));
    } else if (route === "PUT /calibration") {
      const body = await readJson(req);
      if (!isStoreFile(body)) throw new BadRequest("The calibration data is not in the expected format.");
      await writeAtomic(calibrationFile, `${JSON.stringify(body, null, 2)}\n`);
      send(res, 200, { ok: true });
    } else if (route === "POST /fixtures") {
      const body = await readJson(req);
      if (!isSetRecording(body)) throw new BadRequest("The set recording is not in the expected format.");
      const name = `set-${body.recordedAt.replace(/[^0-9A-Za-z]/g, "-")}.json`;
      await writeAtomic(path.join(root, fixturesDir, name), `${JSON.stringify(body)}\n`);
      send(res, 200, { path: `${fixturesDir}/${name}` });
    } else if (logRoute) {
      const [, kind, id] = logRoute;
      const body = await readJson(req);
      const valid = kind === "sets" ? isSetLog(body) : isCalibrationLog(body);
      if (!valid || (body as { id: string }).id !== id) throw new BadRequest("The log is not in the expected format.");
      await writeAtomic(path.join(logsDir, kind, `${id}.json`), `${JSON.stringify(body)}\n`);
      send(res, 200, { path: `${dataDir}/logs/${kind}/${id}.json` });
    } else if (audioRoute) {
      const [, kind, id] = audioRoute;
      if (!req.headers["content-type"]?.startsWith("audio/webm")) {
        throw new BadRequest("Expected a WebM audio request body.");
      }
      const body = await readBody(req);
      if (body.length === 0) throw new BadRequest("The audio is empty.");
      await writeAtomic(path.join(logsDir, kind, `${id}.webm`), body);
      send(res, 200, { path: `${dataDir}/logs/${kind}/${id}.webm` });
    } else {
      return false;
    }
    return true;
  });
}

/** Serves the simple page's timed workouts, and nothing else. */
export function createSimpleStoreHandler(
  root: string,
  location: Pick<StoreLocation, "prefix" | "dataDir"> = SIMPLE_STORE,
): Handler {
  return serve(location.prefix, workoutRoutes(root, location.dataDir, isTimedWorkoutLibrary));
}

/** Hands each request under `prefix` to `routes`, passing on any it doesn't serve and sending back any error. */
function serve(prefix: string, routes: Routes): Handler {
  return async (req, res, next) => {
    const url = req.url?.split("?")[0] ?? "";
    if (!url.startsWith(`${prefix}/`)) return next();
    try {
      if (!(await routes(`${req.method} ${url.slice(prefix.length)}`, req, res))) next();
    } catch (err) {
      send(res, err instanceof BadRequest ? 400 : 500, { error: err instanceof Error ? err.message : String(err) });
    }
  };
}

/** GET and PUT /workouts, kept in <dataDir>/workouts.json and checked with `valid`. */
function workoutRoutes(root: string, dataDir: string, valid: (x: unknown) => x is WorkoutLibrary<ActivityBase>): Routes {
  const file = path.join(root, dataDir, "workouts.json");
  const name = `${dataDir}/workouts.json`;
  return async (route, req, res) => {
    if (route === "GET /workouts") {
      send(res, 200, await readJsonFile(file, name, { workouts: [] }, valid));
    } else if (route === "PUT /workouts") {
      const body = await readJson(req);
      if (!valid(body)) throw new BadRequest("The workouts are not in the expected format.");
      await writeAtomic(file, `${JSON.stringify(body, null, 2)}\n`);
      send(res, 200, { ok: true });
    } else {
      return false;
    }
    return true;
  };
}
```

Delete the old `readWorkouts` function; `readStore` and everything below it stay as they are.

- [ ] **Step 5: Run the tests and typecheck**

Run: `npx vitest run test/store-plugin.test.ts && npm run typecheck`
Expected: all store-plugin tests PASS, typecheck reports no errors.

- [ ] **Step 6: Commit**

```bash
git add src/store-schema.ts vite-plugin-store.ts test/store-plugin.test.ts
git commit -m "feat(store): serve timed workouts for the simple page

Add a timed activity type (name, seconds, sets) and a /api/simple store
that keeps only these workouts, in data-simple/workouts.json. The page
has no mic, so the store serves no calibration, logs or fixtures.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Timed versions of the workout helpers

**Files:**
- Modify: `src/workout.ts` (whole file)
- Test: `test/workout.test.ts`

**Interfaces:**
- Consumes (Task 1): `ActivityBase`, `Activity`, `TimedActivity`, `Workout<A>`, `WorkoutLibrary<A>` from `src/store-schema.ts`.
- Produces (in `src/workout.ts`):
  ```ts
  export type Step<A extends ActivityBase> = Omit<A, "name"> & { activityIndex: number; activity: string; set: number };
  export type WorkoutStep = Step<Activity>;   // { activityIndex, activity, reps, set, sets }, as before
  export type TimedStep = Step<TimedActivity>; // { activityIndex, activity, seconds, set, sets }
  export function workoutSteps<A extends ActivityBase>(workout: Workout<A>): Step<A>[];
  export function describeStep(step: WorkoutStep): string;          // "Squat · set 1 of 2 · 10 reps"
  export function describeTimedStep(step: TimedStep): string;       // "hip thrust · set 1 of 3 · 60 s"
  export function describeActivity(activity: Activity): string;     // "3 × 10 reps"
  export function describeTimedActivity(activity: TimedActivity): string; // "3 × 60 s"
  export function setsDone(steps: { activityIndex: number }[], completed: number, activityIndex: number): number;
  export function parseActivity(name: string, reps: string, sets: string): Activity | string;
  export function parseTimedActivity(name: string, seconds: string, sets: string): TimedActivity | string;
  export function moveActivity<A extends ActivityBase>(workout: Workout<A>, from: number, to: number): Workout<A>;
  export function createWorkout<A extends ActivityBase>(library: WorkoutLibrary<A>, id: string): Workout<A>;
  export function nameTaken(library: WorkoutLibrary<ActivityBase>, name: string, exceptId?: string): boolean;
  export function selectedWorkout<A extends ActivityBase>(library: WorkoutLibrary<A>): Workout<A> | undefined;
  export function replaceWorkout<A extends ActivityBase>(library: WorkoutLibrary<A>, workout: Workout<A>): WorkoutLibrary<A>;
  export function deleteWorkout<A extends ActivityBase>(library: WorkoutLibrary<A>, id: string): WorkoutLibrary<A>;
  ```

- [ ] **Step 1: Write the failing tests**

In `test/workout.test.ts`, extend the import:

```ts
import {
  createWorkout,
  deleteWorkout,
  describeActivity,
  describeStep,
  describeTimedActivity,
  describeTimedStep,
  moveActivity,
  nameTaken,
  parseActivity,
  parseTimedActivity,
  replaceWorkout,
  selectedWorkout,
  setsDone,
  workoutSteps,
} from "../src/workout";
```

After the `it("describes a step", …)` test, add:

```ts
it("describes an activity", () => {
  expect(describeActivity({ name: "Squat", reps: 10, sets: 3 })).toBe("3 × 10 reps");
  expect(describeActivity({ name: "Push-up", reps: 1, sets: 2 })).toBe("2 × 1 rep");
});
```

At the end of the file, add:

```ts
describe("timed workouts", () => {
  const glutes = {
    id: "t1",
    name: "Glutes",
    activities: [
      { name: "hip thrust", seconds: 60, sets: 2 },
      { name: "plank", seconds: 30, sets: 1 },
    ],
    restSeconds: 30,
  };

  it("runs the sets in the same order as counted workouts, with each set's seconds", () => {
    expect(workoutSteps(glutes)).toEqual([
      { activityIndex: 0, activity: "hip thrust", seconds: 60, set: 1, sets: 2 },
      { activityIndex: 0, activity: "hip thrust", seconds: 60, set: 2, sets: 2 },
      { activityIndex: 1, activity: "plank", seconds: 30, set: 1, sets: 1 },
    ]);
    expect(workoutSteps({ ...glutes, alternateSets: true }).map(describeTimedStep)).toEqual([
      "hip thrust · set 1 of 2 · 60 s",
      "plank · set 1 of 1 · 30 s",
      "hip thrust · set 2 of 2 · 60 s",
    ]);
  });

  it("describes a timed activity", () => {
    expect(describeTimedActivity(glutes.activities[0])).toBe("2 × 60 s");
  });

  it("reads the add-activity fields with seconds instead of reps", () => {
    expect(parseTimedActivity(" hip thrust ", "60", "3")).toEqual({ name: "hip thrust", seconds: 60, sets: 3 });
    expect(parseTimedActivity("", "60", "3")).toBe("Enter the activity's name.");
    expect(parseTimedActivity("plank", "0", "3")).toBe("Enter at least 1 second per set.");
    expect(parseTimedActivity("plank", "", "3")).toBe("Enter at least 1 second per set.");
    expect(parseTimedActivity("plank", "7.5", "3")).toBe("Enter at least 1 second per set.");
    expect(parseTimedActivity("plank", "30", "0")).toBe("Enter at least 1 set.");
  });

  it("builds, reorders and replaces timed workouts in a library", () => {
    const library = { lastWorkout: "t1", workouts: [glutes] };
    expect(createWorkout(library, "t2")).toEqual({ id: "t2", name: "Workout 1", activities: [], restSeconds: 60 });
    const reordered = moveActivity(glutes, 1, 0);
    expect(reordered.activities.map((a) => a.name)).toEqual(["plank", "hip thrust"]);
    expect(replaceWorkout(library, reordered).workouts).toEqual([reordered]);
    expect(selectedWorkout(library)).toBe(glutes);
  });
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `npx vitest run test/workout.test.ts`
Expected: FAIL — `describeActivity`, `describeTimedStep`, `describeTimedActivity` and `parseTimedActivity` are not functions.

- [ ] **Step 3: Rewrite `src/workout.ts`**

Replace the whole file with:

```ts
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
```

- [ ] **Step 4: Run the tests and typecheck**

Run: `npx vitest run test/workout.test.ts && npm run typecheck`
Expected: every workout test PASSES, including the existing rep tests unchanged; typecheck is clean (`src/routine.ts` still compiles: `WorkoutStep` keeps its `reps`, `sets` and `activity` fields).

- [ ] **Step 5: Commit**

```bash
git add src/workout.ts test/workout.test.ts
git commit -m "feat(workout): add timed versions of the workout helpers

Steps and the library helpers now take the activity type as a
parameter, so workouts of timed sets order, reorder and save the same
way as counted ones. Add describe and parse helpers for seconds, and
describeActivity for the routine page's list.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Share the routine page's builder and runner

Moves the builder and run loop out of `src/routine.ts` into `WorkoutPage<A>`, so the simple page (Task 4) can use it without `App`. The routine page must behave exactly as before, except that the Alternate sets checkbox now shows the saved workout's setting.

**Files:**
- Create: `src/countdown.ts`, `test/countdown.test.ts`
- Create: `src/dom.ts`
- Create: `src/workout-page.ts`
- Modify: `src/ui.ts:68-77` (remove `el` and `message`, import them), `src/main.ts:3`
- Modify: `src/chime.ts` (add `playDing`)
- Modify: `src/routine.ts` (whole file)

**Interfaces:**
- Consumes (Task 2): `Step<A>`, `WorkoutStep`, `workoutSteps`, `describeStep`, `describeActivity`, `parseActivity`, `createWorkout`, `deleteWorkout`, `moveActivity`, `nameTaken`, `replaceWorkout`, `selectedWorkout`, `setsDone` from `src/workout.ts`. (Task 1): `ActivityBase`, `Workout<A>`, `WorkoutLibrary<A>`.
- Produces:
  ```ts
  // src/countdown.ts
  export interface Countdown { finished: Promise<boolean>; stop(): void }
  export function countdown(seconds: number, onTick: (left: number) => void): Countdown;
  // src/dom.ts
  export function el<T extends HTMLElement>(id: string): T;
  export function message(err: unknown): string;
  // src/chime.ts
  export function playDing(): void;
  // src/workout-page.ts
  export interface PageHost {
    run(flow: () => Promise<void>): Promise<void>;
    lockWhileBusy(...controls: { disabled: boolean }[]): void;
    setStatus(text: string): void;
    showError(text: string): void;
  }
  export interface WorkoutKind<A extends ActivityBase> {
    amountField: string;
    file: string;
    load(): Promise<WorkoutLibrary<A>>;
    save(library: WorkoutLibrary<A>): Promise<void>;
    parse(name: string, amount: string, sets: string): A | string;
    describeActivity(activity: A): string;
    describeStep(step: Step<A>): string;
    showUpcoming(step: Step<A> | undefined): void;
    runSet(step: Step<A>, run: { runId: string; workout: string }): Promise<void>;
    stopSet(): void;
  }
  export class WorkoutPage<A extends ActivityBase> {
    constructor(host: PageHost, kind: WorkoutKind<A>);
    init(): Promise<void>;
  }
  ```
  `WorkoutPage` reads these element ids from the page: `builder`, `workout-select`, `new-workout`, `delete-workout`, `workout-name`, `activities`, `no-activities`, `add-activity`, `activity-name`, `kind.amountField`, `activity-sets`, `rest`, `alternate-sets`, `start`, `restart`, `now`, `workout-controls`, `skip-rest`, `end-workout`.

- [ ] **Step 1: Write the failing countdown tests**

Create `test/countdown.test.ts`:

```ts
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { countdown } from "../src/countdown";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

it("ticks the whole seconds left, then finishes when the time is up", async () => {
  const ticks: number[] = [];
  const timer = countdown(3, (left) => ticks.push(left));
  expect(ticks).toEqual([3]);
  await vi.advanceTimersByTimeAsync(2999);
  expect([...new Set(ticks)]).toEqual([3, 2, 1]);
  await vi.advanceTimersByTimeAsync(1);
  await expect(timer.finished).resolves.toBe(true);
  expect(vi.getTimerCount()).toBe(0);
});

it("finishes early, without ticking again, when stopped", async () => {
  const ticks: number[] = [];
  const timer = countdown(60, (left) => ticks.push(left));
  await vi.advanceTimersByTimeAsync(1000);
  timer.stop();
  const ticked = ticks.length;
  await vi.advanceTimersByTimeAsync(5000);
  expect(ticks.length).toBe(ticked);
  await expect(timer.finished).resolves.toBe(false);
  expect(vi.getTimerCount()).toBe(0);
});

it("finishes at once for no time, without ticking or leaving a timer", async () => {
  const ticks: number[] = [];
  const timer = countdown(0, (left) => ticks.push(left));
  await expect(timer.finished).resolves.toBe(true);
  expect(ticks).toEqual([]);
  expect(vi.getTimerCount()).toBe(0);
});

it("stays finished when stopped after the time is up", async () => {
  const timer = countdown(1, () => {});
  await vi.advanceTimersByTimeAsync(1000);
  timer.stop();
  await expect(timer.finished).resolves.toBe(true);
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run test/countdown.test.ts`
Expected: FAIL — `Failed to resolve import "../src/countdown"`.

- [ ] **Step 3: Write `src/countdown.ts`**

```ts
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
```

- [ ] **Step 4: Run the countdown tests**

Run: `npx vitest run test/countdown.test.ts`
Expected: 4 tests PASS.

- [ ] **Step 5: Move `el` and `message` into `src/dom.ts`**

Create `src/dom.ts` with the two functions cut from `src/ui.ts` (lines 68–77):

```ts
export function el<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`The page is missing #${id}.`);
  return element as T;
}

export function message(err: unknown): string {
  if (err instanceof Error) return err.message || err.name;
  return String(err);
}
```

In `src/ui.ts`, delete those two functions and add to its imports:

```ts
import { el, message } from "./dom";
```

In `src/main.ts`, replace `import { App, el } from "./ui";` with:

```ts
import { el } from "./dom";
import { App } from "./ui";
```

- [ ] **Step 6: Add `playDing` to `src/chime.ts`**

Append to `src/chime.ts` (this is the `ding()` function at the bottom of today's `src/routine.ts`, moved):

```ts
/** One ding on its own short-lived AudioContext, as a cue such as the end of a rest. */
export function playDing(): void {
  const dinger = createDinger();
  dinger.ding();
  setTimeout(() => void dinger.close().catch(() => {}), 500);
}
```

- [ ] **Step 7: Write `src/workout-page.ts`**

This is `RoutinePage` from `src/routine.ts`, with every use of `app` going through `host` or `kind`, the rest countdown using `countdown()`, and the Alternate sets checkbox set in `render()`.

```ts
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
```

- [ ] **Step 8: Reduce `src/routine.ts` to its kind**

Replace the whole file with:

```ts
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
```

(`WorkoutPage.init` calls `app.lockWhileBusy` before its first `await`, so it still runs before `app.init`, as `lockWhileBusy` requires.)

- [ ] **Step 9: Typecheck and run all tests**

Run: `npm run typecheck && npm test`
Expected: typecheck clean; every test PASSES (the fixture replays are unaffected).

- [ ] **Step 10: Check the routine page in the browser**

Run `npm run dev` in the background and open `http://localhost:5173/routine.html`. Do not edit, add, choose or delete workouts there: any change saves `data-routine/workouts.json`, which is tracked. Check:
- The page loads with no error banner, and the saved "Regular Weights" workout shows its four activities as `3 × 10 reps` / `3 × 20 reps`, rest 30.
- **Alternate sets in pairs is ticked** (it's `true` in `data-routine/workouts.json`; before this task the checkbox stayed unticked on load).
- "First: hip thrust · set 1 of 3 · 10 reps" shows, and the count reads `0 / 10`.

Then stop the dev server and run `git status --short`. Expected: nothing under `data-routine/` changed.

- [ ] **Step 11: Commit**

```bash
git add src/countdown.ts test/countdown.test.ts src/dom.ts src/ui.ts src/main.ts src/chime.ts src/workout-page.ts src/routine.ts
git commit -m "refactor(routine): share the workout builder and runner

Move the routine page's builder and run loop into WorkoutPage, which
works through a small host (status, errors, one run at a time) and a
kind (how to parse, describe, save and run a set), so a page without
the mic can use it. el and message move to dom.ts for the same reason.

Also tick the Alternate sets checkbox from the shown workout on render;
it was only set after a bad rest value, so it showed unticked on load.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: The simple page

**Files:**
- Create: `simple.html`
- Create: `src/simple.ts`
- Modify: `src/store.ts` (add `createSimpleStore`)
- Modify: `src/style.css` (`#time-left`, `#activity-seconds`)

**Interfaces:**
- Consumes (Task 3): `PageHost`, `WorkoutPage<A>` from `src/workout-page.ts`; `countdown` from `src/countdown.ts`; `el`, `message` from `src/dom.ts`; `playDing` from `src/chime.ts`. (Task 2): `describeTimedActivity`, `describeTimedStep`, `parseTimedActivity`. (Task 1): `TimedActivity`, `TimedWorkoutLibrary`; the `/api/simple/workouts` routes.
- Produces (in `src/store.ts`): `export interface SimpleStore { loadWorkouts(): Promise<TimedWorkoutLibrary>; saveWorkouts(library: TimedWorkoutLibrary): Promise<void> }` and `export function createSimpleStore(base?: string): SimpleStore`.

- [ ] **Step 1: Add the browser side of the simple store**

In `src/store.ts`, change the schema import to:

```ts
import type { SetRecording, StoreFile, TimedWorkoutLibrary, WorkoutLibrary } from "./store-schema";
```

and add after `createStore`:

```ts
/** The simple page's routes: only its timed workouts, in data-simple/. */
export interface SimpleStore {
  loadWorkouts(): Promise<TimedWorkoutLibrary>;
  saveWorkouts(library: TimedWorkoutLibrary): Promise<void>;
}

export function createSimpleStore(base = "/api/simple"): SimpleStore {
  return {
    async loadWorkouts() {
      const res = await request(`${base}/workouts`);
      return (await res.json()) as TimedWorkoutLibrary;
    },
    async saveWorkouts(library) {
      await request(`${base}/workouts`, { method: "PUT", body: JSON.stringify(library) });
    },
  };
}
```

- [ ] **Step 2: Write `simple.html`**

The routine page's builder and run controls, with seconds in place of reps, and none of the mic, ding, count, set-control or tuning markup. The header gets its page links in Task 5.

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Rep Counter · Simple</title>
  </head>
  <body>
    <main>
      <header>
        <a class="page-link" href="/routine.html">← Routine</a>
      </header>

      <p id="error" role="alert" hidden></p>

      <fieldset id="builder">
        <legend>Workout</legend>
        <div id="workout-picker">
          <label>Saved workouts <select id="workout-select"></select></label>
          <button id="new-workout" type="button">New</button>
          <button id="delete-workout" type="button">Delete</button>
        </div>
        <label>Name <input id="workout-name" type="text" autocomplete="off" /></label>
        <ol id="activities"></ol>
        <p id="no-activities">No activities yet. Add the first one below.</p>
        <form id="add-activity">
          <label>Activity <input id="activity-name" type="text" placeholder="Hip thrust" autocomplete="off" /></label>
          <label>Seconds per set <input id="activity-seconds" type="number" min="1" step="5" value="60" /></label>
          <label>Sets <input id="activity-sets" type="number" min="1" step="1" value="3" /></label>
          <button type="submit">Add</button>
        </form>
        <label>Rest between sets <input id="rest" type="number" min="0" step="5" value="60" /> s</label>
        <small>0 waits until you press Start next set.</small>
        <label><input id="alternate-sets" type="checkbox" /> Alternate sets in pairs</label>
        <small>Takes the activities two at a time: a set of the first, then a set of the second, until both are done.</small>
      </fieldset>

      <section id="set">
        <div class="row">
          <button id="start" type="button">Start workout</button>
          <button id="restart" type="button" hidden>Start over</button>
        </div>
        <p id="now"></p>
        <p id="status" aria-live="polite">Ready</p>
        <p id="time-left" aria-label="Seconds left in the set">0</p>
        <div id="workout-controls" class="row" hidden>
          <button id="skip-rest" type="button" hidden>Skip rest</button>
          <button id="end-workout" type="button">End workout</button>
        </div>
      </section>
    </main>
    <script type="module" src="/src/simple.ts"></script>
  </body>
</html>
```

- [ ] **Step 3: Write `src/simple.ts`**

```ts
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
}).init();
```

- [ ] **Step 4: Style the countdown and seconds field**

In `src/style.css`, make the count's rule cover the countdown too, changing its selector from `#count {` to:

```css
#count,
#time-left {
```

and add `#activity-seconds` to the narrow-input rule at the end of the file:

```css
#activity-reps,
#activity-seconds,
#activity-sets,
#rest {
  width: 6em;
}
```

- [ ] **Step 5: Typecheck, test, and check the module graph**

Run: `npm run typecheck && npm test`
Expected: typecheck clean, all tests PASS.

Run: `grep -n "from \"./ui\"\|from \"./audio\|from \"./meter\"" src/simple.ts src/workout-page.ts src/countdown.ts src/dom.ts src/store.ts src/workout.ts src/chime.ts src/logs.ts src/detector.ts src/recording.ts`
Expected: no output (nothing the simple page loads pulls in `App` or the mic code).

- [ ] **Step 6: Check the simple page in the browser**

Make sure no `data-simple/` exists yet (`ls data-simple` fails). Run `npm run dev` in the background and open `http://localhost:5173/simple.html`. Check each of these:

1. No mic permission prompt appears, and the page has no mic picker, calibration, ding checkbox, count, meter or Save set data. In the browser, evaluate `performance.getEntriesByType("resource").map((e) => e.name).filter((n) => /\/src\/(ui|audio|meter|audio-recorder)\.ts/.test(n))` — expected `[]`.
2. The builder shows "Workout 1" with no activities. Add "hip thrust", 3 s, 2 sets and "plank", 2 s, 1 set. The list shows `2 × 3 s` and `1 × 2 s`; "First: hip thrust · set 1 of 2 · 3 s" shows and the countdown reads `3`.
3. Set rest to 2. Rename the workout "Test". Reload the page: the workout, its activities, rest 2 and name are all still there. Tick Alternate sets, reload: still ticked.
4. Start workout. The countdown runs 3, 2, 1 with status "Go!", dings, then status "Rest: 2 s" / "Rest: 1 s" with "Next: plank · set 1 of 1 · 2 s" (alternating), dings, runs plank, and so on until "Workout complete" / "Well done!". The builder is disabled while it runs.
5. Start again, press Skip rest during a rest (the next set starts at once, no ding), then End workout during a set: it stops with "Workout ended".
6. Set rest to 0, start: after the first set the button reads "Start next set" and waits for it.
Start over and Resume only appear after a run ends in an error, which the simple page's sets can't raise; that path is the shared loop already checked on the routine page.

Stop the dev server. Run `git status --short`. Expected: the only change is the new, untracked `data-simple/` folder, holding only `workouts.json`; nothing in `data/` or `data-routine/` changed. Then remove the test data: `rm -r data-simple`.

- [ ] **Step 7: Commit**

```bash
git add simple.html src/simple.ts src/store.ts src/style.css
git commit -m "feat(simple): add a workout page of timed sets

simple.html builds and runs workouts like the routine page, but each
set is a countdown of its seconds instead of counted reps, so it needs
no mic. It saves only its workouts, to data-simple/workouts.json, and
dings when a set's time is up and when a rest ends.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Header links between the three pages

**Files:**
- Modify: `index.html:14`, `routine.html:15`, `simple.html` (the header link)
- Modify: `src/style.css` (`.page-link` rule)

**Interfaces:**
- Consumes (Task 4): `simple.html` exists.
- Produces: a `nav.page-links` in each page's header linking all three pages, the current one marked `aria-current="page"`.

- [ ] **Step 1: Replace each page's single link with the same nav**

In `index.html`, replace `<a class="page-link" href="/routine.html">Routine →</a>` with:

```html
        <nav class="page-links">
          <a href="/" aria-current="page">Single set</a>
          <a href="/routine.html">Routine</a>
          <a href="/simple.html">Simple</a>
        </nav>
```

In `routine.html`, replace `<a class="page-link" href="/">← Single set</a>` with:

```html
        <nav class="page-links">
          <a href="/">Single set</a>
          <a href="/routine.html" aria-current="page">Routine</a>
          <a href="/simple.html">Simple</a>
        </nav>
```

In `simple.html`, replace `<a class="page-link" href="/routine.html">← Routine</a>` with:

```html
        <nav class="page-links">
          <a href="/">Single set</a>
          <a href="/routine.html">Routine</a>
          <a href="/simple.html" aria-current="page">Simple</a>
        </nav>
```

- [ ] **Step 2: Style the nav**

In `src/style.css`, replace the `.page-link` rule with:

```css
.page-links {
  margin-left: auto;
  display: flex;
  gap: 12px;
}

.page-links a {
  color: var(--accent);
}

.page-links a[aria-current="page"] {
  color: var(--fg);
  font-weight: 600;
  text-decoration: none;
}
```

Run: `grep -rn "page-link\b\|class=\"page-link\"" index.html routine.html simple.html src/style.css`
Expected: no output (no leftover single-link class).

- [ ] **Step 3: Check the links in the browser**

Run `npm run dev` in the background. On each of `/`, `/routine.html` and `/simple.html`, the header's right side shows "Single set · Routine · Simple" with the current page in bold, not underlined, and the other two links go to their pages. Stop the dev server; `git status --short` shows no data changes (remove any `data-simple/` this created).

- [ ] **Step 4: Final checks and commit**

Run: `npm run typecheck && npm test`
Expected: clean typecheck, all tests PASS.

```bash
git add index.html routine.html simple.html src/style.css
git commit -m "feat: link the single-set, routine and simple pages

Each page's header now links to all three, marking the one shown.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
