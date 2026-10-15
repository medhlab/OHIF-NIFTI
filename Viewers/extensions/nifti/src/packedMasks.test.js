import { triggerSegmentationDataModified } from '@cornerstonejs/tools/segmentation/triggerSegmentationEvents';
import { allocateFinding, writeBinary, synchronizeEntity, findingKeys, removeMask, notifyImportedMask } from './packedMasks';
import { cache } from '@cornerstonejs/core';
import { segmentation } from '@cornerstonejs/tools';
import { reserve } from './sourceStore';
jest.mock('@cornerstonejs/core', () => ({ cache: { getImage: jest.fn(), getImageLoadObject: jest.fn() } }), { virtual: true });
jest.mock('@cornerstonejs/tools', () => ({ segmentation: { state: { getSegmentation: jest.fn() }, segmentLocking: { setSegmentIndexLocked: jest.fn() } } }), { virtual: true });
jest.mock('@cornerstonejs/tools/segmentation/triggerSegmentationEvents', () => ({ triggerSegmentationDataModified: jest.fn() }), { virtual: true });
jest.mock('./sourceStore', () => ({ reserve: jest.fn(), release: jest.fn() }));
const arrays = new Map(), segs = new Map();
beforeEach(() => {
  jest.resetAllMocks(); arrays.clear(); segs.clear();
  let sequence = 0; Object.defineProperty(global, 'crypto', { configurable: true, value: { randomUUID: () => String(++sequence) } });
  cache.getImage.mockImplementation(id => ({ voxelManager: { getScalarData: () => arrays.get(id) } }));
  segmentation.state.getSegmentation.mockImplementation(id => segs.get(id));
});
function service() {
 return {
  createLabelmapForDisplaySet: jest.fn(async (ds, {segmentationId, segments}) => {
    arrays.set(segmentationId, new Uint8Array(4));
    segs.set(segmentationId, { segments, representationData: {Labelmap: {imageIds:[segmentationId]}} });
  }),
  addOrUpdateSegmentation: jest.fn(s => Object.assign(segs.get(s.segmentationId), s)), remove: jest.fn()
 };
}
test('two Entities in one Finding allocate only one voxel volume', async () => {
 const source={sourceKey:'ct', descriptor:{count:4}, masks:new Map()}, s=service();
 const a=await allocateFinding(source, {}, s, 'f1','a','e1'), b=await allocateFinding(source, {}, s, 'f1','b','e2');
 expect(s.createLabelmapForDisplaySet).toHaveBeenCalledTimes(1); expect(reserve).toHaveBeenCalledTimes(1);
 expect(a.segmentIndex).toBe(1); expect(b.segmentIndex).toBe(2);
 writeBinary([a], Uint8Array.from([1,0,0,0])); writeBinary([b], Uint8Array.from([0,1,0,0]));
 expect([...arrays.get(a.imageIds[0])]).toEqual([1,2,0,0]);
 expect(()=>writeBinary([b],Uint8Array.from([1,1,0,0]))).toThrow('重叠');
 expect([...arrays.get(a.imageIds[0])]).toEqual([1,2,0,0]);
});
test('shared Entity mirrors across Findings without overwriting another Entity', () => {
 arrays.set('a',Uint8Array.from([1,1,1,2])); arrays.set('b',Uint8Array.from([3,0,4,0]));
 const mask={bindings:[{segmentationId:'a',segmentIndex:1,imageIds:['a']},{segmentationId:'b',segmentIndex:3,imageIds:['b']}]};
 synchronizeEntity(mask,'a');
 expect([...arrays.get('a')]).toEqual([1,1,0,2]); expect([...arrays.get('b')]).toEqual([3,3,4,0]);
});
test('removing one Entity clears only its label and keeps siblings volume', async () => {
 const source={sourceKey:'ct',descriptor:{count:4},masks:new Map()},s=service();
 const a=await allocateFinding(source,{},s,'f','a','e1'),b=await allocateFinding(source,{},s,'f','b','e2');
 const first={id:'a',...a},second={id:'b',...b};source.masks.set('a',first);source.masks.set('b',second);
 writeBinary([a],Uint8Array.from([1,0,0,0]));writeBinary([b],Uint8Array.from([0,1,0,0]));
 removeMask({services:{segmentationService:s}},source,first);
 expect([...arrays.get(a.imageIds[0])]).toEqual([0,2,0,0]);expect(s.remove).not.toHaveBeenCalled();
});
test('shared Entity has one binding per distinct Finding and unlinked Entities stay independent',()=>{
 const source={annotationCase:{links:[{entityId:'e',findingId:'f1'},{entityId:'e',findingId:'f2'}]}};
 expect(findingKeys(source,'e','x')).toEqual(['f1','f2']);expect(findingKeys(source,'other','x')).toEqual(['x']);
});

test('import notification reaches renderers but skips edit synchronization only during dispatch', () => {
 const source = {}, seen = [];
 triggerSegmentationDataModified.mockImplementation(id => seen.push([id, source.syncingPacked]));
 notifyImportedMask(source, [{segmentationId:'a'}, {segmentationId:'b'}]);
 expect(seen).toEqual([['a',true],['b',true]]);
 expect(source.syncingPacked).toBeUndefined();
 // Normal editing after the notification must not remain suppressed.
 triggerSegmentationDataModified('a');
 expect(seen[2]).toEqual(['a',undefined]);
});
test('notification restores nested synchronization guard even if a listener throws', () => {
 const source = {syncingPacked:true};
 triggerSegmentationDataModified.mockImplementationOnce(() => {throw Error('listener');});
 expect(() => notifyImportedMask(source,[{segmentationId:'a'}])).toThrow('listener');
 expect(source.syncingPacked).toBe(true);
});
test('replica conflict fails before modifying any copy', () => {
 arrays.set('a', Uint8Array.from([1,0,2,0])); arrays.set('b',Uint8Array.from([3,4,0,0]));
 const targets=[{segmentationId:'a',segmentIndex:1,imageIds:['a']},{segmentationId:'b',segmentIndex:3,imageIds:['b']}];
 expect(() => writeBinary(targets,Uint8Array.from([0,1,0,0]))).toThrow('重叠');
 expect([...arrays.get('a')]).toEqual([1,0,2,0]);expect([...arrays.get('b')]).toEqual([3,4,0,0]);
});
