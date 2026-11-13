/**
 * Smoothed throughput of a growing byte counter. Uploads land in 10 MiB steps every
 * ~10 s, so an instantaneous rate flips between 0 and a spike; this averages over a
 * sliding window. `rate()` is null until the window has enough history. Feeding a new
 * `key` (e.g. another file) or a smaller value starts over. Plain class — call it from
 * event handlers / poll callbacks, not during render.
 */
export class RateMeter {
  private samples: { t: number; v: number }[] = [];
  private key = "";

  constructor(
    private windowMs: number,
    private minSpanMs = 10_000,
  ) {}

  add(key: string, value: number, now = Date.now()): void {
    const last = this.samples.at(-1);
    if (key !== this.key || (last && value < last.v)) {
      this.key = key;
      this.samples = [];
    }
    this.samples.push({ t: now, v: value });
    while (this.samples.length > 2 && now - this.samples[1].t >= this.windowMs) this.samples.shift();
  }

  reset(): void {
    this.samples = [];
    this.key = "";
  }

  /** Bytes per second, or null without enough history. */
  rate(): number | null {
    const first = this.samples[0];
    const last = this.samples.at(-1);
    if (!first || !last || last.t - first.t < this.minSpanMs) return null;
    return (last.v - first.v) / ((last.t - first.t) / 1000);
  }
}
