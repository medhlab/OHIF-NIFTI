import { cache } from '@cornerstonejs/core';
import { entityMaskEmpty } from './entityMaskEmpty';
jest.mock('@cornerstonejs/core', () => ({ cache: { getImage: jest.fn() } }), { virtual: true });
test('unsaved drawing and erasing update the empty indicator by revision', () => {
  const pixels = new Uint8Array(4);
  cache.getImage.mockReturnValue({ voxelManager: { getScalarData: () => pixels } });
  const mask = { entityId: 'e', imageIds: ['slice'], revision: 0 };
  const source = { masks: new Map([['m', mask]]) };
  expect(entityMaskEmpty(source, { id: 'e' })).toBe(true);
  pixels[1] = 1; mask.revision++;
  expect(entityMaskEmpty(source, { id: 'e' })).toBe(false);
  pixels[1] = 0; mask.revision++;
  expect(entityMaskEmpty(source, { id: 'e' })).toBe(true);
});
test('only a new entity is marked empty when its mask is not loaded', () => {
  const source = { masks: new Map() };
  expect(entityMaskEmpty(source, { id: 'new' })).toBe(true);
  expect(entityMaskEmpty(source, { id: 'saved', maskId: 'stored' })).toBe(false);
});
