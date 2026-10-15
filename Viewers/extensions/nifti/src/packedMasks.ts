import { cache } from '@cornerstonejs/core';
import { segmentation } from '@cornerstonejs/tools';
import { triggerSegmentationDataModified } from '@cornerstonejs/tools/segmentation/triggerSegmentationEvents';
import { reserve, release } from './sourceStore';

export const maskId = mask => mask.id || mask.segmentationId;
export const maskIndex = mask => mask.segmentIndex || 1;
export const bindings = mask => mask.bindings || [{ segmentationId: mask.segmentationId, segmentIndex: maskIndex(mask), imageIds: mask.imageIds }];
export function activeMask(source, segmentationId) {
  if (!source || !segmentationId) return;
  const index = segmentation.segmentIndex.getActiveSegmentIndex(segmentationId);
  return [...source.masks.values()].find((m: any) => m.segmentationId === segmentationId && maskIndex(m) === index);
}
export function maskSlices(binding) {
  return binding.imageIds.map(id => cache.getImage(id).voxelManager.getScalarData());
}
export function findingKeys(source, entityId, fallback) {
  const ids = source.annotationCase?.links.filter(l => l.entityId === entityId).map(l => l.findingId) || [];
  return ids.length ? [...new Set(ids)] : [fallback];
}
export async function allocateFinding(source, ds, service, key, label, entityId) {
  source.findingVolumes ||= new Map();
  let volume = source.findingVolumes.get(key);
  if (!volume) {
    const segmentationId = `${source.sourceKey}:finding:${crypto.randomUUID()}`;
    reserve(segmentationId, source.descriptor.count);
    source.packing = true;
    try {
      await service.createLabelmapForDisplaySet(ds, { segmentationId, label, segments: { 1: { label, active: true } } });
      volume = { segmentationId, imageIds: segmentation.state.getSegmentation(segmentationId).representationData.Labelmap.imageIds, nextIndex: 1, key };
      source.findingVolumes.set(key, volume);
    } catch (e) { release(segmentationId); throw e; }
    finally { source.packing = false; }
  }
  if (volume.nextIndex > 255) throw Error('一个 Finding 最多支持 255 个 Entity。');
  const segmentIndex = volume.nextIndex++;
  const seg = segmentation.state.getSegmentation(volume.segmentationId);
  service.addOrUpdateSegmentation({ segmentationId: volume.segmentationId, segments: { ...seg.segments, [segmentIndex]: { label, active: false, segmentIndex, cachedStats: { entityId } } } });
  return { ...volume, segmentIndex };
}
/** Validate all replicas before writing, so an imported Entity cannot erase a sibling. */
export function writeBinary(targets, pixels) {
  for (const target of targets) {
    let offset = 0;
    for (const slice of maskSlices(target)) for (const value of slice) {
      if (pixels[offset++] && value && value !== target.segmentIndex) throw Error('同一 Finding 的 Entity mask 存在重叠，未覆盖已有标注。');
    }
  }
  for (const target of targets) {
    let offset = 0;
    for (const slice of maskSlices(target)) for (let i = 0; i < slice.length; i++, offset++) {
      if (pixels[offset]) slice[i] = target.segmentIndex;
      else if (slice[i] === target.segmentIndex) slice[i] = 0;
    }
  }
}
/** Mirror shared Entity edits across Findings, clipping against other Entity labels. */
export function synchronizeEntity(mask, changedId) {
  const copies = bindings(mask);
  if (copies.length < 2) return;
  const origin = copies.find(b => b.segmentationId === changedId);
  if (!origin) return;
  const arrays = copies.map(maskSlices), from = copies.indexOf(origin);
  for (let z = 0; z < arrays[from].length; z++) {
    for (let i = 0; i < arrays[from][z].length; i++) {
      let on = arrays[from][z][i] === origin.segmentIndex;
      if (on && copies.some((b, n) => arrays[n][z][i] && arrays[n][z][i] !== b.segmentIndex)) on = false;
      copies.forEach((b, n) => {
        const old = arrays[n][z][i];
        if (!old || old === b.segmentIndex) arrays[n][z][i] = on ? b.segmentIndex : 0;
      });
    }
  }
}
export function removeMask(servicesManager, source, mask) {
  const targets = bindings(mask);
  source.masks.delete(maskId(mask));
  for (const target of targets) {
    for (const slice of maskSlices(target)) for (let i = 0; i < slice.length; i++) if (slice[i] === target.segmentIndex) slice[i] = 0;
    const retained = [...source.masks.values()].some((m: any) => bindings(m).some(b => b.segmentationId === target.segmentationId));
    if (retained) {
      segmentation.segmentLocking.setSegmentIndexLocked(target.segmentationId, target.segmentIndex, true);
      triggerSegmentationDataModified(target.segmentationId);
    } else {
      servicesManager.services.segmentationService.remove(target.segmentationId);
      for (const [key, volume] of source.findingVolumes || []) if (volume.segmentationId === target.segmentationId) source.findingVolumes.delete(key);
      for (const id of target.imageIds) if (cache.getImageLoadObject(id)) cache.removeImageLoadObject(id, { force: true });
      release(target.segmentationId);
    }
  }
}
