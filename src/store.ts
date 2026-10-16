import type { CalibrationLog, LogKind, SetLog } from "./logs";
import type { SetRecording, StoreFile, WorkoutLibrary } from "./store-schema";

/** The save server's routes for one data folder: /api for data/, /api/routine for data-routine/. */
export interface Store {
  loadStore(): Promise<StoreFile>;
  saveStore(store: StoreFile): Promise<void>;
  /** Saves a set recording and returns its path in the project. */
  saveRecording(recording: SetRecording): Promise<string>;
  /** Writes a set or calibration log, replacing any earlier version with the same id. */
  saveLog(kind: LogKind, log: SetLog | CalibrationLog): Promise<string>;
  /** Writes an attempt's audio next to its log, as <data>/logs/<kind>/<id>.webm. */
  saveAudio(kind: LogKind, id: string, audio: Blob): Promise<string>;
  loadWorkouts(): Promise<WorkoutLibrary>;
  saveWorkouts(library: WorkoutLibrary): Promise<void>;
}

export function createStore(base = "/api"): Store {
  return {
    async loadStore() {
      const res = await request(`${base}/calibration`);
      return (await res.json()) as StoreFile;
    },
    async saveStore(store) {
      await request(`${base}/calibration`, { method: "PUT", body: JSON.stringify(store) });
    },
    async saveRecording(recording) {
      const res = await request(`${base}/fixtures`, { method: "POST", body: JSON.stringify(recording) });
      return ((await res.json()) as { path: string }).path;
    },
    async saveLog(kind, log) {
      const res = await request(`${base}/logs/${kind}/${log.id}`, { method: "PUT", body: JSON.stringify(log) });
      return ((await res.json()) as { path: string }).path;
    },
    async saveAudio(kind, id, audio) {
      const res = await request(`${base}/logs/${kind}/${id}.webm`, { method: "PUT", body: audio }, "audio/webm");
      return ((await res.json()) as { path: string }).path;
    },
    async loadWorkouts() {
      const res = await request(`${base}/workouts`);
      return (await res.json()) as WorkoutLibrary;
    },
    async saveWorkouts(library) {
      await request(`${base}/workouts`, { method: "PUT", body: JSON.stringify(library) });
    },
  };
}

async function request(url: string, init: RequestInit = {}, contentType = "application/json"): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(url, { ...init, headers: { "content-type": contentType } });
  } catch {
    throw new Error("Couldn't reach the save server. Is `npm run dev` still running?");
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `${res.status} ${res.statusText}`);
  }
  return res;
}
