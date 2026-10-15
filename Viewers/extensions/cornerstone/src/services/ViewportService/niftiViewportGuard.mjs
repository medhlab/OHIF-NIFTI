/** Resolve the current viewport at event time: a reused element can own a new viewport. */
export function installNiftiViewportGuard(element, getViewport, newImageEvent) {
  if (element.__niftiInputGuard) return;
  element.addEventListener(newImageEvent, () => {
    const viewport = getViewport(element);
    const image = viewport?.getCornerstoneImage?.();
    if (image?.imageId === viewport?.getCurrentImageId()) image?.niftiOnDisplayed?.();
  });
  const guard = event => {
    const viewport = getViewport(element);
    const actual = viewport?.getCornerstoneImage?.()?.imageId;
    if (actual !== viewport?.getCurrentImageId()) { event.preventDefault(); event.stopImmediatePropagation(); }
  };
  for (const type of ['mousedown', 'pointerdown', 'touchstart']) element.addEventListener(type, guard, true);
  element.__niftiInputGuard = true;
}
