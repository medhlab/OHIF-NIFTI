/** @jest-environment node */
import { beginImageCache, takePrefetchedFrame, storeImageFrame, storePrefetchedFrame, keepPrefetchSources, PREFETCH_BYTES, imageCacheStats, clearImageCache } from './frameDiskCache';
let entries;
beforeEach(()=>{
 entries=new Map();global.location={origin:'http://localhost'};
 global.caches={delete:jest.fn(async()=>true),open:async()=>({ keys:async()=>[...entries.keys()].map(url=>({url})), match:async k=>entries.get(k.url||k)?.clone(), delete:async k=>entries.delete(k.url||k), put:async(k,v)=>entries.set(k,v) })};
});
const d={cacheKey:'version1'};
const headers=(i=0,v='version1')=>new Headers({'X-Nifti-Cache-Key':v,'X-Nifti-Frame':String(i)});
const store=(id,epoch,i=0)=>storeImageFrame(id,d,i,new Blob(['compressed']),headers(i),undefined,epoch,true);
function inflate(id,bytes){
 const url=[...entries.keys()].find(k=>k.includes(`/${id}/`));
 const response=entries.get(url);const h=new Headers(response.headers);h.set('X-Nifti-Cache-Bytes',String(bytes));entries.set(url,new Response('compressed',{headers:h}));
 const indexUrl='http://localhost/__nifti_images__/index';
 return entries.get(indexUrl).clone().json().then(index=>{index.frames[url].bytes=bytes;entries.set(indexUrl,new Response(JSON.stringify(index)));});
}
test('current frames survive repeated reads, refresh activation and duplicate writes without double counting',async()=>{
 const epoch=await beginImageCache('current',d);expect(await store('current',epoch)).toBe(true);
 expect(await (await takePrefetchedFrame('current',d,0)).text()).toBe('compressed');
 const again=await beginImageCache('current',d);
 expect(await (await takePrefetchedFrame('current',d,0)).text()).toBe('compressed');
 expect(await store('current',again)).toBe(true);expect((await imageCacheStats()).bytes).toBe(10);
});
test('image version change removes old frames and cannot read old content',async()=>{
 const epoch=await beginImageCache('current',d);await store('current',epoch);
 await beginImageCache('current',{cacheKey:'version2'});
 expect(await takePrefetchedFrame('current',d,0)).toBeUndefined();expect((await imageCacheStats()).bytes).toBe(0);
});
test('current image evicts oldest history before next cases and total remains bounded',async()=>{
 let epoch=await beginImageCache('old',d);await store('old',epoch);await inflate('old',PREFETCH_BYTES-10);
 epoch=await beginImageCache('current',d);await keepPrefetchSources(['near','far'],epoch);
 expect(await storePrefetchedFrame('near',d,0,new Blob(['12345']),headers(),undefined,epoch)).toBe(true);
 expect(await store('current',epoch)).toBe(true);
 expect(await takePrefetchedFrame('old',d,0)).toBeUndefined();expect(await takePrefetchedFrame('near',d,0)).toBeDefined();
 expect((await imageCacheStats()).bytes).toBe(15);
});
test('prefetch cannot evict current image or nearer case; current can evict farthest case',async()=>{
 const epoch=await beginImageCache('current',d);await store('current',epoch);await inflate('current',PREFETCH_BYTES-10);
 await keepPrefetchSources(['near','far'],epoch);
 expect(await storePrefetchedFrame('near',d,0,new Blob(['1234567890']),headers(),undefined,epoch)).toBe(true);
 expect(await storePrefetchedFrame('far',d,0,new Blob(['x']),headers(),undefined,epoch)).toBe(false);
 expect(await store('current',epoch,1)).toBe(true);
 expect(await takePrefetchedFrame('near',d,0)).toBeUndefined();expect((await imageCacheStats()).bytes).toBe(PREFETCH_BYTES);
});
test('clear invalidates queued and in-flight writers until a new view session',async()=>{
 const epoch=await beginImageCache('current',d);await store('current',epoch);await keepPrefetchSources(['next'],epoch);
 expect(await clearImageCache()).toBe(true);
 expect(await store('current',epoch)).toBe(false);
 expect(await storePrefetchedFrame('next',d,0,new Blob(['x']),headers(),undefined,epoch)).toBe(false);
 expect((await imageCacheStats()).bytes).toBe(0);
 expect(await store('current',await beginImageCache('current',d))).toBe(true);
});
test('aborted writes and unavailable storage do not prevent image fallback',async()=>{
 const epoch=await beginImageCache('current',d), controller=new AbortController();controller.abort();
 expect(await storeImageFrame('current',d,0,new Blob(['x']),headers(),controller.signal,epoch,true)).toBe(false);
 global.caches={open:async()=>{throw Error('unavailable')}};
 expect(await takePrefetchedFrame('current',d,0)).toBeUndefined();expect(await beginImageCache('current',d)).toBeUndefined();
});
test('writes and clearing serialize through an origin-wide lock',async()=>{
 const lock=jest.fn((name,work)=>work());const previous=Object.getOwnPropertyDescriptor(global,'navigator');
 Object.defineProperty(global,'navigator',{configurable:true,value:{locks:{request:lock}}});
 try {const epoch=await beginImageCache('current',d);await store('current',epoch);await clearImageCache();expect(lock).toHaveBeenCalledWith('ohif-nifti-images-v2',expect.any(Function));}
 finally {if(previous)Object.defineProperty(global,'navigator',previous);else delete global.navigator;}
});
test('corrupt frame identity is discarded instead of reused',async()=>{
 const epoch=await beginImageCache('current',d);await store('current',epoch);
 const url=[...entries.keys()].find(k=>k.includes('/current/'));entries.set(url,new Response('bad',{headers:headers(99)}));
 expect(await takePrefetchedFrame('current',d,0)).toBeUndefined();expect((await imageCacheStats()).bytes).toBe(0);
});
