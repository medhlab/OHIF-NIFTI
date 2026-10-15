import { firstReadyEntity } from './findingLocation';
const entities = [{id:'first',maskId:'one'}, {id:'second',maskId:'two'}, {id:'empty'}];
const all = e => ({id:e.id});
test('a later cached Entity cannot take priority over an earlier pending mask', () => {
 expect(firstReadyEntity(entities,new Set(['one']),all,()=>true)).toBeUndefined();
});
test('first Entity can be located while later masks are still pending', () => {
 expect(firstReadyEntity(entities,new Set(['two']),all,()=>true)).toBe(entities[0]);
});
test('empty or failed Entities are skipped after settling', () => {
 expect(firstReadyEntity(entities,new Set(),e=>e.id==='first'?undefined:all(e),()=>true)).toBe(entities[1]);
 expect(firstReadyEntity(entities,new Set(),all,m=>m.id==='second')).toBe(entities[1]);
});
test('all empty Finding has no camera target', () => {
 expect(firstReadyEntity(entities,new Set(),all,()=>false)).toBeUndefined();
});
