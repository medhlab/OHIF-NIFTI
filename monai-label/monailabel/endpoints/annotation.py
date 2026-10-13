"""First-release annotation APIs. Native voxel storage remains the source of masks."""
import json
import hashlib
from fastapi import APIRouter, Body, File, Form, Header, UploadFile
from monailabel.endpoints.nifti_images import database, enabled, get_source, save_masks
from monailabel.utils.others import annotation_domain as domain

router = APIRouter(prefix='/api/annotation/v1', tags=['Lesion annotation'])


@router.get('/categories')
def categories():
    enabled()
    return {'system': 'urn:rexgroundingct:finding-category', 'version': 'snapshot-2026-10-13', 'items': domain.CATEGORIES}


@router.post('/worklists')
def register_worklist(payload: dict = Body(...)):
    enabled()
    manifest_id = payload.get('manifestId')
    with database() as db:
        db.execute('BEGIN IMMEDIATE')
        domain.schema(db)
        row = db.execute('SELECT metadata FROM case_manifests WHERE id=?', (manifest_id,)).fetchone()
        if row is None:
            domain.fail('MANIFEST_NOT_FOUND', '请先导入病例清单。', 404)
        manifest = json.loads(row[0])
        wid = 'manifest-' + manifest_id
        items = []
        for item in manifest['items']:
            existing = db.execute('SELECT id FROM annotation_cases WHERE worklist=? AND external_key=?', (wid, item['caseId'])).fetchone()
            if existing:
                cid = existing[0]
            else:
                cid = domain.identity()
                case = {'caseId': cid, 'revision': 1, 'sourceId': None, 'worklistId': wid, 'name': item['name'],
                        'reports': [], 'evidence': [], 'findings': [], 'entities': [], 'links': [], 'anatomyLayers': [], 'completedRevision': None}
                db.execute('INSERT INTO annotation_cases VALUES (?,?,?,?,?)', (cid, None, wid, item['caseId'], json.dumps(case)))
                domain.persist(db, case, bump=False)
            items.append({'externalCaseId': item['caseId'], 'caseId': cid})
        db.execute('INSERT OR IGNORE INTO annotation_worklists VALUES (?,?)', (wid, json.dumps(items)))
    return {'worklistId': wid, 'items': items}


@router.post('/cases')
def register_case(payload: dict = Body(...), idempotency_key: str = Header(...)):
    enabled('ENABLE_NIFTI_EDITING')
    if not idempotency_key or len(idempotency_key) > 200: domain.fail('IDEMPOTENCY_KEY_REQUIRED', '写入需提供幂等标识。')
    if not isinstance(payload.get('sourceId'), str): domain.fail('INVALID_SOURCE', '请选择已登记的 CT。')
    source = get_source(payload['sourceId'])
    if source['modality'] != 'CT':
        domain.fail('CT_REQUIRED', '首版病灶标注仅支持 CT。')
    with database() as db:
        db.execute('BEGIN IMMEDIATE')
        domain.schema(db)
        digest = hashlib.sha256(json.dumps(payload, sort_keys=True, ensure_ascii=False).encode()).hexdigest()
        prior = db.execute('SELECT digest,response FROM annotation_requests WHERE case_id=? AND key=?', ('__registration__', idempotency_key)).fetchone()
        if prior:
            if prior[0] != digest: domain.fail('IDEMPOTENCY_KEY_REUSED', '幂等标识被用于不同注册。', 409)
            return json.loads(prior[1])
        case_id = payload.get('caseId')
        if case_id:
            case = domain.read(db, case_id)
            if case['sourceId'] not in (None, source['sourceId']):
                domain.fail('VOLUME_IMMUTABLE', '不能替换病例参考 CT。', 409)
            if case['sourceId'] is None:
                case['sourceId'] = source['sourceId']
                # New manifest ingestion: preserve each supplied text chunk exactly, without reconstructing missing offsets.
                worklist = case.get('worklistId', '')
                if worklist and worklist.startswith('manifest-'):
                    manifest_row = db.execute('SELECT metadata FROM case_manifests WHERE id=?', (worklist[len('manifest-'):],)).fetchone()
                    external_key = db.execute('SELECT external_key FROM annotation_cases WHERE id=?', (case_id,)).fetchone()[0]
                    item = next((i for i in json.loads(manifest_row[0])['items'] if i['caseId'] == external_key), None) if manifest_row else None
                    for incoming in (item or {}).get('reports', []):
                        case['reports'].append({'id': domain.identity(), 'version': 1, 'name': incoming['name'], 'sections': [
                            {'id': domain.identity(), 'name': s['section'], 'text': s['text'], 'textSha256': hashlib.sha256(s['text'].encode()).hexdigest()}
                            for s in incoming['statements']]})
                domain.persist(db, case)
        else:
            # Explicit registration allocates a Case. It does not infer medical identity from image hashes.
            case_id = domain.identity()
            case = {'caseId': case_id, 'revision': 1, 'sourceId': source['sourceId'], 'worklistId': None, 'name': source['name'],
                    'reports': [], 'evidence': [], 'findings': [], 'entities': [], 'links': [], 'anatomyLayers': [], 'completedRevision': None}
            db.execute('INSERT INTO annotation_cases VALUES (?,?,?,?,?)', (case_id, source['sourceId'], None, None, json.dumps(case)))
            domain.persist(db, case, bump=False)
        result = domain.reply(case)
        db.execute('INSERT INTO annotation_requests VALUES (?,?,?,?)', ('__registration__', idempotency_key, digest, json.dumps(result, ensure_ascii=False)))
    return result


@router.get('/cases/{case_id}/context')
def context(case_id: str):
    enabled()
    with database() as db:
        domain.schema(db)
        case = domain.read(db, case_id)
    result = domain.reply(case)
    result['volume'] = get_source(case['sourceId']) if case['sourceId'] else None
    return result


@router.post('/cases/{case_id}/operations')
def operation(case_id: str, payload: dict = Body(...), idempotency_key: str = Header(...)):
    enabled('ENABLE_NIFTI_EDITING')
    if len(json.dumps(payload)) > 512 * 1024:
        domain.fail('REQUEST_TOO_LARGE', '请求超过 512 KiB。', 413)
    with database() as db:
        db.execute('BEGIN IMMEDIATE')
        domain.schema(db)
        return domain.mutation(db, case_id, idempotency_key, payload)


@router.get('/worklists/{worklist_id}/progress')
def progress(worklist_id: str):
    enabled()
    with database() as db:
        domain.schema(db)
        rows = db.execute('SELECT metadata FROM annotation_cases WHERE worklist=?', (worklist_id,)).fetchall()
        if not db.execute('SELECT 1 FROM annotation_worklists WHERE id=?', (worklist_id,)).fetchone():
            domain.fail('WORKLIST_NOT_FOUND', '任务集合不存在。', 404)
    cases = [json.loads(row[0]) for row in rows]
    completed = sum(c['completedRevision'] == c['revision'] for c in cases)
    return {'totalCases': len(cases), 'completedCases': completed,
            'completionPercent': 100 * completed / len(cases) if cases else None}


@router.post('/cases/{case_id}/entities/{entity_id}/mask-versions')
def save_entity_mask(case_id: str, entity_id: str, file: UploadFile = File(...),
                     expectedCaseRevision: int = Form(...), expectedMaskVersion: int = Form(0),
                     geometryHash: str = Form(...), label: str = Form('病灶'),
                     labelOnly: bool = Form(False), provenance: str = Form('{}'),
                     idempotency_key: str = Header(...)):
    enabled('ENABLE_NIFTI_EDITING')
    with database() as db:
        domain.schema(db)
        case = domain.read(db, case_id)
        entity = domain.member(case, 'entities', entity_id)
    result = save_masks(case['sourceId'], file, label, entity['maskId'], expectedMaskVersion,
                        True, labelOnly, geometryHash, provenance,
                        annotationCaseId=case_id, annotationEntityId=entity_id, expectedCaseRevision=expectedCaseRevision, annotationRequestKey='mask:' + entity_id + ':' + idempotency_key)
    return result


@router.post('/cases/{case_id}/anatomy-layers')
def import_anatomy(case_id: str, file: UploadFile = File(...), labelMap: str = Form(...),
                   modelVersion: str = Form('unknown')):
    enabled('ENABLE_NIFTI_EDITING')
    try:
        labels = json.loads(labelMap)
        if not isinstance(labels, dict) or not labels or len(labels) > 256:
            raise ValueError()
        for value, name in labels.items():
            if not str(value).isdigit() or int(value) < 1 or not isinstance(name, str) or not name.strip() or len(name) > 200:
                raise ValueError()
    except (ValueError, TypeError):
        domain.fail('INVALID_LABEL_MAP', '请提供整数标签值到结构名称的 JSON 映射。')
    with database() as db:
        domain.schema(db)
        case = domain.read(db, case_id)
    source = get_source(case['sourceId'])
    result = save_masks(case['sourceId'], file, '结构', None, 0, False, False, source['geometryHash'],
                        json.dumps({'anatomyLabels': labels, 'modelVersion': modelVersion}),
                        annotationCaseId=None, annotationEntityId=None, expectedCaseRevision=None,
                        annotationRequestKey=None, anatomyCaseId=case_id)
    return result
