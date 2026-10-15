import { maskId, maskIndex, activeMask } from './packedMasks';
import { eventTarget } from '@cornerstonejs/core';
import { Enums, segmentation } from '@cornerstonejs/tools';
import { currentSource } from './masks';
import { config, sources } from './sourceStore';
import { activateNativeBrowse } from './navigation';
import { beginEditing, endEditing, requireEditing } from './editingState.mjs';
export { editingMask } from './editingState.mjs';
function restoreLocks(source) {
  for (const [id, index, locked] of source?.temporaryLocks || []) {
    if (segmentation.state.getSegmentation(id)) segmentation.segmentLocking.setSegmentIndexLocked(id, index, !!locked);
  }
  if (source) source.temporaryLocks = [];
}
const changed = () => window.dispatchEvent(new CustomEvent('nifti:editing-changed'));
export function enterMaskEditing(servicesManager, commandsManager, mask) {
  const { source, viewportId } = currentSource(servicesManager);
  if (source.masks.get(maskId(mask)) !== mask) throw Error('病例或 mask 已切换。');
  for (const other of sources.values()) restoreLocks(other);
  if (segmentation.segmentLocking.isSegmentIndexLocked(mask.segmentationId, maskIndex(mask)))
    throw Error('当前 mask 已锁定，请先解锁。');
  for (const other of sources.values()) endEditing(other);
  const service = servicesManager.services.segmentationService;
  service.setActiveSegmentation(viewportId, mask.segmentationId);
  service.setActiveSegment(mask.segmentationId, maskIndex(mask));
  source.temporaryLocks = [];
  const seg = segmentation.state.getSegmentation(mask.segmentationId);
  for (const key of Object.keys(seg.segments)) {
    const index = Number(key);
    if (index === maskIndex(mask)) continue;
    const locked = segmentation.segmentLocking.isSegmentIndexLocked(mask.segmentationId, index);
    source.temporaryLocks.push([mask.segmentationId, index, !!locked]);
    segmentation.segmentLocking.setSegmentIndexLocked(mask.segmentationId, index, true);
  }
  beginEditing(source, maskId(mask));
  changed();
  commandsManager.run('setToolActive', {
    toolName: config.enableNiftiAI ? 'Probe2' : 'CircularBrush',
  });
}
export function exitMaskEditing(servicesManager) {
  for (const source of sources.values()) { restoreLocks(source); endEditing(source); }
  changed(); // Invalidate in-flight AI before changing the tool.
  activateNativeBrowse(servicesManager);
}
export function currentEditingMask(servicesManager) {
  const { source, viewportId } = currentSource(servicesManager);
  const id = servicesManager.services.segmentationService.getActiveSegmentation(viewportId)?.segmentationId;
  const mask = requireEditing(source, id);
  if (activeMask(source, id) !== mask) throw Error('当前 Entity 已切换，请重新进入编辑。');
  return mask;
}
const editingTool = name =>
  /Brush|Eraser|Scissors|LabelmapSlicePropagation|Marker|RegionSegment|Probe2|RectangleROI2|PlanarFreehandROI[23]/.test(
    name || ''
  );
export function installEditingGuard(servicesManager) {
  const valid = () => {
    try {
      currentEditingMask(servicesManager);
      return true;
    } catch {
      return false;
    }
  };
  eventTarget.addEventListener(Enums.Events.TOOL_ACTIVATED, event => {
    // This guard applies only to native CT workspaces.
    try {
      currentSource(servicesManager);
    } catch {
      return;
    }
    if (editingTool(event.detail.toolName) && !valid()) activateNativeBrowse(servicesManager);
  });
  document.addEventListener(
    'mousedown',
    event => {
      if (
        !(event.target as HTMLElement)?.closest?.(
          '.cornerstone-viewport-element, .viewport-element'
        )
      )
        return;
      let viewportId;
      try {
        ({ viewportId } = currentSource(servicesManager));
      } catch {
        return;
      }
      const group = servicesManager.services.toolGroupService.getToolGroupForViewport(viewportId);
      if (!editingTool(group?.getActivePrimaryMouseButtonTool()) || valid()) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      activateNativeBrowse(servicesManager);
    },
    true
  );
}
