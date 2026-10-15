import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { installStackScrollGuard } from './stackScrollGuard.mjs';

// Execute the actual installed Cornerstone methods, not a rewritten approximation.
const source = readFileSync(new URL('../../../node_modules/@cornerstonejs/core/dist/esm/RenderingEngine/StackViewport.js', import.meta.url), 'utf8');
function method(name) {
  const start = source.indexOf(`    ${name}(`);
  assert.ok(start >= 0, `Missing Cornerstone ${name}`);
  const brace = source.indexOf('{', start);
  let depth = 1, end = brace + 1;
  while (depth && end < source.length) { if (source[end] === '{') depth++; if (source[end] === '}') depth--; end++; }
  return source.slice(start, end).trim();
}
function fixture(patch = true, scheme = 'nifti:') {
  let id = 0; const timers = new Map(), loaded = new Set([10, 12]);
  const clear = key => timers.delete(key);
  const viewportClass = new Function('cache', 'window', 'clearTimeout', 'triggerEvent', 'Events',
    `return class { ${method('scroll')} ${method('setImageIdIndex')} }`)(
    { isLoaded: image => loaded.has(Number(image.split(':')[1])) },
    { setTimeout: fn => { timers.set(++id, fn); return id; } }, clear, () => {}, { STACK_VIEWPORT_SCROLL: 'scroll' });
  if (patch) installStackScrollGuard(viewportClass);
  const v = new viewportClass();
  Object.assign(v, { imageIds: Array.from({length:30},(_,i)=>scheme+i), targetImageIdIndex:10, currentImageIdIndex:10,
    shown:[], getImageIds(){return this.imageIds;}, getCurrentImageIdIndex(){return this.currentImageIdIndex;},
    getCurrentImageId(){return this.imageIds[this.currentImageIdIndex];}, _throwIfDestroyed(){},
    _setImageIdIndex(i){this.currentImageIdIndex=i;this.shown.push(i);return Promise.resolve(this.imageIds[i]);} });
  return {v, timers, flush(){for(const [key,fn] of [...timers]) {timers.delete(key);fn();}}, viewportClass, clear};
}
// Guard uses the host clearTimeout; fake it only for these synchronous tests.
function run(fn, patch=true, scheme='nifti:') {
  const f=fixture(patch,scheme), old=globalThis.clearTimeout;
  globalThis.clearTimeout=f.clear;
  try {fn(f);} finally {globalThis.clearTimeout=old;}
}
test('unpatched dependency reproduces forward-scroll reversal',()=>run(({v,flush})=>{
  v.scroll(1);v.scroll(1);flush();assert.deepEqual(v.shown,[12,11]);
},false));
test('cached next slice supersedes pending uncached slice',()=>run(({v,flush})=>{
  v.scroll(1);v.scroll(1);flush();assert.deepEqual(v.shown,[12]);assert.equal(v.targetImageIdIndex,12);
}));
test('explicit Entity/slider jump supersedes pending wheel',()=>run(({v,flush})=>{
  v.scroll(1);v.setImageIdIndex(20);flush();assert.deepEqual(v.shown,[20]);
}));
test('reverse back to displayed slice resets pending target',()=>run(({v,flush})=>{
  v.scroll(1);v.setImageIdIndex(10);flush();assert.equal(v.targetImageIdIndex,10);assert.deepEqual(v.shown,[]);
}));
test('uncached burst still debounces to latest target',()=>run(({v,flush})=>{
  v.scroll(3);v.scroll(1);flush();assert.deepEqual(v.shown,[14]);
}));
test('DICOM behavior unchanged and installation idempotent',()=>run(({v,flush,viewportClass})=>{
  const original=viewportClass.prototype.scroll;installStackScrollGuard(viewportClass);assert.equal(viewportClass.prototype.scroll,original);
  v.scroll(1);v.scroll(1);flush();assert.deepEqual(v.shown,[12,11]);
},true,'dicom:'));
