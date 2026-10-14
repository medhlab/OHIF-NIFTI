/** Describe the selected annotation without treating a Finding or Entity as a lesion. */
export function describeAnnotationTarget(context, mask, categories: Record<string, string>) {
  const readOnly = mask?.anatomyReadOnly || mask?.saved?.anatomyReadOnly;
  const entity = context?.entities.find(
    e => e.id === mask?.entityId || (e.maskId && e.maskId === mask?.saved?.maskId)
  );
  const findingIds =
    context?.links.filter(link => link.entityId === entity?.id).map(link => link.findingId) || [];
  const observationIds =
    entity?.reportObservations?.map(observation => observation.observationId) || [];
  const codes = [
    ...new Set<string>(
      [
        ...(context?.findings
          .filter(finding => findingIds.includes(finding.id))
          .map(finding => finding.category) || []),
        ...(context?.reportExtraction?.observations
          .filter(observation => observationIds.includes(observation.id))
          .map(observation => observation.category) || []),
      ].filter(Boolean)
    ),
  ];
  const title = readOnly
    ? `只读结构 · ${mask.label}`
    : entity
      ? `E${context.entities.indexOf(entity) + 1} · ${entity.name}`
      : mask
        ? `未绑定 Entity · ${mask.label}`
        : '未选择 Entity';
  const categoryText = readOnly
    ? '辅助图层'
    : codes.length
      ? codes.map(code => `${code} · ${categories[code] || code}`).join(' / ')
      : '未分类';
  return { entityId: entity?.id || '', title, categoryText };
}
