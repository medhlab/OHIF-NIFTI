/** Unclaimed legacy masks remain loadable; owned masks stay within their active Case. */
export function canLoadSavedMask(item, context) {
  if (!context) return true;
  if (item.annotationCaseId && item.annotationCaseId !== context.caseId) return false;
  const active = context.entities.some(e => e.maskId === item.maskId) ||
    context.anatomyLayers.some(layer => layer.maskIds.includes(item.maskId));
  return active || !item.annotationCaseId;
}

/** Registration happens after legacy autoload. Attach business identity without touching pixels. */
export function bindLoadedMask(mask, context) {
  if (!context || !mask.saved || mask.anatomyReadOnly) return;
  const owner = mask.annotationCaseId || mask.saved.annotationCaseId;
  if (owner && owner !== context.caseId) return;
  const entity = context.entities.find(e => e.maskId === mask.saved.maskId);
  if (!entity) return;
  mask.entityId = entity.id;
  mask.annotationCaseId = context.caseId;
  mask.saved = { ...mask.saved, entityId: entity.id, annotationCaseId: context.caseId };
}
