import test from 'node:test';
import assert from 'node:assert/strict';
import { naturalCaseOrder } from './caseOrder.mjs';

test('case names sort numerically within exam and reconstruction groups', () => {
  const rows = ['train_10_a_1.nii.gz', 'train_2_b_1.nii.gz', 'train_2_a_10.nii.gz',
    'train_2_a_2.nii.gz', 'train_2_a_1.nii.gz'].map((name, i) => ({name, caseId: `id-${i}`}));
  const before = rows.slice();
  const sorted = naturalCaseOrder(rows);
  assert.deepEqual(sorted.map(r => r.name), ['train_2_a_1.nii.gz', 'train_2_a_2.nii.gz',
    'train_2_a_10.nii.gz', 'train_2_b_1.nii.gz', 'train_10_a_1.nii.gz']);
  assert.deepEqual(rows, before);
  assert.equal(sorted[0], rows[4]);
});

test('equal names keep their original order and identity', () => {
  const rows = [{name:'CASE2',caseId:'a'}, {name:'case2',caseId:'b'}];
  assert.deepEqual(naturalCaseOrder(rows), rows);
  assert.deepEqual(naturalCaseOrder(), []);
});
