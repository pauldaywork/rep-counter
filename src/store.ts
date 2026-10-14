import type { SetRecording, StoreFile } from "./store-schema";

export async function loadStore(): Promise<StoreFile> {
  const res = await request("/api/calibration");
  return (await res.json()) as StoreFile;
}

export async function saveStore(store: StoreFile): Promise<void> {
  await request("/api/calibration", { method: "PUT", body: JSON.stringify(store) });
}

/** Saves a set recording and returns its path in the project. */
export async function saveRecording(recording: SetRecording): Promise<string> {
  const res = await request("/api/fixtures", { method: "POST", body: JSON.stringify(recording) });
  return ((await res.json()) as { path: string }).path;
}

async function request(url: string, init: RequestInit = {}): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(url, { ...init, headers: { "content-type": "application/json" } });
  } catch {
    throw new Error("Couldn't reach the save server. Is `npm run dev` still running?");
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `${res.status} ${res.statusText}`);
  }
  return res;
}
