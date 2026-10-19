import test from 'node:test';
import assert from 'node:assert/strict';
import { bindLoadedMask, canLoadSavedMask } from './legacyMaskAccess.mjs';

const context = { caseId: 'case', entities: [{ id: 'entity', maskId: 'old' }], anatomyLayers: [] };
test('legacy bulk load includes unclaimed masks, excludes foreign and deleted entities', () => {
  assert.equal(canLoadSavedMask({ maskId: 'legacy' }, context), true);
  assert.equal(canLoadSavedMask({ maskId: 'old', annotationCaseId: 'case' }, context), true);
  assert.equal(canLoadSavedMask({ maskId: 'old', annotationCaseId: 'other' }, context), false);
  assert.equal(canLoadSavedMask({ maskId: 'deleted', annotationCaseId: 'case' }, context), false);
});
test('late Case registration binds already loaded legacy history without changing revision or pixels', () => {
  const pixels = new Uint8Array([1, 0, 1]);
  const mask = { saved: { maskId: 'old', version: 2 }, pixels, revision: 7, savedRevision: 3 };
  bindLoadedMask(mask, context);
  bindLoadedMask(mask, context);
  assert.equal(mask.entityId, 'entity');
  assert.equal(mask.saved.version, 2);
  assert.equal(mask.saved.annotationCaseId, 'case');
  assert.equal(mask.pixels, pixels);
  assert.equal(mask.revision, 7);
  assert.equal(mask.savedRevision, 3);
  bindLoadedMask(mask, { ...context, caseId: 'other' });
  assert.equal(mask.annotationCaseId, 'case');
});
