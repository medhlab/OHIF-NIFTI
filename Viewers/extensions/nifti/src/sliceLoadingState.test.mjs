import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sliceLoadingState } from '../../cornerstone/src/Viewport/Overlays/sliceLoadingState.mjs';
const viewport = ready => ({ getImageIds:()=>['a','b'], getTargetImageIdIndex:()=>1,
 getCurrentImageId:()=> 'a', getCornerstoneImage:()=>({imageId:'a',niftiIsImageLoaded:ready}) });
test('loaded target never shows loading while rendering catches up',()=>{
 assert.deepEqual(sliceLoadingState(viewport(()=>true)),{target:'b',loading:false});
});
test('only a missing target frame shows loading and clears as data arrives',()=>{
 let ready=false; const v=viewport(()=>ready);
 assert.equal(sliceLoadingState(v).loading,true);ready=true;assert.equal(sliceLoadingState(v).loading,false);
});
test('non-native images retain the existing loading behavior',()=>{
 assert.equal(sliceLoadingState(viewport(undefined)).loading,true);
 assert.equal(sliceLoadingState(undefined).loading,false);
});

test('Axial Primary volume source ID does not imply a pending stack image',()=>{
 const v={type:'orthographic',getCurrentImageId:()=> 'nifti:source:58',getCornerstoneImage:()=>undefined};
 assert.equal(sliceLoadingState(v).loading,false);
 assert.equal(sliceLoadingState({...v,type:'volume3d'}).loading,false);
});

test('stack views still show Loading until their target frame arrives',()=>{
 const v={...viewport(undefined),type:'stack'};
 assert.equal(sliceLoadingState(v).loading,true);
 v.getCornerstoneImage=()=>({imageId:'b'});
 assert.equal(sliceLoadingState(v).loading,false);
});
