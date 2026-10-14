import { cache } from '@cornerstonejs/core';

// Inspect loaded voxels, including unsaved edits; cache by the mask data revision.
const states = new WeakMap<object, { revision: number; empty: boolean }>();
export function entityMaskEmpty(source, entity) {
  const mask = [...(source?.masks.values() || [])].find((m: any) =>
    m.entityId === entity.id || (entity.maskId && m.saved?.maskId === entity.maskId)
  ) as any;
  if (!mask) return !entity.maskId; // An unloaded saved mask has unknown contents.
  const previous = states.get(mask);
  if (previous?.revision === mask.revision) return previous.empty;
  let empty = true;
  for (const id of mask.imageIds) {
    const pixels = cache.getImage(id)?.voxelManager.getScalarData();
    if (!pixels) return false;
    if (pixels.includes(1)) { empty = false; break; }
  }
  states.set(mask, { revision: mask.revision, empty });
  return empty;
}
