import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import type { Plugin } from "vite";
import { isSetRecording, isStoreFile, type StoreFile } from "./src/store-schema";

const MAX_BODY_BYTES = 20 * 1024 * 1024;

class BadRequest extends Error {}

/** Serves /api/calibration and /api/fixtures from files in the project. */
export function storePlugin(): Plugin {
  return {
    name: "rep-counter-store",
    configureServer(server) {
      server.middlewares.use(createStoreHandler(server.config.root));
    },
  };
}

export function createStoreHandler(root: string) {
  const calibrationFile = path.join(root, "data", "calibration.json");
  const fixturesDir = path.join(root, "test", "fixtures");

  return async (req: IncomingMessage, res: ServerResponse, next: () => void): Promise<void> => {
    const route = `${req.method} ${req.url?.split("?")[0]}`;
    try {
      if (route === "GET /api/calibration") {
        send(res, 200, await readStore(calibrationFile));
      } else if (route === "PUT /api/calibration") {
        const body = await readJson(req);
        if (!isStoreFile(body)) throw new BadRequest("The calibration data is not in the expected format.");
        await writeAtomic(calibrationFile, `${JSON.stringify(body, null, 2)}\n`);
        send(res, 200, { ok: true });
      } else if (route === "POST /api/fixtures") {
        const body = await readJson(req);
        if (!isSetRecording(body)) throw new BadRequest("The set recording is not in the expected format.");
        const name = `set-${body.recordedAt.replace(/[^0-9A-Za-z]/g, "-")}.json`;
        await writeAtomic(path.join(fixturesDir, name), `${JSON.stringify(body)}\n`);
        send(res, 200, { path: `test/fixtures/${name}` });
      } else {
        next();
      }
    } catch (err) {
      send(res, err instanceof BadRequest ? 400 : 500, { error: err instanceof Error ? err.message : String(err) });
    }
  };
}

async function readStore(file: string): Promise<StoreFile> {
  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return { mics: {} };
    throw err;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("data/calibration.json is not valid JSON. Fix or delete it.");
  }
  if (!isStoreFile(parsed)) throw new Error("data/calibration.json is not in the expected format. Fix or delete it.");
  return parsed;
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES) throw new BadRequest("The request body is too large.");
    chunks.push(chunk as Buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new BadRequest("The request body is not valid JSON.");
  }
}

/** Writes to a temp file then renames it, so a failed write cannot corrupt the target. */
async function writeAtomic(file: string, contents: string): Promise<void> {
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
