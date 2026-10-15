/** Browser disk cache: compressed CT frames only, never masks or decoded volumes. */
const NAME = 'ohif-nifti-images-v2';
const OLD_NAME = 'ohif-nifti-prefetch-v1';
export const PREFETCH_BYTES = 512 * 1024 ** 2;
const key = (sourceId, descriptor, index) => new URL(`/__nifti_images__/${encodeURIComponent(sourceId)}/${encodeURIComponent(descriptor.cacheKey)}/${index}`, location.origin).href;
const indexKey = () => new URL('/__nifti_images__/index', location.origin).href;
let serial = Promise.resolve(), initializedStorage;
const emptyIndex = () => ({ epoch: 0, current: '', next: [], frames: {}, cases: {} });
const bytesUsed = state => Object.values(state.frames).reduce((sum: number, frame: any) => sum + frame.bytes, 0) as number;

async function readIndex(store) {
  let state;
  try { state = await (await store.match(indexKey()))?.json(); } catch { /* Recover from frame headers below. */ }
  if (!state || !Number.isInteger(state.epoch) || !state.frames || !state.cases) state = emptyIndex();
  if (initializedStorage !== caches) {
    // Reconcile once per page: interrupted writes and browser eviction must not
    // leave invisible bytes outside the shared capacity accounting.
    const frames = {};
    for (const request of await store.keys()) {
      if (request.url === indexKey()) continue;
      const response = await store.match(request);
      const sourceId = response?.headers.get('X-Nifti-Source-Id');
      const version = response?.headers.get('X-Nifti-Cache-Key');
      const index = Number(response?.headers.get('X-Nifti-Frame'));
      const bytes = Number(response?.headers.get('X-Nifti-Cache-Bytes'));
      if (!sourceId || !version || !Number.isInteger(index) || index < 0 || !(bytes > 0) || bytes > PREFETCH_BYTES || request.url !== key(sourceId, { cacheKey: version }, index)) {
        await store.delete(request); continue;
      }
      frames[request.url] = { sourceId, version, bytes };
      state.cases[sourceId] ||= { touched: 0 };
    }
    state.frames = frames;
    await caches.delete(OLD_NAME);
    await saveIndex(store, state);
    initializedStorage = caches;
  }
  return state;
}
async function saveIndex(store, state) {
  await store.put(indexKey(), new Response(JSON.stringify(state), { headers: { 'Content-Type': 'application/json' } }));
}
function transaction(work) {
  const run = async () => {
    if (typeof caches === 'undefined') return;
    const store = await caches.open(NAME), state = await readIndex(store);
    return work(store, state);
  };
  const result = serial.then(() => typeof navigator !== 'undefined' && navigator.locks
    ? navigator.locks.request(NAME, run) : run()).catch(() => { initializedStorage = undefined; return undefined; });
  serial = result.then(() => {});
  return result;
}
async function removeFrames(store, state, predicate) {
  for (const [url, frame] of Object.entries(state.frames)) if (predicate(frame)) {
    await store.delete(url); delete state.frames[url];
  }
}

/** Start a new viewing session; clear invalid versions before accepting writes. */
export function beginImageCache(sourceId, descriptor) {
  return transaction(async (store, state) => {
    await removeFrames(store, state, frame => frame.sourceId === sourceId && frame.version !== descriptor.cacheKey);
    state.current = sourceId; state.next = [];
    state.cases[sourceId] = { touched: Date.now(), version: descriptor.cacheKey };
    await saveIndex(store, state);
    return state.epoch;
  });
}

/** Reads are reusable across refresh. Identity and decoded SHA are checked separately. */
export async function takePrefetchedFrame(sourceId, descriptor, index) {
  try {
    const store = await caches.open(NAME), url = key(sourceId, descriptor, index);
    const response = await store.match(url);
    if (!response) return;
    if (response.headers.get('X-Nifti-Cache-Key') !== descriptor.cacheKey || response.headers.get('X-Nifti-Frame') !== String(index)) {
      await discardCachedFrame(sourceId, descriptor, index); return;
    }
    return response;
  } catch { return; }
}
export function discardCachedFrame(sourceId, descriptor, index) {
  return transaction(async (store, state) => {
    const url = key(sourceId, descriptor, index);
    await store.delete(url); delete state.frames[url]; await saveIndex(store, state);
  });
}
export function keepPrefetchSources(sourceIds, epoch) {
  return transaction(async (store, state) => {
    if (epoch === undefined || epoch !== state.epoch) return false;
    state.next = sourceIds;
    await saveIndex(store, state); return true;
  });
}
export function preparePrefetchCache(sourceId, descriptor, epoch) {
  return transaction(async (store, state) => {
    if (epoch === undefined || epoch !== state.epoch || !state.next.includes(sourceId)) return false;
    await removeFrames(store, state, frame => frame.sourceId === sourceId && frame.version !== descriptor.cacheKey);
    state.cases[sourceId] = { touched: state.cases[sourceId]?.touched || Date.now(), version: descriptor.cacheKey };
    await saveIndex(store, state); return true;
  });
}
export async function hasPrefetchedFrame(sourceId, descriptor, index) {
  return Boolean(await takePrefetchedFrame(sourceId, descriptor, index));
}

export function storeImageFrame(sourceId, descriptor, index, blob, headers, signal, epoch, current = false) {
  return transaction(async (store, state) => {
    signal?.throwIfAborted();
    // Clearing invalidates all in-flight writers, including other browser tabs.
    if (epoch === undefined || state.epoch !== epoch || blob.size > PREFETCH_BYTES || !blob.size) return false;
    if (current ? state.current !== sourceId : !state.next.includes(sourceId)) return false;
    if (state.cases[sourceId]?.version && state.cases[sourceId].version !== descriptor.cacheKey) return false;
    if (headers.get('X-Nifti-Cache-Key') !== descriptor.cacheKey || headers.get('X-Nifti-Frame') !== String(index)) return false;
    await removeFrames(store, state, frame => frame.sourceId === sourceId && frame.version !== descriptor.cacheKey);
    const url = key(sourceId, descriptor, index);
    let bytes = bytesUsed(state) - (state.frames[url]?.bytes || 0);
    // History is least-recently-used. Current image has priority over both next
    // cases; a nearer prefetch may replace a farther one, never the reverse.
    const rank = id => id === state.current ? 3 : state.next.includes(id) ? 2 - state.next.indexOf(id) : 0;
    const incomingRank = current ? 3 : rank(sourceId);
    const victims = [...new Set(Object.values(state.frames).map((frame: any) => frame.sourceId))]
      .filter(id => id !== sourceId && rank(id) < incomingRank)
      .sort((a, b) => rank(a) - rank(b) || (state.cases[a]?.touched || 0) - (state.cases[b]?.touched || 0));
    for (const victim of victims) {
      if (bytes + blob.size <= PREFETCH_BYTES) break;
      await removeFrames(store, state, frame => frame.sourceId === victim);
      delete state.cases[victim]; bytes = bytesUsed(state) - (state.frames[url]?.bytes || 0);
    }
    if (bytes + blob.size > PREFETCH_BYTES) { await saveIndex(store, state); return false; }
    const saved = new Headers(headers);
    saved.set('X-Nifti-Source-Id', sourceId); saved.set('X-Nifti-Cache-Bytes', String(blob.size));
    signal?.throwIfAborted();
    try {
      await store.put(url, new Response(blob, { headers: saved }));
      state.frames[url] = { sourceId, version: descriptor.cacheKey, bytes: blob.size };
      state.cases[sourceId] ||= { touched: Date.now() };
      await saveIndex(store, state);
      return true;
    } catch {
      // Quota/storage failure is optional-cache failure, not image failure.
      await store.delete(url); delete state.frames[url];
      await saveIndex(store, state); return false;
    }
  }).then(Boolean);
}
export function storePrefetchedFrame(sourceId, descriptor, index, blob, headers, signal, epoch) {
  return storeImageFrame(sourceId, descriptor, index, blob, headers, signal, epoch);
}
export function imageCacheStats() {
  return transaction(async (store, state) => ({ bytes: bytesUsed(state), limit: PREFETCH_BYTES,
    frames: Object.keys(state.frames).length, cases: new Set(Object.values(state.frames).map((frame: any) => frame.sourceId)).size }));
}
export function clearImageCache() {
  return transaction(async (store, state) => {
    const cleared = { ...emptyIndex(), epoch: state.epoch + 1 };
    // Persist the new epoch first so a partial failure still invalidates writers.
    await saveIndex(store, cleared);
    for (const request of await store.keys()) if (request.url !== indexKey()) await store.delete(request);
    return true;
  }).then(Boolean);
}
