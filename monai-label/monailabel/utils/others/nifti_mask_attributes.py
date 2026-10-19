"""Mutable display metadata is independent of immutable voxel versions."""
import json
from fastapi import HTTPException


def schema(db):
    db.execute('CREATE TABLE IF NOT EXISTS mask_attributes (source TEXT, id TEXT, revision INTEGER NOT NULL, metadata TEXT NOT NULL, PRIMARY KEY(source,id))')


def current(db, source, record):
    schema(db)
    row = db.execute('SELECT revision,metadata FROM mask_attributes WHERE source=? AND id=?', (source, record['maskId'])).fetchone()
    return dict(record, **(json.loads(row[1]) if row else {}), metadataRevision=row[0] if row else 0)


def update(db, source, record, changes, expected=None):
    value = current(db, source, record)
    if expected is not None and expected != value['metadataRevision']:
        raise HTTPException(409, 'Mask metadata changed; reload before saving.')
    changed = any(value.get(k) != v for k, v in changes.items())
    if changed:
        value.update(changes)
        value['metadataRevision'] += 1
        metadata = {k: value[k] for k in ('name', 'displayColor') if k in value}
        db.execute('INSERT OR REPLACE INTO mask_attributes VALUES (?,?,?,?)',
                   (source, record['maskId'], value['metadataRevision'], json.dumps(metadata)))
    return value, changed
