/** Preserve Entity order while a Finding is loaded incrementally. An earlier
 * pending mask must settle before a later Entity can become the initial target.
 */
export function firstReadyEntity(entities, pending, getMask, hasLocation) {
  for (const entity of entities) {
    if (pending.has(entity.maskId)) return;
    const mask = getMask(entity);
    if (mask && hasLocation(mask)) return entity;
  }
}
