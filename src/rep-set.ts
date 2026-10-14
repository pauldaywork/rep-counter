/** The rep count for one set, including manual +1/−1 corrections. */
export class RepSet {
  private reps = 0;

  constructor(readonly target: number) {
    if (!Number.isInteger(target) || target < 1) throw new RangeError("The target must be a whole number of at least 1.");
  }

  get count(): number {
    return this.reps;
  }

  get complete(): boolean {
    return this.reps >= this.target;
  }

  add(delta: 1 | -1): void {
    if (delta > 0 && this.complete) return;
    this.reps = Math.max(0, this.reps + delta);
  }
}
