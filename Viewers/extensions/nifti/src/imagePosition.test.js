import { rememberSlice, restoredSlice } from './imagePosition';
const d={sourceId:'case',contentHash:'hash',geometryHash:'grid',dimensions:[2,2,20]};
beforeEach(()=>localStorage.clear());
test('restores last slice across descriptor objects, with version and bounds checks',()=>{
 expect(restoredSlice(d)).toBe(10);rememberSlice(d,17);expect(restoredSlice({...d})).toBe(17);
 expect(restoredSlice({...d,contentHash:'new'})).toBe(10);
 expect(restoredSlice({...d,geometryHash:'new'})).toBe(10);
 rememberSlice(d,99);expect(restoredSlice(d)).toBe(17);
});
test('bounded history keeps at most 100 cases and handles invalid stored JSON',()=>{
 for(let i=0;i<110;i++)rememberSlice({...d,sourceId:String(i)},3);
 expect(Object.keys(JSON.parse(localStorage.getItem('ohif-nifti-slice-positions-v1')))).toHaveLength(100);
 expect(restoredSlice({...d,sourceId:'0'})).toBe(10);
 localStorage.setItem('ohif-nifti-slice-positions-v1','broken');expect(restoredSlice(d)).toBe(10);
});
