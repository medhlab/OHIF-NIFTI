export function voxelDirty(mask) {
  if (!mask.saved) return true;
  if (mask.savedHashes && mask.hashes)
    return mask.hashes.length !== mask.savedHashes.length || mask.hashes.some((h, i) => h !== mask.savedHashes[i]);
  return mask.revision !== mask.savedRevision;
}

export function metadataChanges(mask, color) {
  if (!mask.saved) return {};
  const changes = {};
  if (mask.label !== mask.saved.name) changes.name = mask.label;
  // An automatically assigned color on a legacy mask is not a user edit.
  if (JSON.stringify(color) !== JSON.stringify(mask.saved.displayColor || mask.displayColor))
    changes.displayColor = color;
  return changes;
}

export function saveSummary(results) {
  const count = status => results.filter(r => r.status === status).length;
  return `保存 ${count('saved')} 个，更新名称/颜色 ${count('metadata')} 个，未修改跳过 ${count('skipped')} 个，失败 ${results.filter(r => !r.success).length} 个。`;
}
