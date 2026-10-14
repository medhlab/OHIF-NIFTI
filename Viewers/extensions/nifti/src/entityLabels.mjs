/** Display ordinals are local to a Finding; persistent Entity UUIDs never change. */
export function entitiesForFinding(context, findingId) {
  const linked = new Set(
    context.links.filter(l => !findingId || l.findingId === findingId).map(l => l.entityId)
  );
  return context.entities.filter(e => (findingId ? linked.has(e.id) : !linked.has(e.id)));
}
export function entityLabel(context, entityId, findingId) {
  const number = entitiesForFinding(context, findingId).findIndex(e => e.id === entityId) + 1;
  const findingNumber = context.findings.findIndex(f => f.id === findingId) + 1;
  return findingId ? `F${findingNumber}-E${number}` : `E${number}`;
}
export function entityLabels(context, entityId) {
  const ids = new Set(context.links.filter(l => l.entityId === entityId).map(l => l.findingId));
  const findings = context.findings.filter(f => ids.has(f.id));
  return findings.length
    ? findings.map(f => entityLabel(context, entityId, f.id)).join(' / ')
    : entityLabel(context, entityId);
}
