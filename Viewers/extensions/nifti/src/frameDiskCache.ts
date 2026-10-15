/** Compressed frames only. CacheStorage is browser-managed storage, not a JS heap pool. */
const NAME = 'ohif-nifti-prefetch-v1';
export const PREFETCH_BYTES = 512 * 1024 ** 2;
const key = (sourceId, descriptor, index) => new URL(`/__nifti_prefetch__/${sourceId}/${descriptor.cacheKey}/${index}`, location.origin).href;
let serial = Promise.resolve();
export async function takePrefetchedFrame(sourceId, descriptor, index) {
  try {
    if (typeof caches === 'undefined') return;
    const store = await caches.open(NAME), url = key(sourceId, descriptor, index);
    const response = await store.match(url);
    if (!response) return;
    if (response.headers.get('X-Nifti-Cache-Key') !== descriptor.cacheKey || response.headers.get('X-Nifti-Frame') !== String(index)) { await store.delete(url); return; }
    await store.delete(url);
    return response;
  } catch { return; }
}
export async function keepPrefetchSources(sourceIds) {
  if (typeof caches === 'undefined') return false;
  try {
    const store = await caches.open(NAME);
    for (const request of await store.keys()) if (!sourceIds.some(id => new URL(request.url).pathname.startsWith(`/__nifti_prefetch__/${id}/`))) await store.delete(request);
    return true;
  } catch { return false; }
}
export async function hasPrefetchedFrame(sourceId, descriptor, index) {
  try { return !!(await (await caches.open(NAME)).match(key(sourceId, descriptor, index))); } catch { return false; }
}
export function storePrefetchedFrame(sourceId, descriptor, index, blob, headers, signal) {
  const write = async () => {
    signal?.throwIfAborted();
    const store = await caches.open(NAME);
    let bytes = 0;
    for (const request of await store.keys()) {
      const response = await store.match(request);
      bytes += Number(response?.headers.get('X-Nifti-Prefetch-Bytes') || 0);
    }
    if (bytes + blob.size > PREFETCH_BYTES) return false;
    const saved = new Headers(headers);
    saved.set('X-Nifti-Prefetch-Bytes', String(blob.size));
    signal?.throwIfAborted();
    await store.put(key(sourceId, descriptor, index), new Response(blob, { headers: saved }));
    return true;
  };
  // Serialize the quota check and write across tabs sharing this origin.
  const work = serial.then(() => typeof navigator !== 'undefined' && navigator.locks
    ? navigator.locks.request(NAME, write) : write()).catch(() => false);
  serial = work.then(() => {});
  return work;
}
