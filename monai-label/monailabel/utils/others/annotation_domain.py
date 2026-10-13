"""Single-CT annotation metadata; mutations share the native mask SQL transaction."""
import hashlib
import json
import uuid
from fastapi import HTTPException

CATEGORIES = {
    '1a': '支气管壁增厚', '1b': '支气管扩张', '1c': '肺气肿',
    '1d': '小叶间隔增厚／网状改变', '1e': '微结节', '1f': '其他非局灶性异常',
    '2a': '线状异常（肺不张、瘢痕、纤维化）', '2b': '肺不张／实变',
    '2c': '磨玻璃影', '2d': '肺结节／肿块', '2e': '胸腔积液／胸膜增厚',
    '2f': '蜂窝样改变', '2g': '气胸', '2h': '其他局灶性异常',
}


def fail(code, message, status=422):
    raise HTTPException(status, detail={'code': code, 'message': message})


def identity():
    return uuid.uuid4().hex


def schema(db):
    # Execute individually: executescript would implicitly commit an active transaction.
    for sql in (
        'CREATE TABLE IF NOT EXISTS annotation_cases (id TEXT PRIMARY KEY, source TEXT, worklist TEXT, external_key TEXT, metadata TEXT NOT NULL, UNIQUE(worklist,external_key))',
        'CREATE TABLE IF NOT EXISTS annotation_snapshots (case_id TEXT, revision INTEGER, metadata TEXT, PRIMARY KEY(case_id,revision))',
        'CREATE TABLE IF NOT EXISTS annotation_requests (case_id TEXT, key TEXT, digest TEXT, response TEXT, PRIMARY KEY(case_id,key))',
        'CREATE TABLE IF NOT EXISTS annotation_mask_owners (source TEXT, mask_id TEXT, case_id TEXT, entity_id TEXT, PRIMARY KEY(source,mask_id))',
        'CREATE TABLE IF NOT EXISTS annotation_worklists (id TEXT PRIMARY KEY, metadata TEXT NOT NULL)',
    ):
        db.execute(sql)


def read(db, case_id):
    row = db.execute('SELECT metadata FROM annotation_cases WHERE id=?', (case_id,)).fetchone()
    if not row:
        fail('CASE_NOT_FOUND', '标注病例不存在。', 404)
    return json.loads(row[0])


def check(case, expected):
    if type(expected) is not int or expected != case['revision']:
        fail('CASE_REVISION_CONFLICT', '病例已有更新，请刷新后重试。', 409)


def persist(db, case, bump=True):
    if bump:
        case['revision'] += 1
    db.execute('UPDATE annotation_cases SET source=?,metadata=? WHERE id=?',
               (case['sourceId'], json.dumps(case, ensure_ascii=False), case['caseId']))
    db.execute('INSERT OR REPLACE INTO annotation_snapshots VALUES (?,?,?)',
               (case['caseId'], case['revision'], json.dumps(case, ensure_ascii=False)))


def reply(case):
    return {'apiVersion': 'annotation/v1', 'caseId': case['caseId'],
            'caseRevision': case['revision'], 'data': case}


def text(value, limit=10000):
    if not isinstance(value, str) or not value.strip() or len(value) > limit:
        fail('INVALID_TEXT', '文本不能为空或超过限制。')
    return value


def member(case, collection, item_id):
    item = next((i for i in case[collection] if i.get('id') == item_id), None)
    if item is None:
        fail('OBJECT_NOT_FOUND', '对象不属于当前病例。', 404)
    return item


def link(case, finding_id, entity_id):
    member(case, 'findings', finding_id)
    member(case, 'entities', entity_id)
    if not any(l['findingId'] == finding_id and l['entityId'] == entity_id for l in case['links']):
        case['links'].append({'id': identity(), 'findingId': finding_id, 'entityId': entity_id})


def mutation(db, case_id, key, payload):
    if not key or len(key) > 200:
        fail('IDEMPOTENCY_KEY_REQUIRED', '写入需提供幂等标识。')
    digest = hashlib.sha256(json.dumps(payload, sort_keys=True, ensure_ascii=False).encode()).hexdigest()
    prior = db.execute('SELECT digest,response FROM annotation_requests WHERE case_id=? AND key=?', (case_id, key)).fetchone()
    if prior:
        if prior[0] != digest:
            fail('IDEMPOTENCY_KEY_REUSED', '幂等标识被用于不同操作。', 409)
        return json.loads(prior[1])
    case = read(db, case_id)
    check(case, payload.get('expectedCaseRevision'))
    op = payload.get('operation')
    if op == 'report':
        sections = payload.get('sections')
        if not isinstance(sections, list) or not 1 <= len(sections) <= 50:
            fail('INVALID_REPORT', '报告须包含 1–50 个章节。')
        report = {'id': identity(), 'version': 1, 'name': text(payload.get('name', '报告'), 200), 'sections': []}
        for s in sections:
            if not isinstance(s, dict): fail('INVALID_REPORT', '章节须为对象。')
            body = text(s.get('text'), 100000)
            report['sections'].append({'id': identity(), 'name': text(s.get('name', 'Findings'), 200), 'text': body,
                                       'textSha256': hashlib.sha256(body.encode()).hexdigest()})
        case['reports'].append(report)
    elif op == 'finding':
        category = payload.get('category')
        if category is not None and (not isinstance(category, str) or category not in CATEGORIES):
            fail('INVALID_CODE', '请选择 ReXGroundingCT 类别。')
        finding = {'id': identity(), 'text': text(payload.get('text')), 'category': category, 'evidenceIds': [], 'assertion': 'unspecified'}
        evidence = payload.get('evidence')
        if evidence is not None:
            if not isinstance(evidence, dict): fail('INVALID_EVIDENCE', '原文证据须为对象。')
            report = member(case, 'reports', evidence.get('reportId'))
            section = next((s for s in report['sections'] if s['id'] == evidence.get('sectionId')), None)
            start, end = evidence.get('start'), evidence.get('end')
            if (section is None or evidence.get('reportVersion') != report['version'] or
                    type(start) is not int or type(end) is not int or not 0 <= start < end <= len(section['text']) or
                    section['text'][start:end] != evidence.get('quote')):
                fail('EVIDENCE_TEXT_MISMATCH', '原文范围与文本不一致，请重新选择。')
            eid = identity()
            case['evidence'].append(dict(evidence, id=eid))
            finding['evidenceIds'].append(eid)
        case['findings'].append(finding)
    elif op == 'updateFinding':
        finding = member(case, 'findings', payload.get('findingId'))
        if 'category' in payload:
            if payload['category'] is not None and (not isinstance(payload['category'], str) or payload['category'] not in CATEGORIES):
                fail('INVALID_CODE', '无效的 ReX 类别。')
            finding['category'] = payload['category']
        if 'text' in payload:
            finding['text'] = text(payload['text'])
    elif op == 'entity':
        finding_ids = payload.get('findingIds', [])
        if not isinstance(finding_ids, list):
            fail('INVALID_LINKS', 'Finding 引用须为数组。')
        for fid in finding_ids:
            member(case, 'findings', fid)
        entity = {'id': identity(), 'name': text(payload.get('name', '新病灶'), 200), 'maskId': None,
                  'labels': [], 'anatomy': [], 'annotationDisposition': 'needs_annotation', 'dispositionReason': None}
        case['entities'].append(entity)
        for fid in finding_ids:
            link(case, fid, entity['id'])
    elif op == 'link':
        link(case, payload.get('findingId'), payload.get('entityId'))
    elif op == 'unlink':
        target = member(case, 'links', payload.get('linkId'))
        case['links'].remove(target)
    elif op == 'entityMetadata':
        entity = member(case, 'entities', payload.get('entityId'))
        if 'name' in payload:
            entity['name'] = text(payload['name'], 200)
        if 'annotationDisposition' in payload:
            disposition = payload['annotationDisposition']
            if disposition not in ('needs_annotation', 'not_required'):
                fail('INVALID_DISPOSITION', '无效的标注处置。')
            entity['annotationDisposition'] = disposition
            entity['dispositionReason'] = text(payload.get('dispositionReason'), 500) if disposition == 'not_required' else None
    elif op == 'complete':
        if not case['sourceId']: fail('CT_REQUIRED', '请先打开参考 CT。', 409)
        for entity in case['entities']:
            if entity['annotationDisposition'] == 'not_required':
                continue
            if not entity['maskId']:
                fail('ANNOTATION_INCOMPLETE', '还有病灶尚未保存非空 mask。', 409)
            row = db.execute('SELECT metadata FROM masks WHERE source=? AND id=? ORDER BY version DESC LIMIT 1',
                             (case['sourceId'], entity['maskId'])).fetchone()
            if row is None or json.loads(row[0]).get('labelOnly'):
                fail('ANNOTATION_INCOMPLETE', '空草稿不能算完成。', 409)
        case['completedRevision'] = case['revision']
    else:
        fail('UNKNOWN_OPERATION', '不支持的标注操作。')
    persist(db, case, bump=op != 'complete')
    result = reply(case)
    db.execute('INSERT INTO annotation_requests VALUES (?,?,?,?)', (case_id, key, digest, json.dumps(result, ensure_ascii=False)))
    return result


def validate_mask_write(db, source_id, mask_id, case_id, entity_id, expected):
    schema(db)
    owner = db.execute('SELECT case_id,entity_id FROM annotation_mask_owners WHERE source=? AND mask_id=?', (source_id, mask_id)).fetchone() if mask_id else None
    if owner and (case_id, entity_id) != tuple(owner):
        fail('ANNOTATION_CONTEXT_REQUIRED', '此 mask 必须通过病灶标注上下文保存。', 409)
    if not case_id:
        return None
    case = read(db, case_id)
    check(case, expected)
    if case['sourceId'] != source_id:
        fail('REFERENCE_CASE_MISMATCH', 'CT 不属于当前标注病例。')
    entity = member(case, 'entities', entity_id)
    if entity['maskId'] != mask_id:
        fail('MASK_OWNER_CONFLICT', '病灶主 mask 已变化，请刷新。', 409)
    return case


def bind_mask(db, case, entity_id, record, bump=True):
    entity = member(case, 'entities', entity_id)
    entity['maskId'] = record['maskId']
    db.execute('INSERT OR IGNORE INTO annotation_mask_owners VALUES (?,?,?,?)',
               (case['sourceId'], record['maskId'], case['caseId'], entity_id))
    record['entityId'], record['annotationCaseId'] = entity_id, case['caseId']
    record['authority'] = 'draft' if record['labelOnly'] else 'human'
    persist(db, case, bump=bump)
