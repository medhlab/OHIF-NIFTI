/** Cornerstone's cached-frame fast path leaves an older debounce timer alive.
 * Cancel it before every newer NIfTI navigation intent, including explicit jumps.
 */
const installed = Symbol.for('ohif.nifti.stackScrollGuard');
export function installStackScrollGuard(StackViewport, onNavigate = () => {}) {
  const prototype = StackViewport.prototype;
  if (prototype[installed]) return;
  const scroll = prototype.scroll;
  const setImageIdIndex = prototype.setImageIdIndex;
  const isNifti = viewport => viewport.getImageIds()?.[0]?.startsWith('nifti:');
  const cancel = viewport => {
    clearTimeout(viewport.debouncedTimeout);
    viewport.debouncedTimeout = undefined;
  };
  prototype.scroll = function (...args) {
    if (isNifti(this)) cancel(this);
    const result = scroll.apply(this, args);
    if (isNifti(this)) onNavigate(this.getImageIds()[this.targetImageIdIndex]);
    return result;
  };
  prototype.setImageIdIndex = function (index) {
    if (isNifti(this)) {
      cancel(this);
      onNavigate(this.getImageIds()[index]);
      // The core early return for the already displayed index must also cancel
      // the pending destination, otherwise the next wheel starts from that index.
      if (this.getCurrentImageIdIndex() === index) this.targetImageIdIndex = index;
    }
    return setImageIdIndex.call(this, index);
  };
  Object.defineProperty(prototype, installed, { value: true });
}
