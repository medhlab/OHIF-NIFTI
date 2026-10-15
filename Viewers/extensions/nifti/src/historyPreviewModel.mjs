// Analyse original IJK planes, including removals that are absent from the selected mask.
export async function previewSlices(pixels, dimensions, previous, signal) {
  const [nx, ny, nz] = dimensions, plane = nx * ny;
  if (pixels.length !== plane * nz || (previous && previous.length !== pixels.length))
    throw Error('历史 mask 网格长度不一致。');
  const counts = [], added = [], removed = [];
  for (let z = 0; z < nz; z++) {
    signal?.throwIfAborted();
    let n = 0, a = 0, r = 0;
    for (let i = z * plane; i < (z + 1) * plane; i++) {
      const on = !!pixels[i]; n += Number(on);
      if (previous) { a += Number(on && !previous[i]); r += Number(!on && !!previous[i]); }
    }
    counts.push(n); added.push(a); removed.push(r);
    if (z % 16 === 15) await new Promise(resolve => setTimeout(resolve, 0));
  }
  signal?.throwIfAborted();
  const changes = added.map((a, i) => a + removed[i]);
  const largest = values => values.reduce((best, n, i) => n > values[best] ? i : best, 0);
  const maskSlice = counts.some(Boolean) ? largest(counts) : Math.floor(nz / 2);
  return { counts, added, removed, maskSlice, changeSlice: changes.some(Boolean) ? largest(changes) : maskSlice,
    total: counts.reduce((a,b) => a+b,0), addedTotal: added.reduce((a,b)=>a+b,0), removedTotal: removed.reduce((a,b)=>a+b,0) };
}

export function previewPixel(grey, on, wasOn, compare, color, opacity, maskOnly) {
  let tint = on ? color : null;
  if (compare && on && !wasOn) tint = [80, 230, 173];
  if (compare && !on && wasOn) tint = [255, 109, 145];
  const g = maskOnly ? 0 : grey, a = maskOnly ? 1 : opacity;
  return tint ? tint.slice(0,3).map(c => g * (1-a) + c*a) : [g,g,g];
}

export function previewBounds(pixels, previous, nx, ny, slice) {
  let left = nx, right = -1, top = ny, bottom = -1;
  const start = slice * nx * ny;
  for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
    const i = start + y * nx + x;
    if (pixels[i] || previous?.[i]) { left = Math.min(left,x); right = Math.max(right,x); top = Math.min(top,y); bottom = Math.max(bottom,y); }
  }
  if (right < 0) return {x:0,y:0,width:nx,height:ny};
  const side = Math.max(64, right-left+33, bottom-top+33), width = Math.min(nx,side), height = Math.min(ny,side);
  return {x:Math.max(0,Math.min(nx-width,Math.floor((left+right-width)/2))),y:Math.max(0,Math.min(ny-height,Math.floor((top+bottom-height)/2))),width,height};
}
