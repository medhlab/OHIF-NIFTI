import { previewSlices, previewPixel } from './historyPreviewModel.mjs';
test('locates small targets outside the middle and removed-only changes', async () => {
 const older=new Uint8Array(20), current=new Uint8Array(20);older[1]=1;current[18]=1;current[19]=1;
 const result=await previewSlices(current,[2,2,5],older);
 expect(result.maskSlice).toBe(4);expect(result.changeSlice).toBe(4);expect(result.total).toBe(2);expect(result.addedTotal).toBe(2);expect(result.removedTotal).toBe(1);
 const empty=await previewSlices(new Uint8Array(20),[2,2,5],older);
 expect(empty.total).toBe(0);expect(empty.changeSlice).toBe(0);expect(empty.removedTotal).toBe(1);
});
test('reports unchanged, invalid geometry and cancellation explicitly',async()=>{
 const data=new Uint8Array([0,1,0,0]);const r=await previewSlices(data,[2,2,1],data);expect(r.addedTotal+r.removedTotal).toBe(0);
 await expect(previewSlices(data,[2,2,2])).rejects.toThrow('网格');
 await expect(previewSlices(data,[2,2,1],null,{throwIfAborted:()=>{throw Error('cancelled')}})).rejects.toThrow('cancelled');
});
test('preview renders additions, removals and empty areas without modifying buffers',()=>{
 expect(previewPixel(100,true,false,true,[1,2,3],1,false)).toEqual([80,230,173]);
 expect(previewPixel(100,false,true,true,[1,2,3],1,false)).toEqual([255,109,145]);
 expect(previewPixel(100,false,false,false,[1,2,3],1,true)).toEqual([0,0,0]);
 expect(previewPixel(100,true,true,false,[1,2,3],0,false)).toEqual([100,100,100]);
});

test('local zoom includes removed voxels and respects edge bounds', async()=>{
 const {previewBounds}=await import('./historyPreviewModel.mjs');
 const data=new Uint8Array(512*512),old=new Uint8Array(data.length);old[511]=1;
 const crop=previewBounds(data,old,512,512,0);expect(crop.x+crop.width).toBe(512);expect(crop.y).toBe(0);expect(crop.width).toBe(64);
 expect(previewBounds(data,null,512,512,0)).toEqual({x:0,y:0,width:512,height:512});
});
