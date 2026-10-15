import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FrameQueue, outwardSlices } from './frameQueue.mjs';
const tick = () => new Promise(r => setTimeout(r, 0));

test('deduplicates consumers, preserves current requests, reserves interaction slot', async () => {
  const pending = new Map(), calls = [], loaded = new Set();
  const queue = new FrameQueue(50, (i, signal) => new Promise((resolve, reject) => {
    calls.push(i); pending.set(i, () => { loaded.add(i); resolve(); });
    signal.addEventListener('abort', () => reject(signal.reason), { once: true });
  }), i => loaded.has(i));
  queue.prefetch(20); await tick();
  assert.equal(pending.size, 3);
  const subscriber = new AbortController();
  const first = queue.ensure(21, 'interactive', subscriber.signal).catch(e => e.name);
  const second = queue.ensure(21);
  subscriber.abort();
  const far = queue.ensure(45); await tick();
  assert.equal(calls.filter(i => i === 21).length, 1);
  assert(calls.includes(45));
  pending.get(21)(); pending.get(45)();
  assert.equal(await first, 'AbortError'); await second; await far;
  queue.close(); await tick(); assert.equal(queue.jobs.size, 0);
});

test('only fetches neighborhood and reuses loaded slices after jumps', async () => {
  const loaded = new Set([25]), calls = [];
  const queue = new FrameQueue(100, async i => { calls.push(i); loaded.add(i); }, i => loaded.has(i));
  queue.prefetch(25); for (let n=0;n<25;n++) await tick();
  assert.deepEqual([...loaded].sort((a,b)=>a-b), Array.from({length:17},(_,i)=>17+i));
  await queue.ensure(25); assert.equal(calls.length,16);
  await queue.ensure(90); queue.prefetch(90); for (let n=0;n<25;n++) await tick();
  assert(loaded.has(90)); assert(!loaded.has(50)); queue.close();
});

test('canceled prefetch cannot poison a new interactive subscriber', async () => {
  const queue = new FrameQueue(30, (i, signal) => new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, 5);
    signal.addEventListener('abort', () => { clearTimeout(timer); reject(signal.reason); }, {once:true});
  }), () => false);
  const abort = new AbortController();
  const old = queue.ensure(5, 'prefetch', abort.signal).catch(e=>e.name);
  await tick(); abort.abort(); const current = queue.ensure(5);
  assert.equal(await old, 'AbortError'); await current; queue.close();
});

test('a distant navigation cancels obsolete background work before its new frame displays', async () => {
  const started = [], signals = [];
  const queue = new FrameQueue(100, (index, signal) => new Promise((resolve, reject) => {
    started.push(index); signals.push(signal);
    signal.addEventListener('abort', () => reject(signal.reason), { once: true });
  }), () => false);
  queue.prefetch(10); await tick(); const old = [...signals];
  queue.cancelObsolete(80); const current = queue.ensure(80).catch(e => e.name); await tick();
  assert(old.every(signal => signal.aborted)); assert.equal(queue.nearby.size, 0);
  assert(started.includes(80)); assert.equal(queue.active, 1);
  queue.close(); assert.equal(await current, 'AbortError');
});


test('outward order covers the opening slice and both volume boundaries exactly once', () => {
  assert.deepEqual(outwardSlices(9, 4), [4, 5, 3, 6, 2, 7, 1, 8, 0]);
  assert.deepEqual(outwardSlices(4, 0), [0, 1, 2, 3]);
  assert.deepEqual(outwardSlices(4, 3), [3, 2, 1, 0]);
});

test('whole-volume background fill progresses beyond the neighborhood without another display', async () => {
  const loaded = new Set([25]), calls = [];
  const queue = new FrameQueue(50, async i => { calls.push(i); loaded.add(i); }, i => loaded.has(i));
  await Promise.all(outwardSlices(50, 25).map(i => queue.ensure(i, 'background')));
  assert.equal(loaded.size, 50); assert.equal(new Set(calls).size, 49);
  assert.deepEqual(calls.slice(0, 6), [26, 24, 27, 23, 28, 22]);
  assert(loaded.has(0) && loaded.has(49)); queue.close();
});

test('far navigation preempts queued background frames using the reserved slot and keeps the fill alive', async () => {
  const calls = [], pending = new Map(), loaded = new Set([10]);
  const queue = new FrameQueue(30, (i, signal) => new Promise((resolve, reject) => {
    calls.push(i); pending.set(i, () => { loaded.add(i); resolve(); });
    signal.addEventListener('abort', () => reject(signal.reason), { once: true });
  }), i => loaded.has(i));
  const fill = Promise.allSettled(outwardSlices(30, 10).map(i => queue.ensure(i, 'background')));
  await tick(); assert.deepEqual(calls, [11, 9, 12]); assert.equal(queue.active, 3);
  queue.cancelObsolete(28); const current = queue.ensure(28); await tick();
  assert.deepEqual(calls, [11, 9, 12, 28]); assert.equal(queue.active, 4);
  pending.get(28)(); await current;
  assert.equal(calls.filter(i => i === 28).length, 1);
  queue.close(); await fill; await tick(); assert.equal(queue.jobs.size, 0);
});

test('recenter pauses pending fill, keeps in-flight work, prioritizes target, then fills outward', async () => {
  const calls = [], pending = new Map(), loaded = new Set();
  const queue = new FrameQueue(10, (i, signal) => new Promise((resolve, reject) => {
    calls.push(i); pending.set(i, () => { pending.delete(i); loaded.add(i); resolve(); });
    signal.addEventListener('abort', () => reject(signal.reason), { once: true });
  }), i => loaded.has(i));
  const whole = Promise.all(outwardSlices(10, 2).map(i => queue.ensure(i, 'background')));
  await tick(); assert.deepEqual(calls, [2, 3, 1]);
  queue.recenter(5, 40);
  queue.recenter(8, 40);
  const target = queue.ensure(8);
  await tick(); assert.deepEqual(calls, [2, 3, 1, 8]);
  pending.get(2)(); pending.get(3)(); pending.get(1)(); pending.get(8)();
  await target; await tick(); assert.deepEqual(calls, [2, 3, 1, 8]);
  await new Promise(r => setTimeout(r, 50));
  assert.deepEqual(calls.slice(4), [9, 7, 6]);
  while (loaded.size < 10) { for (const finish of [...pending.values()]) finish(); await tick(); }
  await whole; assert.equal(new Set(calls).size, 10); assert.equal(calls.length, 10);
  queue.close();
});

test('closing a recentered queue cancels its delayed fill', async () => {
  const calls = [];
  const queue = new FrameQueue(3, async i => calls.push(i), () => false);
  queue.recenter(1, 10);
  const result = queue.ensure(1, 'background').catch(e => e.name);
  queue.close();
  assert.equal(await result, 'AbortError');
  await new Promise(r => setTimeout(r, 20));
  assert.deepEqual(calls, []);
});
