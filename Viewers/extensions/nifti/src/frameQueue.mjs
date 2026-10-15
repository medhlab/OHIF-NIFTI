const rank = { interactive: 0, prefetch: 1, complete: 2, background: 3 };
const aborted = () => new DOMException('Cancelled', 'AbortError');

/** Consumer cancellation never cancels a frame still needed by another viewport. */
export class FrameQueue {
  constructor(count, load, isLoaded, onChange = () => {}) {
    Object.assign(this, { count, load, isLoaded, onChange });
    this.jobs = new Map(); this.nearby = new Map(); this.active = 0; this.background = 0;
    this.sequence = 0; this.closed = false;
  }
  ensure(index, kind = 'interactive', signal) {
    if (signal?.aborted || this.closed) return Promise.reject(aborted());
    if (!Number.isInteger(index) || index < 0 || index >= this.count) return Promise.reject(Error('Invalid NIfTI slice index.'));
    if (this.isLoaded(index)) return Promise.resolve();
    let job = this.jobs.get(index);
    if (job?.controller.signal.aborted) { this.jobs.delete(index); job = undefined; }
    if (!job) {
      job = { index, controller: new AbortController(), consumers: new Map(), order: this.sequence++, running: false };
      this.jobs.set(index, job);
    }
    const token = Symbol();
    const promise = new Promise((resolve, reject) => {
      const cancel = () => { detach(); reject(aborted()); this.drain(); };
      const detach = () => {
        signal?.removeEventListener('abort', cancel); job.consumers.delete(token);
        if (!job.consumers.size && this.jobs.get(index) === job) {
          if (job.running) job.controller.abort(); else this.jobs.delete(index);
        }
      };
      job.consumers.set(token, { kind, resolve: () => { detach(); resolve(); }, reject: e => { detach(); reject(e); } });
      signal?.addEventListener('abort', cancel, { once: true });
    });
    this.drain(); return promise;
  }
  priority(job) { return Math.min(...[...job.consumers.values()].map(c => rank[c.kind])); }
  recenter(center, delay = 120) {
    clearTimeout(this.recenterTimer);
    this.fillPaused = true;
    const order = new Map(outwardSlices(this.count, center).map((index, i) => [index, i]));
    for (const job of this.jobs.values()) job.order = order.get(job.index);
    this.cancelObsolete(center, 0);
    this.recenterTimer = setTimeout(() => {
      this.fillPaused = false; this.drain();
    }, delay);
  }
  drain() {
    if (this.closed) return;
    while (this.active < 4) {
      const job = [...this.jobs.values()].filter(j => !j.running && j.consumers.size)
        .sort((a, b) => this.priority(a) - this.priority(b) || a.order - b.order)
        .find(j => this.priority(j) === 0 || (this.background < 3 && (!this.fillPaused || this.priority(j) === 2)));
      if (!job) break;
      job.running = true; job.background = this.priority(job) !== 0;
      this.active++; if (job.background) this.background++;
      Promise.resolve().then(() => this.load(job.index, job.controller.signal)).then(
        () => this.finish(job), error => this.finish(job, error));
    }
    this.onChange();
  }
  finish(job, error) {
    if (this.jobs.get(job.index) === job) this.jobs.delete(job.index);
    this.active--; if (job.background) this.background--;
    for (const c of [...job.consumers.values()]) error ? c.reject(error) : c.resolve();
    this.drain();
  }
  cancelObsolete(center, radius = 8) {
    for (const [index, controller] of this.nearby) {
      if (Math.abs(index - center) > radius) { controller.abort(); this.nearby.delete(index); }
    }
  }
  prefetch(center, radius = 8) {
    if (this.closed) return;
    const direction = Math.sign(center - (this.center ?? center)) || 1;
    this.center = center;
    const desired = [];
    for (let d = 1; d <= radius; d++) for (const sign of [direction, -direction]) {
      const index = center + sign * d;
      if (index >= 0 && index < this.count) desired.push(index);
    }
    this.cancelObsolete(center, radius);
    for (const index of desired) if (!this.isLoaded(index) && !this.nearby.has(index)) {
      const controller = new AbortController(); this.nearby.set(index, controller);
      this.ensure(index, 'prefetch', controller.signal).catch(() => {}).finally(() => {
        if (this.nearby.get(index) === controller) this.nearby.delete(index);
      });
    }
  }
  close() {
    this.closed = true;
    clearTimeout(this.recenterTimer);
    for (const controller of this.nearby.values()) controller.abort();
    this.nearby.clear();
    for (const job of this.jobs.values()) {
      job.controller.abort();
      for (const c of [...job.consumers.values()]) c.reject(aborted());
    }
    this.jobs.clear();
  }
}

/** Visit every slice once, alternating upward/downward from the opening slice. */
export function outwardSlices(count, center) {
  if (!Number.isInteger(center) || center < 0 || center >= count) throw Error('Invalid NIfTI slice index.');
  const indices = [center];
  for (let distance = 1; indices.length < count; distance++) {
    if (center + distance < count) indices.push(center + distance);
    if (center - distance >= 0) indices.push(center - distance);
  }
  return indices;
}
