import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import type { Plugin } from "vite";
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

const MAX_BODY_BYTES = 20 * 1024 * 1024;

class BadRequest extends Error {}

/** Where one store keeps its files, relative to the project root. */
export interface StoreLocation {
  /** the URL prefix its routes live under */
  prefix: string;
  dataDir: string;
  fixturesDir: string;
}

const MAIN_STORE: StoreLocation = { prefix: "/api", dataDir: "data", fixturesDir: "test/fixtures" };
/** The routine page keeps everything apart from the single-set page, for separate testing. */
export const ROUTINE_STORE: StoreLocation = {
  prefix: "/api/routine",
  dataDir: "data-routine",
  fixturesDir: "data-routine/fixtures",
};
/** The simple page has no mic, so its store keeps only its timed workouts. */
export const SIMPLE_STORE: Pick<StoreLocation, "prefix" | "dataDir"> = { prefix: "/api/simple", dataDir: "data-simple" };

type Handler = (req: IncomingMessage, res: ServerResponse, next: () => void) => Promise<void>;
/** Serves one request, given as "METHOD /path" below the store's prefix. Returns false for a route it doesn't serve. */
type Routes = (route: string, req: IncomingMessage, res: ServerResponse) => Promise<boolean>;

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

function readStore(file: string, name: string): Promise<StoreFile> {
  return readJsonFile(file, name, { mics: {} }, isStoreFile);
}

/** Reads a JSON file, or returns `empty` when there is none yet. `name` is how errors refer to it. */
async function readJsonFile<T>(file: string, name: string, empty: T, valid: (x: unknown) => x is T): Promise<T> {
  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return empty;
    throw err;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`${name} is not valid JSON. Fix or delete it.`);
  }
  if (!valid(parsed)) throw new Error(`${name} is not in the expected format. Fix or delete it.`);
  return parsed;
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  if (!req.headers["content-type"]?.startsWith("application/json")) {
    throw new BadRequest("Expected a JSON request body.");
  }
  const body = await readBody(req);
  try {
    return JSON.parse(body.toString("utf8"));
  } catch {
    throw new BadRequest("The request body is not valid JSON.");
  }
}

async function readBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES) throw new BadRequest("The request body is too large.");
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
}

/** Writes to a temp file then renames it, so a failed write cannot corrupt the target. */
async function writeAtomic(file: string, contents: string | Buffer): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temp, contents);
  await rename(temp, file);
}

function send(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(body));
}
