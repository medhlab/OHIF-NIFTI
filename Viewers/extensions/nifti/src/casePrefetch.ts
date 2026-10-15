import { prefetchFrames } from './prefetchPool.mjs';
import { request, openManifestCase } from './api';
import { annotationRequest } from './annotationClient';
import { getWorkspace } from './workspace';
import { prepareStreaming } from './streaming';
import { outwardSlices } from './frameQueue.mjs';
import { keepPrefetchSources, hasPrefetchedFrame, storePrefetchedFrame } from './frameDiskCache';
let running;
export function cancelCasePrefetch() { running?.abort(); running = undefined; }
export async function followingSources(workspace, sourceId, signal) {
  const selection = workspace.manifest?.prefetchSelection;
  if (selection) {
    const found = [];
    let after = false;
    for (let offset = 0; ; offset += 100) {
      const query = new URLSearchParams({ split: selection.split, search: selection.search, offset: String(offset), limit: '100' });
      const page = await annotationRequest(`/datasets/${encodeURIComponent(selection.datasetId)}/cases?${query}`, undefined, signal);
      for (const row of page.items) {
        if (after && row.sourceId && row.sourceId !== sourceId && !found.includes(row.sourceId)) found.push(row.sourceId);
        if (row.sourceId === sourceId) after = true;
        if (found.length === 2) return found;
      }
      if (offset + page.items.length >= page.totalCases || !page.items.length) return found.filter(Boolean);
    }
  }
  const rows = workspace.manifest?.items || [];
  const index = rows.findIndex(r => r.caseId === workspace.caseId);
  const ids = [];
  if (index < 0) return ids;
  for (const row of rows.slice(index + 1, index + 3)) {
    signal?.throwIfAborted();
    let id = row.sourceId;
    if (!id) {
      // Prepare only the image. Omitting manifestId avoids importing annotations
      // or changing the worklist while another case is being annotated.
      const reply = await openManifestCase({ image: row.image, segmentations: [], base: workspace.manifest.base,
        unit: workspace.manifest.unit, modality: row.modality || workspace.manifest.modality || 'CT' }, signal);
      id = reply.descriptor.sourceId;
      row.sourceId = id;
    }
    if (id !== sourceId && !ids.includes(id)) ids.push(id);
  }
  return ids;
}
/** Starts after the current volume is complete. Never registers/imports future masks. */
export function startCasePrefetch(source) {
  if (source.prefetchSuppressed || source.prefetchStarted || source.stream?.disposed || !source.stream?.loaded.every(Boolean)) return;
  source.prefetchStarted = true;
  cancelCasePrefetch();
  const controller = new AbortController(); running = controller;
  source.prefetchController = controller;
  const signal = controller.signal;
  const workspace = getWorkspace();
  source.prefetch = { state: 'loading', cases: [], bytes: 0, frames: 0 };
  (async () => {
    const ids = await followingSources(workspace, source.descriptor.sourceId, signal);
    if (!await keepPrefetchSources(ids)) { source.prefetch.state = 'unavailable'; return; }
    source.prefetch.cases = ids;
    for (const id of ids) {
      signal.throwIfAborted();
      const metadata = await (await request(`/${id}/metadata`, { signal })).json();
      const descriptor = await prepareStreaming(id, metadata, signal, () => {});
      const complete = await prefetchFrames(outwardSlices(descriptor.frames.length, Math.floor(descriptor.frames.length / 2)), async (index, signal) => {
        signal.throwIfAborted();
        if (await hasPrefetchedFrame(id, descriptor, index)) return true;
        const response = await request(`/${id}/frames/${index}`, { signal, cache: 'no-store' });
        if (response.headers.get('X-Nifti-Cache-Key') !== descriptor.cacheKey || response.headers.get('X-Nifti-Frame') !== String(index)) throw Error('预取帧身份不匹配。');
        // At most two frame pipelines, each with a bounded compressed buffer.
        const limit = descriptor.frames[index].bytes + Math.ceil(descriptor.frames[index].bytes / 16384) * 6 + 1024;
        const reader = response.body.getReader(), chunks = []; let size = 0;
        try {
          while (true) {
            const { done, value } = await reader.read(); if (done) break;
            size += value.byteLength;
            if (size > limit || size > 8 * 1024 ** 2) throw Error('预取帧超过缓冲区限额。');
            chunks.push(value);
          }
        } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
        if (!await storePrefetchedFrame(id, descriptor, index, new Blob(chunks), response.headers, signal)) return false;
        source.prefetch.bytes += size; source.prefetch.frames++;
        return true;
      }, signal);
      if (!complete) { source.prefetch.state = 'capacity'; return; }
    }
    source.prefetch.state = 'complete';
  })().catch(error => { source.prefetch.state = signal.aborted ? 'cancelled' : 'failed'; source.prefetch.error = error.message; });
}
