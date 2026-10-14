import { listMics, requestMicPermission, startMic, type MicSession } from "./audio";
import {
  deriveCalibration,
  exhalesComplete,
  noiseFloor,
  REQUIRED_EXHALES,
  segmentExhales,
  thresholdsFor,
  type Calibration,
} from "./calibration";
import { playChime } from "./chime";
import { Detector, type DetectorEvent, type Thresholds } from "./detector";
import type { Frame } from "./features";
import { Meter } from "./meter";
import { pickMic } from "./mic-choice";
import { buildRecording } from "./recording";
import { RepSet } from "./rep-set";
import { loadStore, saveRecording, saveStore } from "./store";
import type { StoreFile } from "./store-schema";

const CALIBRATION_QUIET_MS = 3000;
const SET_QUIET_MS = 2000;
const EXHALE_TIMEOUT_MS = 10_000;
const REJECTIONS_SHOWN = 8;

interface FinishedSet {
  mic: string;
  thresholds: Thresholds;
  frames: Frame[];
  detectedCount: number;
}

function el<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`The page is missing #${id}.`);
  return element as T;
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export class App {
  private readonly ui = {
    mic: el<HTMLSelectElement>("mic"),
    calStatus: el<HTMLSpanElement>("cal-status"),
    recalibrate: el<HTMLButtonElement>("recalibrate"),
    error: el<HTMLParagraphElement>("error"),
    target: el<HTMLInputElement>("target"),
    start: el<HTMLButtonElement>("start"),
    status: el<HTMLParagraphElement>("status"),
    countDone: el<HTMLSpanElement>("count-done"),
    countTarget: el<HTMLSpanElement>("count-target"),
    setControls: el<HTMLDivElement>("set-controls"),
    minus: el<HTMLButtonElement>("minus"),
    plus: el<HTMLButtonElement>("plus"),
    stop: el<HTMLButtonElement>("stop"),
    rejections: el<HTMLOListElement>("rejections"),
    saveForm: el<HTMLFormElement>("save-set"),
    actual: el<HTMLInputElement>("actual"),
    saveStatus: el<HTMLSpanElement>("save-status"),
  };
  private readonly meter = new Meter(el<HTMLCanvasElement>("meter"));
  private store: StoreFile = { mics: {} };
  private mics: MediaDeviceInfo[] = [];
  private busy = false;

  private session: MicSession | null = null;
  private activeMic: string | null = null;
  /** Receives frames from the open mic, if anything is listening. */
  private frameSink: ((frame: Frame) => void) | null = null;
  /** Rejects whatever the current flow is waiting on, when the mic is lost. */
  private pending: { reject: (err: Error) => void } | null = null;
  private endSet: ((outcome: "complete" | "stopped") => void) | null = null;
  private currentSet: RepSet | null = null;
  private finishedSet: FinishedSet | null = null;

  async init(): Promise<void> {
    this.ui.start.addEventListener("click", () => void this.run(() => this.runSet()));
    this.ui.recalibrate.addEventListener("click", () => void this.run(() => this.recalibrate()));
    this.ui.mic.addEventListener("change", () => void this.chooseMic());
    this.ui.target.addEventListener("input", () => this.renderCount(0, Number(this.ui.target.value) || 0));
    this.ui.plus.addEventListener("click", () => this.adjust(1));
    this.ui.minus.addEventListener("click", () => this.adjust(-1));
    this.ui.stop.addEventListener("click", () => this.endSet?.("stopped"));
    this.ui.saveForm.addEventListener("submit", (event) => {
      event.preventDefault();
      void this.saveSet();
    });

    // Without the saved calibrations, a later save would overwrite the file,
    // so stop here and leave the controls disabled until it is fixed.
    try {
      this.store = await loadStore();
    } catch (err) {
      this.setBusy(true);
      this.showError(`Couldn't load saved calibrations: ${message(err)}`);
      return;
    }
    try {
      await requestMicPermission();
    } catch (err) {
      this.setBusy(true);
      this.showError(`Microphone access is needed to count reps: ${message(err)}`);
      return;
    }
    navigator.mediaDevices.addEventListener("devicechange", () => void this.refreshMics());
    await this.refreshMics();
  }

  // ---- flows ----

  /** Runs one flow at a time, showing any error it ends with. */
  private async run(flow: () => Promise<void>): Promise<void> {
    if (this.busy) return;
    this.setBusy(true);
    this.clearError();
    try {
      await flow();
    } catch (err) {
      this.frameSink = null;
      this.currentSet = null;
      await this.closeMic();
      this.ui.setControls.hidden = true;
      this.setStatus("Ready");
      this.showError(message(err));
    } finally {
      this.pending = null;
      this.endSet = null;
      this.setBusy(false);
    }
  }

  private async recalibrate(): Promise<void> {
    await this.calibrate(this.selectedMic());
    this.setStatus("Calibrated. Ready.");
  }

  private async runSet(): Promise<void> {
    const target = Number(this.ui.target.value);
    if (!Number.isInteger(target) || target < 1) throw new Error("Enter a target of at least 1 rep.");
    const mic = this.selectedMic();
    const calibration = this.store.mics[mic] ?? (await this.calibrate(mic));

    await this.openMic(mic);
    this.meter.reset(null);
    this.ui.rejections.replaceChildren();
    this.ui.saveForm.hidden = true;
    this.finishedSet = null;
    this.renderCount(0, target);
    this.setStatus("Stay quiet…");
    const quiet = await this.collect(SET_QUIET_MS);

    const thresholds = thresholdsFor(calibration, noiseFloor(quiet));
    const detector = new Detector(thresholds);
    const set = new RepSet(target);
    const recording: FinishedSet = { mic, thresholds, frames: [], detectedCount: 0 };
    this.currentSet = set;
    this.meter.reset(thresholds);
    this.ui.setControls.hidden = false;
    this.setStatus("Go!");

    this.frameSink = (frame) => {
      recording.frames.push(frame);
      this.meter.addFrame(frame);
      const event = detector.push(frame);
      if (!event) return;
      this.meter.addEvent(event);
      if (event.kind === "rep") {
        recording.detectedCount++;
        this.adjust(1);
      } else {
        this.addRejection(event);
      }
    };

    const outcome = await this.waitForSetEnd();
    this.frameSink = null;
    this.currentSet = null;
    await this.closeMic();
    this.ui.setControls.hidden = true;
    this.finishedSet = recording;
    this.ui.actual.value = String(set.count);
    this.ui.saveStatus.textContent = "";
    this.ui.saveForm.hidden = false;

    if (outcome === "complete") {
      this.setStatus("Set complete");
      await playChime();
    } else {
      this.setStatus("Stopped");
    }
  }

  private async calibrate(mic: string): Promise<Calibration> {
    await this.openMic(mic);
    try {
      this.meter.reset(null);
      this.setStatus("Calibrating: stay quiet…");
      const quiet = await this.collect(CALIBRATION_QUIET_MS);
      const floor = noiseFloor(quiet);

      this.setStatus(`Breathe out hard ${REQUIRED_EXHALES} times, like at the end of a rep`);
      const exhales = await this.collect(EXHALE_TIMEOUT_MS, (frames) => {
        const heard = Math.min(segmentExhales(frames, floor).length, REQUIRED_EXHALES);
        this.setStatus(`Breathe out hard ${REQUIRED_EXHALES} times: heard ${heard}`);
        return exhalesComplete(frames, floor);
      });

      const result = deriveCalibration(quiet, exhales);
      if (!result.ok) throw new Error(`Calibration failed. ${result.reason}`);
      this.store = { ...this.store, lastMic: mic, mics: { ...this.store.mics, [mic]: result.calibration } };
      this.renderCalibration();
      try {
        await saveStore(this.store);
      } catch (err) {
        throw new Error(`Calibrated, but couldn't save it: ${message(err)}`);
      }
      return result.calibration;
    } finally {
      await this.closeMic();
    }
  }

  // ---- mic ----

  private async openMic(label: string): Promise<void> {
    const device = this.mics.find((m) => m.label === label);
    if (!device) throw new Error(`"${label}" is not connected.`);
    // onEnded can fire before startMic resolves, while this.session is unset.
    let endedDuringSetup = false;
    const session = await startMic(
      device.deviceId,
      (frame) => this.frameSink?.(frame),
      () => {
        if (this.session === null) endedDuringSetup = true;
        else this.loseMic(label);
      },
    );
    if (endedDuringSetup) {
      await session.stop();
      throw new Error(`Lost the microphone "${label}".`);
    }
    this.session = session;
    this.activeMic = label;
  }

  private async closeMic(): Promise<void> {
    const session = this.session;
    this.session = null;
    this.activeMic = null;
    await session?.stop();
  }

  private loseMic(label: string): void {
    this.frameSink = null;
    void this.closeMic();
    this.pending?.reject(new Error(`Lost the microphone "${label}". The set was stopped.`));
  }

  /** Collects frames for `ms` of audio time, or until `done` returns true. */
  private collect(ms: number, done?: (frames: Frame[]) => boolean): Promise<Frame[]> {
    return new Promise((resolve, reject) => {
      const frames: Frame[] = [];
      this.pending = { reject };
      this.frameSink = (frame) => {
        frames.push(frame);
        this.meter.addFrame(frame);
        if (frame.t - frames[0].t >= ms || done?.(frames)) {
          this.frameSink = null;
          this.pending = null;
          resolve(frames);
        }
      };
    });
  }

  private waitForSetEnd(): Promise<"complete" | "stopped"> {
    return new Promise((resolve, reject) => {
      this.pending = { reject };
      this.endSet = (outcome) => {
        this.pending = null;
        this.endSet = null;
        resolve(outcome);
      };
    });
  }

  private async refreshMics(): Promise<void> {
    this.mics = await listMics();
    const labels = this.mics.map((m) => m.label);
    if (this.activeMic !== null && !labels.includes(this.activeMic)) this.loseMic(this.activeMic);

    const chosen = pickMic(labels, this.ui.mic.value || null, this.store.lastMic);
    this.ui.mic.replaceChildren(...labels.map((label) => new Option(label, label)));
    if (chosen !== null) this.ui.mic.value = chosen;
    if (labels.length === 0) {
      this.setStatus("No microphone found. Connect the headset and switch it to headset (HFP) mode.");
    }
    this.renderCalibration();
  }

  private async chooseMic(): Promise<void> {
    this.renderCalibration();
    this.store = { ...this.store, lastMic: this.ui.mic.value };
    try {
      await saveStore(this.store);
    } catch (err) {
      this.showError(`Couldn't save the mic choice: ${message(err)}`);
    }
  }

  private selectedMic(): string {
    const mic = this.ui.mic.value;
    if (!mic) throw new Error("Choose a microphone first.");
    return mic;
  }

  // ---- set ----

  private adjust(delta: 1 | -1): void {
    const set = this.currentSet;
    if (!set) return;
    set.add(delta);
    this.renderCount(set.count, set.target);
    if (set.complete) this.endSet?.("complete");
  }

  private async saveSet(): Promise<void> {
    if (!this.finishedSet) return;
    const actualCount = Number(this.ui.actual.value);
    if (!Number.isInteger(actualCount) || actualCount < 0) {
      this.showError("Enter how many reps you actually did.");
      return;
    }
    try {
      const path = await saveRecording(buildRecording({ ...this.finishedSet, actualCount }));
      this.ui.saveStatus.textContent = `Saved to ${path}`;
    } catch (err) {
      this.showError(`Couldn't save the set data: ${message(err)}`);
    }
  }

  // ---- rendering ----

  private renderCount(done: number, target: number): void {
    this.ui.countDone.textContent = String(done);
    this.ui.countTarget.textContent = String(target);
  }

  private renderCalibration(): void {
    const calibration = this.store.mics[this.ui.mic.value];
    this.ui.calStatus.textContent = calibration
      ? `Calibrated ✓ (${new Date(calibration.calibratedAt).toLocaleDateString()})`
      : "Not calibrated";
  }

  private addRejection(event: Extract<DetectorEvent, { kind: "rejected" }>): void {
    const item = document.createElement("li");
    item.textContent = `${(event.t / 1000).toFixed(1)} s: ${event.reason}`;
    this.ui.rejections.prepend(item);
    while (this.ui.rejections.children.length > REJECTIONS_SHOWN) this.ui.rejections.lastElementChild?.remove();
  }

  private setBusy(busy: boolean): void {
    this.busy = busy;
    this.ui.start.disabled = busy;
    this.ui.recalibrate.disabled = busy;
    this.ui.mic.disabled = busy;
    this.ui.target.disabled = busy;
  }

  private setStatus(text: string): void {
    this.ui.status.textContent = text;
  }

  private showError(text: string): void {
    this.ui.error.textContent = text;
    this.ui.error.hidden = false;
  }

  private clearError(): void {
    this.ui.error.hidden = true;
  }
}
