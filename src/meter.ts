import type { DetectorEvent, Thresholds } from "./detector";
import type { Frame } from "./features";

const WINDOW_MS = 10_000;
const MIN_DB = -100;
const MAX_DB = 0;

/** Scrolling 10 s dB trace with threshold lines and rep/rejection markers. */
export class Meter {
  private frames: Frame[] = [];
  private events: DetectorEvent[] = [];
  private thresholds: Thresholds | null = null;
  private drawPending = false;

  constructor(private readonly canvas: HTMLCanvasElement) {}

  reset(thresholds: Thresholds | null): void {
    this.frames = [];
    this.events = [];
    this.thresholds = thresholds;
    this.scheduleDraw();
  }

  addFrame(frame: Frame): void {
    this.frames.push(frame);
    const cutoff = frame.t - WINDOW_MS;
    while (this.frames.length > 0 && this.frames[0].t < cutoff) this.frames.shift();
    this.events = this.events.filter((e) => e.t >= cutoff);
    this.scheduleDraw();
  }

  addEvent(event: DetectorEvent): void {
    this.events.push(event);
    this.scheduleDraw();
  }

  private scheduleDraw(): void {
    if (this.drawPending) return;
    this.drawPending = true;
    requestAnimationFrame(() => {
      this.drawPending = false;
      this.draw();
    });
  }

  private draw(): void {
    const { canvas } = this;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    const dpr = window.devicePixelRatio;
    if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const style = getComputedStyle(canvas);
    const color = (name: string) => style.getPropertyValue(name).trim();
    const now = this.frames.at(-1)?.t ?? 0;
    const x = (t: number) => width - ((now - t) / WINDOW_MS) * width;
    const y = (db: number) => height - ((Math.min(MAX_DB, Math.max(MIN_DB, db)) - MIN_DB) / (MAX_DB - MIN_DB)) * height;

    if (this.thresholds) {
      ctx.setLineDash([6, 4]);
      ctx.lineWidth = 1;
      for (const [db, name] of [
        [this.thresholds.onDb, "--meter-on"],
        [this.thresholds.offDb, "--meter-off"],
      ] as const) {
        ctx.strokeStyle = color(name);
        ctx.beginPath();
        ctx.moveTo(0, y(db));
        ctx.lineTo(width, y(db));
        ctx.stroke();
      }
      ctx.setLineDash([]);
    }

    for (const event of this.events) {
      ctx.strokeStyle = color(event.kind === "rep" ? "--meter-rep" : "--meter-reject");
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x(event.t), 0);
      ctx.lineTo(x(event.t), height);
      ctx.stroke();
    }

    ctx.strokeStyle = color("--meter-trace");
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    this.frames.forEach((f, i) => (i === 0 ? ctx.moveTo(x(f.t), y(f.db)) : ctx.lineTo(x(f.t), y(f.db))));
    ctx.stroke();
  }
}
