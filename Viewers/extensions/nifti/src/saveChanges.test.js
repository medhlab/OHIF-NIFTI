jest.mock('@cornerstonejs/core', () => ({ cache: { getImage: jest.fn() }, eventTarget: { addEventListener: jest.fn() } }), { virtual: true });
jest.mock('@cornerstonejs/tools', () => ({ segmentation: { state: { getSegmentation: jest.fn() } }, Enums: {} }), { virtual: true });
jest.mock('@cornerstonejs/tools/segmentation/triggerSegmentationEvents', () => ({ triggerSegmentationDataModified: jest.fn() }), { virtual: true });
jest.mock('./sourceStore', () => ({ sources: new Map(), reserve: jest.fn(), release: jest.fn(), config: {} }));
jest.mock('./workerClient', () => ({}));
jest.mock('./api', () => ({ ensureStored: jest.fn(), request: jest.fn(), apiRoot: () => '/nifti-images' }));
jest.mock('./maskTransport.mjs', () => ({ encodeMask: jest.fn(), uploadForm: jest.fn() }));
jest.mock('./annotationClient', () => ({ annotationRequest: jest.fn(), installAnnotationContext: jest.fn(), annotationRoot: () => '/annotation' }));

import { saveAll, isMaskDirty } from './masks';
import { sources } from './sourceStore';
import { cache } from '@cornerstonejs/core';
import { segmentation } from '@cornerstonejs/tools';
import { request } from './api';
import { encodeMask, uploadForm } from './maskTransport.mjs';
import { annotationRequest } from './annotationClient';
import { saveSummary, voxelDirty } from './maskSaveState.mjs';

let source, manager;
const color = [1, 2, 3, 255];
function mask(id, modified = false) {
  return { id, segmentationId: id, segmentIndex: 1, label: id, displayColor: color,
    saved: { maskId: id, version: 1, name: id }, hashes: [modified ? 2 : 1], savedHashes: [1],
    revision: modified ? 1 : 0, savedRevision: 0,
    segmentationSet: { id: 'group', name: 'group', kind: 'manual' } };
}
beforeEach(() => {
  jest.clearAllMocks(); sources.clear();
  source = { sourceKey: 's', descriptor: { sourceId: 'source', count: 4, geometryHash: 'g' }, imageIds: ['ref'], masks: new Map() };
  sources.set('s', source);
  manager = { services: {
    viewportGridService: { getState: () => ({ activeViewportId: 'vp', viewports: new Map([['vp', {displaySetInstanceUIDs:['ds']} ]]) }) },
    displaySetService: { getDisplaySetByUID: () => ({ sourceKey:'s' }) },
    segmentationService: { getSegmentColor: () => color },
  } };
  segmentation.state.getSegmentation.mockReturnValue({representationData:{Labelmap:{imageIds:['slice']}}});
  cache.getImage.mockReturnValue({referencedImageId:'ref', voxelManager:{getScalarData:()=>new Uint8Array([1,0,0,0])}});
  encodeMask.mockResolvedValue({blob:new Blob(['mask']),encoding:'raw'});
  uploadForm.mockImplementation(async (_url,form) => ({items:[{maskId:form.get('maskId'),name:form.get('label'),version:2,displayColor:color,saveStatus:'saved'}]}));
  request.mockImplementation(async (_url,opts) => {
    const p=JSON.parse(opts.body); return {json:async()=>({items:[{maskId:'meta',version:1,name:p.name,displayColor:color,metadataRevision:1,saveStatus:'metadata'}]})};
  });
  Object.defineProperty(globalThis.crypto,'randomUUID',{value:()=> 'request-key',configurable:true});
});

test('legacy masks lacking colors are skipped, even after edit and undo', async () => {
  const a=mask('legacy');a.revision=5;source.masks.set(a.id,a);
  expect(isMaskDirty(manager,a)).toBe(false);
  expect((await saveAll(manager))[0].status).toBe('skipped');
  expect(uploadForm).not.toHaveBeenCalled();expect(request).not.toHaveBeenCalled();
});

test('only modified voxels upload; metadata uses JSON; summary distinguishes all outcomes', async () => {
  const a=mask('clean'),b=mask('changed',true),c=mask('meta');c.label='Renamed';
  [a,b,c].forEach(m=>source.masks.set(m.id,m));
  const result=await saveAll(manager);
  expect(result.map(r=>r.status)).toEqual(['skipped','saved','metadata']);
  expect(uploadForm).toHaveBeenCalledTimes(1);expect(request).toHaveBeenCalledTimes(1);
  expect(JSON.parse(request.mock.calls[0][1].body).name).toBe('Renamed');
  expect(isMaskDirty(manager,b)).toBe(false);expect(isMaskDirty(manager,c)).toBe(false);
  expect(saveSummary(result)).toBe('保存 1 个，更新名称/颜色 1 个，未修改跳过 1 个，失败 0 个。');
});

test('one failed upload stays dirty and does not hide later successful saves', async () => {
  const a=mask('failed',true),b=mask('ok',true);[a,b].forEach(m=>source.masks.set(m.id,m));
  uploadForm.mockRejectedValueOnce(Error('offline'));
  const result=await saveAll(manager);
  expect(result.map(r=>r.status)).toEqual(['failed','saved']);
  expect(isMaskDirty(manager,a)).toBe(true);expect(isMaskDirty(manager,b)).toBe(false);
  expect(saveSummary(result)).toContain('失败 1 个');
});

test('editing during an in-flight save is not cleared by the older response', async () => {
  const a=mask('changing',true);source.masks.set(a.id,a);
  uploadForm.mockImplementationOnce(async()=>{a.hashes=[3];a.revision++;return {items:[{maskId:a.id,version:2,name:a.label,displayColor:color,saveStatus:'saved'}]};});
  await saveAll(manager);expect(voxelDirty(a)).toBe(true);expect(a.savedHashes).toEqual([2]);
});

test('metadata refresh failure retains dirty state and retry reuses its idempotency key', async () => {
  const a=mask('meta');a.label='Renamed';a.entityId='e';source.masks.set(a.id,a);
  source.annotationCase={caseId:'case',revision:1};
  annotationRequest.mockRejectedValueOnce(Error('refresh unavailable')).mockResolvedValueOnce({data:source.annotationCase});
  expect((await saveAll(manager))[0].status).toBe('failed');
  expect(isMaskDirty(manager,a)).toBe(true);
  expect((await saveAll(manager))[0].status).toBe('metadata');
  expect(request.mock.calls[0][1].headers['Idempotency-Key']).toBe(request.mock.calls[1][1].headers['Idempotency-Key']);
  expect(isMaskDirty(manager,a)).toBe(false);
});
