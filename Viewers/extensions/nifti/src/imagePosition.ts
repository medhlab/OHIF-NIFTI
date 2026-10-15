const KEY = 'ohif-nifti-slice-positions-v1';
function positions() {
  try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { return {}; }
}
export function rememberSlice(descriptor, slice) {
  if (!descriptor.sourceId || !Number.isInteger(slice) || slice < 0 || slice >= descriptor.dimensions[2]) return;
  try {
    const saved = positions();
    delete saved[descriptor.sourceId];
    saved[descriptor.sourceId] = { hash: descriptor.contentHash, geometry: descriptor.geometryHash, slice };
    const keys = Object.keys(saved);
    for (const id of keys.slice(0, Math.max(0, keys.length - 100))) delete saved[id];
    localStorage.setItem(KEY, JSON.stringify(saved));
  } catch { /* Position persistence must never interrupt navigation. */ }
}
export function restoredSlice(descriptor) {
  const saved = positions()?.[descriptor.sourceId];
  return saved && saved.hash === descriptor.contentHash && saved.geometry === descriptor.geometryHash &&
    Number.isInteger(saved.slice) && saved.slice >= 0 && saved.slice < descriptor.dimensions[2]
    ? saved.slice : Math.floor(descriptor.dimensions[2] / 2);
}
