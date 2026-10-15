"""Add legacy manifest semantics without rewriting immutable mask versions.

The caller holds a BEGIN IMMEDIATE transaction. Stored maps are import receipts,
not a live mirror: later user edits, unlinks and deletions take precedence.
"""
import hashlib
import json
from . import annotation_domain as domain


def migrate_manifest(db, case):
    worklist = case.get('worklistId') or ''
    if not case.get('sourceId') or not worklist.startswith('manifest-'):
        return False
    manifest_id = worklist[len('manifest-'):]
    row = db.execute('SELECT metadata FROM case_manifests WHERE id=?', (manifest_id,)).fetchone()
    external = db.execute('SELECT external_key FROM annotation_cases WHERE id=?', (case['caseId'],)).fetchone()
    if not row or not external:
        return False
    item = next((i for i in json.loads(row[0])['items'] if i['caseId'] == external[0]), None)
    if not item or item.get('sourceId') not in (None, case['sourceId']):
        return False
    before = json.dumps(case, sort_keys=True)
    receipt = case.setdefault('legacyManifestImport', {
        'version': 1, 'manifestId': manifest_id, 'externalCaseId': external[0],
        'reports': {}, 'statements': {}, 'findings': {}, 'entities': {}, 'links': [],
    })
    warnings = []
    for incoming in item.get('reports', []):
        rid = incoming['id']
        if rid in receipt['reports']:
            continue
        statements = incoming.get('statements', [])
        signature = [(s['section'], s['text']) for s in statements]
        # Older registration already imported reports but did not retain origin IDs.
        report = next((r for r in case['reports'] if r['id'] not in receipt['reports'].values()
                       and r['name'] == incoming['name']
                       and [(s['name'], s['text']) for s in r['sections']] == signature), None)
        if report is None:
            report = {'id': domain.identity(), 'version': 1, 'name': incoming['name'], 'sections': [
                {'id': domain.identity(), 'name': s['section'], 'text': s['text'],
                 'textSha256': hashlib.sha256(s['text'].encode()).hexdigest()} for s in statements]}
            case['reports'].append(report)
        receipt['reports'][rid] = report['id']
        for statement, section in zip(statements, report['sections']):
            receipt['statements'][statement['id']] = {'reportId': report['id'], 'sectionId': section['id']}

    for incoming in item.get('findings', []):
        old_id = incoming['id']
        if old_id not in receipt['findings']:
            finding = {'id': domain.identity(), 'text': incoming.get('text') or 'Finding',
                       'category': None, 'evidenceIds': [], 'assertion': 'unspecified',
                       'legacySource': {'manifestId': manifest_id, 'findingId': old_id,
                                        'candidateStatementIds': incoming.get('candidateStatementIds', [])}}
            case['findings'].append(finding)
            receipt['findings'][old_id] = finding['id']
            for sid in incoming.get('statementIds', []):
                reference = receipt['statements'].get(sid)
                if not reference:
                    warnings.append({'code': 'MISSING_STATEMENT', 'findingId': old_id, 'statementId': sid})
                    continue
                report = next(r for r in case['reports'] if r['id'] == reference['reportId'])
                section = next(s for s in report['sections'] if s['id'] == reference['sectionId'])
                if not section['text']:
                    continue
                evidence = dict(reference, id=domain.identity(), reportVersion=report['version'],
                                start=0, end=len(section['text']), quote=section['text'])
                case['evidence'].append(evidence)
                finding['evidenceIds'].append(evidence['id'])
        fid = receipt['findings'][old_id]
        if not any(f['id'] == fid for f in case['findings']):
            continue
        for mid in dict.fromkeys(incoming.get('maskIds', [])):
            if mid not in receipt['entities']:
                row = db.execute('SELECT metadata FROM masks WHERE source=? AND id=? ORDER BY version DESC LIMIT 1',
                                 (case['sourceId'], mid)).fetchone()
                if not row:
                    warnings.append({'code': 'MISSING_MASK', 'findingId': old_id, 'maskId': mid})
                    continue
                mask = json.loads(row[0])
                if mask.get('anatomyReadOnly'):
                    warnings.append({'code': 'READ_ONLY_MASK', 'findingId': old_id, 'maskId': mid})
                    continue
                owner = domain.mask_owner(db, case['sourceId'], mid)
                if ((owner and owner['case_id'] != case['caseId']) or
                        (mask.get('annotationCaseId') and mask['annotationCaseId'] != case['caseId'])):
                    warnings.append({'code': 'MASK_OWNED_BY_OTHER_CASE', 'findingId': old_id, 'maskId': mid})
                    continue
                # Deletion leaves ownership in place. Remember it, never resurrect it.
                eid = owner['entity_id'] if owner else None
                entity = next((e for e in case['entities'] if e['id'] == eid or e.get('maskId') == mid), None)
                if owner and entity is None:
                    receipt['entities'][mid] = eid
                    continue
                if entity is None:
                    entity = {'id': domain.identity(), 'name': mask['name'], 'maskId': mid,
                              'labels': [], 'anatomy': [], 'annotationDisposition': 'needs_annotation',
                              'dispositionReason': None, 'legacySource': {'manifestId': manifest_id, 'maskId': mid}}
                    case['entities'].append(entity)
                receipt['entities'][mid] = entity['id']
                db.execute('INSERT OR IGNORE INTO annotation_mask_owners VALUES (?,?,?,?)',
                           (case['sourceId'], mid, case['caseId'], entity['id']))
            eid = receipt['entities'][mid]
            key = [old_id, mid]
            if key not in receipt['links'] and any(e['id'] == eid for e in case['entities']):
                domain.link(case, fid, eid)
                receipt['links'].append(key)
    # Preserve initial missing-evidence warnings; mask failures are retried on open.
    receipt['warnings'] = [w for w in receipt.get('warnings', []) if w['code'] == 'MISSING_STATEMENT']
    receipt['warnings'].extend(w for w in warnings if w not in receipt['warnings'])
    return before != json.dumps(case, sort_keys=True)
