/** One explicit editing target per CT; selecting a layer is not entering editing. */
export function editingMask(source) {
  const mask = source?.masks.get(source.descriptor.editingSegmentationId);
  return mask && !mask.anatomyReadOnly && !mask.saved?.anatomyReadOnly ? mask : undefined;
}
export function beginEditing(source, id) {
  const mask = source.masks.get(id);
  if (!mask || mask.anatomyReadOnly || mask.saved?.anatomyReadOnly)
    throw Error('请选择一个可编辑的 Entity mask。');
  source.descriptor.editingSegmentationId = id;
  source.descriptor.editingEpoch = (source.descriptor.editingEpoch || 0) + 1;
  return mask;
}
export function endEditing(source) {
  if (!source) return;
  delete source.descriptor.editingSegmentationId;
  source.descriptor.editingEpoch = (source.descriptor.editingEpoch || 0) + 1;
}
export function requireEditing(source, activeId) {
  const mask = editingMask(source);
  if (!mask || mask.segmentationId !== activeId)
    throw Error('请先点击 Entity 或 mask 的编辑按钮，进入编辑状态。');
  return mask;
}
