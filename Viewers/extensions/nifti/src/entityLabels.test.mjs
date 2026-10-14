import { test } from 'node:test';
import assert from 'node:assert/strict';
import { entitiesForFinding, entityLabel, entityLabels } from './entityLabels.mjs';
const context = {
  findings: [{ id: 'f1' }, { id: 'f2' }],
  entities: [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
  links: [
    { findingId: 'f1', entityId: 'a' },
    { findingId: 'f2', entityId: 'b' },
    { findingId: 'f2', entityId: 'c' },
  ],
};
test('each Finding starts at E1 independently of case-level position', () => {
  assert.equal(entityLabel(context, 'a', 'f1'), 'F1-E1');
  assert.equal(entityLabel(context, 'b', 'f2'), 'F2-E1');
  assert.equal(entityLabel(context, 'c', 'f2'), 'F2-E2');
});
test('deleting all F2 Entities and adding another restarts at E1', () => {
  const after = {
    ...context,
    entities: [context.entities[0], { id: 'new' }],
    links: [context.links[0], { findingId: 'f2', entityId: 'new' }],
  };
  assert.equal(entityLabel(after, 'new', 'f2'), 'F2-E1');
  assert.equal(entitiesForFinding(after, 'f2').length, 1);
});
test('a shared Entity has a local alias in each Finding but remains one identity', () => {
  const shared = { ...context, links: [...context.links, { findingId: 'f2', entityId: 'a' }] };
  assert.equal(entityLabels(shared, 'a'), 'F1-E1 / F2-E1');
  assert.equal(entityLabels(shared, 'b'), 'F2-E2');
  assert.equal(shared.entities.length, 3);
});
test('unlinked Entities have their own local numbering', () => {
  const withDraft = { ...context, entities: [...context.entities, { id: 'draft' }] };
  assert.equal(entityLabels(withDraft, 'draft'), 'E1');
  assert.deepEqual(
    entitiesForFinding(withDraft).map(e => e.id),
    ['draft']
  );
});
