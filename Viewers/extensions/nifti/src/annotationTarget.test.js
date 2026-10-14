import { describeAnnotationTarget } from './annotationTarget';

const categories = { A: '类别 A', B: '类别 B' };
const context = {
  entities: [
    {
      id: 'entity',
      name: '目标',
      maskId: 'saved-mask',
      reportObservations: [{ observationId: 'observation' }],
    },
  ],
  links: [
    { findingId: 'one', entityId: 'entity' },
    { findingId: 'two', entityId: 'entity' },
    { findingId: 'other', entityId: 'unrelated' },
  ],
  findings: [
    { id: 'one', category: 'A' },
    { id: 'two', category: 'B' },
    { id: 'other', category: 'C' },
  ],
  reportExtraction: {
    observations: [
      { id: 'observation', category: 'B' },
      { id: 'unrelated', category: 'C' },
    ],
  },
};
test('a shared Entity displays its linked Finding and observation categories once', () => {
  expect(describeAnnotationTarget(context, { entityId: 'entity' }, categories)).toEqual({
    entityId: 'entity',
    title: 'F1-E1 / F2-E1 · 目标',
    categoryText: 'A · 类别 A / B · 类别 B',
  });
});
test('a reopened saved mask resolves its Entity without a local entityId', () => {
  expect(
    describeAnnotationTarget(context, { saved: { maskId: 'saved-mask' } }, categories).title
  ).toBe('F1-E1 / F2-E1 · 目标');
});
test('a structure layer is identified as a read-only auxiliary layer', () => {
  expect(
    describeAnnotationTarget(
      context,
      { label: 'lung', saved: { anatomyReadOnly: true } },
      categories
    )
  ).toEqual({ entityId: '', title: '只读结构 · lung', categoryText: '辅助图层' });
});
test('an unbound mask and an empty selection have distinct labels', () => {
  expect(describeAnnotationTarget(undefined, { label: '草稿' }, categories).title).toBe(
    '未绑定 Entity · 草稿'
  );
  expect(describeAnnotationTarget(undefined, undefined, categories)).toEqual({
    entityId: '',
    title: '未选择 Entity',
    categoryText: '未分类',
  });
});
test('unknown category names fall back to the code and null categories are omitted', () => {
  const modified = {
    ...context,
    findings: [
      { id: 'one', category: 'Z' },
      { id: 'two', category: null },
    ],
    reportExtraction: undefined,
  };
  expect(describeAnnotationTarget(modified, { entityId: 'entity' }, categories).categoryText).toBe(
    'Z · Z'
  );
});
