"""Dataset membership is independent of worklists and source-volume deduplication."""
import json
import re
from fastapi import APIRouter, Body, Query
from monailabel.endpoints.nifti_images import database, enabled
from monailabel.utils.others import annotation_domain as domain

router = APIRouter()
SPLITS = ('train', 'val', 'test', 'unspecified')


def schema(db):
    domain.schema(db)
    db.execute('CREATE TABLE IF NOT EXISTS annotation_datasets (id TEXT PRIMARY KEY, metadata TEXT NOT NULL)')
    db.execute('CREATE TABLE IF NOT EXISTS annotation_dataset_cases (dataset_id TEXT NOT NULL, case_id TEXT NOT NULL, external_key TEXT NOT NULL, split TEXT NOT NULL, PRIMARY KEY(dataset_id,case_id), UNIQUE(dataset_id,external_key))')


def dataset(db, did):
    row = db.execute('SELECT metadata FROM annotation_datasets WHERE id=?', (did,)).fetchone()
    if row is None:
        domain.fail('DATASET_NOT_FOUND', '数据集不存在。', 404)
    return json.loads(row[0])


def members(db, did):
    rows = db.execute('SELECT m.external_key,m.split,c.metadata,c.worklist FROM annotation_dataset_cases m JOIN annotation_cases c ON c.id=m.case_id WHERE m.dataset_id=? ORDER BY m.external_key', (did,)).fetchall()
    result = []
    for external, split, raw, worklist in rows:
        c = json.loads(raw)
        result.append({'caseId': c['caseId'], 'externalCaseId': external, 'name': c['name'], 'split': split,
                       'sourceId': c['sourceId'], 'manifestId': worklist[len('manifest-'):] if worklist and worklist.startswith('manifest-') else None,
                       'completed': c.get('completedRevision') == c['revision'],
                       'findings': len(c['findings']), 'entities': len(c['entities']),
                       'reports': len(c['reports']), 'masks': sum(bool(e.get('maskId')) for e in c['entities'])})
    return result


def progress(rows):
    completed = sum(r['completed'] for r in rows)
    return {'totalCases': len(rows), 'completedCases': completed,
            'completionPercent': round(100 * completed / len(rows), 1) if rows else 0}


@router.post('/datasets')
def register(payload: dict = Body(...)):
    enabled('ENABLE_NIFTI_EDITING')
    did = payload.get('id')
    if not isinstance(did, str) or not re.fullmatch(r'[a-z0-9][a-z0-9._-]{0,79}', did):
        domain.fail('INVALID_DATASET', '数据集 ID 无效。')
    value = {'id': did, 'name': domain.text(payload.get('name'), 200),
             'version': domain.text(payload.get('version'), 200)}
    with database() as db:
        db.execute('BEGIN IMMEDIATE'); schema(db)
        old = db.execute('SELECT metadata FROM annotation_datasets WHERE id=?', (did,)).fetchone()
        if old and json.loads(old[0]) != value:
            domain.fail('DATASET_VERSION_CONFLICT', '数据集已存在，名称或版本不一致。请使用独立版本 ID。', 409)
        db.execute('INSERT OR IGNORE INTO annotation_datasets VALUES (?,?)', (did, json.dumps(value)))
    return value


@router.post('/datasets/{did}/members')
def attach(did: str, payload: dict = Body(...)):
    enabled('ENABLE_NIFTI_EDITING')
    entries = payload.get('items')
    if not isinstance(entries, list) or not 1 <= len(entries) <= 5000:
        domain.fail('INVALID_MEMBERS', '每次需提供 1–5000 个病例。')
    with database() as db:
        db.execute('BEGIN IMMEDIATE'); schema(db); dataset(db, did)
        for entry in entries:
            if not isinstance(entry, dict) or entry.get('split') not in SPLITS:
                domain.fail('INVALID_SPLIT', '请选择 train、val、test 或 unspecified。')
            cid = entry.get('caseId')
            case = domain.read(db, cid)
            external = db.execute('SELECT external_key FROM annotation_cases WHERE id=?', (cid,)).fetchone()[0]
            if not external or not (case.get('worklistId') or '').startswith('manifest-'):
                domain.fail('MANIFEST_CASE_REQUIRED', '请先通过病例清单登记病例。')
            old = db.execute('SELECT case_id,split FROM annotation_dataset_cases WHERE dataset_id=? AND external_key=?', (did, external)).fetchone()
            if old and (old[0] != cid or old[1] != entry['split']):
                domain.fail('DATASET_MEMBERSHIP_CONFLICT', '同一病例已登记，请勿重复导入或更改原始 split。', 409)
            db.execute('INSERT OR IGNORE INTO annotation_dataset_cases VALUES (?,?,?,?)', (did, cid, external, entry['split']))
    return {'datasetId': did, 'attached': len(entries)}


@router.get('/datasets')
def list_datasets():
    enabled()
    with database() as db:
        schema(db)
        items = []
        for raw, in db.execute('SELECT metadata FROM annotation_datasets ORDER BY id').fetchall():
            d = json.loads(raw); rows = members(db, d['id'])
            items.append({**d, **progress(rows), 'splits': {s: progress([r for r in rows if r['split'] == s]) for s in SPLITS}})
    return {'items': items}


@router.get('/datasets/{did}/cases')
def list_cases(did: str, split: str = '', search: str = Query('', max_length=200),
               offset: int = Query(0, ge=0), limit: int = Query(25, ge=1, le=5000)):
    enabled()
    if split and split not in SPLITS:
        domain.fail('INVALID_SPLIT', '无效的 split。')
    with database() as db:
        schema(db); d = dataset(db, did); rows = members(db, did)
    rows = [r for r in rows if (not split or r['split'] == split) and search.casefold() in r['name'].casefold()]
    return {'dataset': d, 'items': rows[offset:offset + limit], **progress(rows)}
