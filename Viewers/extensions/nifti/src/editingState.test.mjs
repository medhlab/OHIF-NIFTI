import { test } from 'node:test';
import assert from 'node:assert/strict';
import { beginEditing, endEditing, editingMask, requireEditing } from './editingState.mjs';
const fixture = () => ({
  descriptor: {},
  masks: new Map([
    ['A', { segmentationId: 'A', pixels: [1, 0], dirty: true }],
    ['B', { segmentationId: 'B', pixels: [0, 1] }],
    ['S', { segmentationId: 'S', anatomyReadOnly: true }],
  ]),
});
test('selection alone cannot edit; session permits only its own mask', () => {
  const s = fixture();
  assert.throws(() => requireEditing(s, 'A'));
  beginEditing(s, 'A');
  assert.equal(requireEditing(s, 'A'), s.masks.get('A'));
  assert.throws(() => requireEditing(s, 'B'));
  beginEditing(s, 'B');
  assert.throws(() => requireEditing(s, 'A'));
  assert.equal(editingMask(s).segmentationId, 'B');
});
test('exit preserves unsaved masks and advances inference identity, including re-entry', () => {
  const s = fixture();
  const a = s.masks.get('A');
  beginEditing(s, 'A');
  const epoch = s.descriptor.editingEpoch;
  endEditing(s);
  assert.equal(editingMask(s), undefined);
  assert.deepEqual(a.pixels, [1, 0]);
  assert.equal(a.dirty, true);
  beginEditing(s, 'A');
  assert.ok(s.descriptor.editingEpoch > epoch);
});
test('read-only or removed targets cannot be edited', () => {
  const s = fixture();
  assert.throws(() => beginEditing(s, 'S'));
  beginEditing(s, 'A');
  s.masks.delete('A');
  assert.throws(() => requireEditing(s, 'A'));
});
