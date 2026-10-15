/** Native NIfTI frame readiness is independent of the asynchronous viewport render. */
export function sliceLoadingState(viewport) {
  const ids = viewport?.getImageIds?.();
  const target = ids?.[viewport?.getTargetImageIdIndex?.() ?? viewport?.targetImageIdIndex]
    ?? viewport?.getCurrentImageId?.();
  const image = viewport?.getCornerstoneImage?.();
  const ready = image?.niftiIsImageLoaded?.(target);
  return { target, loading: Boolean(target && (typeof ready === 'boolean' ? !ready : image?.imageId !== target)) };
}
