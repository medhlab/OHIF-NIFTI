/** Native NIfTI frame readiness is independent of the asynchronous viewport render. */
export function sliceLoadingState(viewport) {
  // MPR/3D render a volume, not a Cornerstone stack image. An axial volume can
  // still return a source image ID, which must not imply a pending stack frame.
  if (viewport?.type && viewport.type !== 'stack') return { target: undefined, loading: false };
  const ids = viewport?.getImageIds?.();
  const target = ids?.[viewport?.getTargetImageIdIndex?.() ?? viewport?.targetImageIdIndex]
    ?? viewport?.getCurrentImageId?.();
  const image = viewport?.getCornerstoneImage?.();
  const ready = image?.niftiIsImageLoaded?.(target);
  return { target, loading: Boolean(target && (typeof ready === 'boolean' ? !ready : image?.imageId !== target)) };
}
