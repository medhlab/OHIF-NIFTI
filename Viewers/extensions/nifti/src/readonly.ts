import { activeMask } from './packedMasks';
import { eventTarget } from '@cornerstonejs/core';
import { Enums } from '@cornerstonejs/tools';
import { currentSource } from './masks';
import { activateNativeBrowse } from './navigation';

export function activeAnatomyReadOnly(servicesManager) {
  try {
    const { source, viewportId } = currentSource(servicesManager);
    const id = servicesManager.services.segmentationService.getActiveSegmentation(viewportId)?.segmentationId;
    const mask = activeMask(source, id);
    return !!(mask?.anatomyReadOnly || mask?.saved?.anatomyReadOnly);
  } catch { return false; }
}

// Cornerstone locks existing label values; that alone still allows painting into background.
const editsLabelmap = name => /Brush|Eraser|Scissors|LabelmapSlicePropagation|Marker|RegionSegment/.test(name || '');
export function installAnatomyReadOnlyGuard(servicesManager) {
  eventTarget.addEventListener(Enums.Events.TOOL_ACTIVATED, event => {
    if (editsLabelmap(event.detail.toolName) && activeAnatomyReadOnly(servicesManager)) activateNativeBrowse(servicesManager);
  });
  document.addEventListener('mousedown', event => {
    if (!(event.target as HTMLElement)?.closest?.('.cornerstone-viewport-element') || !activeAnatomyReadOnly(servicesManager)) return;
    const { viewportId } = currentSource(servicesManager);
    const group = servicesManager.services.toolGroupService.getToolGroupForViewport(viewportId);
    if (!editsLabelmap(group?.getActivePrimaryMouseButtonTool())) return;
    event.preventDefault(); event.stopImmediatePropagation(); activateNativeBrowse(servicesManager);
  }, true);
}
