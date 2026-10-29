/** Finish every solve, but publish only the most recently requested input. */
export class LatestJobs<T, R> {
  private pending?: { value: T; revision: number };
  private revision = 0;
  private running = false;
  private disposed = false;

  constructor(private callbacks: {
    run(value: T): Promise<R>;
    publish(result: R, input: T): Promise<void> | void;
    error(error: unknown): void;
    busy(value: boolean): void;
    idle(): void;
  }) {}

  request(value: T) {
    if (this.disposed) return;
    this.pending = { value, revision: ++this.revision };
    void this.drain();
  }

  private async drain() {
    if (this.running || this.disposed) return;
    this.running = true;
    this.callbacks.busy(true);
    while (this.pending && !this.disposed) {
      const job = this.pending;
      this.pending = undefined;
      try {
        const result = await this.callbacks.run(job.value);
        if (!this.disposed && job.revision === this.revision) {
          await this.callbacks.publish(result, job.value);
        }
      } catch (error) {
        if (!this.disposed && job.revision === this.revision) this.callbacks.error(error);
      }
    }
    this.running = false;
    if (!this.disposed) {
      this.callbacks.busy(false);
      this.callbacks.idle();
    }
  }

  invalidate() { this.revision++; this.pending = undefined; }

  dispose() { this.disposed = true; this.invalidate(); }
}
