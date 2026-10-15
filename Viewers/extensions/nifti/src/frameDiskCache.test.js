/** @jest-environment node */
import { takePrefetchedFrame, storePrefetchedFrame, keepPrefetchSources, PREFETCH_BYTES } from './frameDiskCache';
let entries;
beforeEach(()=>{
 entries=new Map();global.location={origin:'http://localhost'};
 global.caches={open:async()=>({ keys:async()=>[...entries.keys()].map(url=>({url})), match:async k=>entries.get(k.url||k)?.clone(), delete:async k=>entries.delete(k.url||k), put:async(k,v)=>entries.set(k,v) })};
});
const descriptor={cacheKey:'version1'};
const headers=new Headers({'X-Nifti-Cache-Key':'version1','X-Nifti-Frame':'0'});
test('prefetched compressed data survives navigation and is consumed without another download',async()=>{
 expect(await storePrefetchedFrame('next',descriptor,0,new Blob(['compressed']),headers)).toBe(true);
 expect(await takePrefetchedFrame('next',{cacheKey:'changed'},0)).toBeUndefined();
 const reply=await takePrefetchedFrame('next',descriptor,0);
 expect(await reply.text()).toBe('compressed');expect(entries.size).toBe(0);
});
test('capacity and cancellation reject writes; unrelated cases are evicted',async()=>{
 entries.set('http://localhost/__nifti_prefetch__/old/v/0',new Response('',{headers:{'X-Nifti-Prefetch-Bytes':String(PREFETCH_BYTES)}}));
 expect(await storePrefetchedFrame('next',descriptor,0,new Blob(['x']),headers)).toBe(false);
 await keepPrefetchSources(['next']);expect(entries.size).toBe(0);
 const controller=new AbortController();controller.abort();
 expect(await storePrefetchedFrame('next',descriptor,0,new Blob(['x']),headers,controller.signal)).toBe(false);
 expect(entries.size).toBe(0);
});
test('storage unavailability degrades to normal network loading',async()=>{
 global.caches={open:async()=>{throw Error('quota or unavailable')}};
 expect(await takePrefetchedFrame('next',descriptor,0)).toBeUndefined();
 expect(await keepPrefetchSources(['next'])).toBe(false);
});

test('writes use an origin-wide lock when available', async () => {
 const lock = jest.fn((name, work) => work());
 const previous = Object.getOwnPropertyDescriptor(global, 'navigator');
 Object.defineProperty(global, 'navigator', { configurable: true, value: { locks: { request: lock } } });
 try {
  expect(await storePrefetchedFrame('next', descriptor, 0, new Blob(['x']), headers)).toBe(true);
  expect(lock).toHaveBeenCalledWith('ohif-nifti-prefetch-v1', expect.any(Function));
 } finally {
  if (previous) Object.defineProperty(global, 'navigator', previous);
  else delete global.navigator;
 }
});
