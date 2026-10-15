import { test } from 'node:test';
import assert from 'node:assert/strict';
import { prefetchFrames } from './prefetchPool.mjs';
const tick = () => new Promise(r=>setTimeout(r,0));
test('at most two frame pipelines run and every frame finishes once', async()=>{
 let active=0,peak=0;const seen=[];
 assert.equal(await prefetchFrames([0,1,2,3,4],async i=>{
  peak=Math.max(peak,++active);seen.push(i);await tick();active--;return true;
 },new AbortController().signal),true);
 assert.equal(peak,2);assert.deepEqual(seen,[0,1,2,3,4]);
});
test('capacity cancels the other download and does not start more frames',async()=>{
 const seen=[];let aborted=false;
 const result=await prefetchFrames([0,1,2],async(i,signal)=>{
  seen.push(i);if(i===0){await tick();return false;}
  await new Promise((resolve,reject)=>signal.addEventListener('abort',()=>{aborted=true;reject(signal.reason);},{once:true}));
 },new AbortController().signal);
 assert.equal(result,false);assert.equal(aborted,true);assert.deepEqual(seen,[0,1]);
});
test('case switch aborts both downloads and preserves cancellation',async()=>{
 const controller=new AbortController();let aborted=0;
 const work=prefetchFrames([0,1,2],async(i,signal)=>new Promise((resolve,reject)=>signal.addEventListener('abort',()=>{aborted++;reject(signal.reason);},{once:true})),controller.signal);
 controller.abort();await assert.rejects(work,{name:'AbortError'});assert.equal(aborted,2);
});
test('a failed download aborts its sibling and preserves the original error',async()=>{
 const error=Error('network failure');let aborted=false;
 await assert.rejects(prefetchFrames([0,1,2],async(i,signal)=>{
  if(i===0){await tick();throw error;}
  await new Promise((resolve,reject)=>signal.addEventListener('abort',()=>{aborted=true;reject(signal.reason);},{once:true}));
 },new AbortController().signal),error);assert.equal(aborted,true);
});
