import json
import numpy as np
from test_annotation import client, setup_case, op, state, save, ROOT
from monailabel.endpoints import nifti_images
from monailabel.utils.others import annotation_domain as domain


def legacy(client, tmp_path, partial=False):
    source, _, _ = setup_case(client, tmp_path)
    seed = np.zeros(source['count'], dtype=np.uint8); seed[5] = 1
    response = client.post('/nifti-images/' + source['sourceId'] + '/masks',
        data={'raw': 'true', 'geometryHash': source['geometryHash'], 'label': 'legacy'},
        files={'file': ('mask.bin', seed.tobytes())})
    assert response.status_code == 200, response.text
    mid = response.json()['items'][0]['maskId']
    item = {'caseId': 'external', 'name': 'old case', 'sourceId': source['sourceId'],
        'reports': [{'id': 'report', 'name': 'original', 'statements': [
            {'id': 'statement', 'section': 'Lungs', 'text': '肺🙂 nodule.'}]}],
        'findings': [
            {'id': 'a', 'text': 'A', 'statementIds': ['statement'], 'maskIds': [mid]},
            {'id': 'b', 'text': 'B', 'candidateStatementIds': ['statement'], 'maskIds': [mid]}]}
    with nifti_images.database() as db:
        db.execute('INSERT INTO case_manifests VALUES (?,?)', ('legacy', json.dumps({'items': [item]})))
    registered = client.post(ROOT + '/worklists', json={'manifestId': 'legacy'}).json()
    cid = registered['items'][0]['caseId']
    if partial:
        # State written by the previous release: reports present, no Findings/Entities.
        with nifti_images.database() as db:
            case = domain.read(db, cid); case['sourceId'] = source['sourceId']
            section = item['reports'][0]['statements'][0]
            case['reports'] = [{'id': 'existing-report', 'version': 1, 'name': 'original',
                'sections': [{'id': 'existing-section', 'name': section['section'], 'text': section['text']}]}]
            domain.persist(db, case)
    return source, cid, mid, seed, item


def register(client, source, cid):
    response = client.post(ROOT + '/cases', json={'caseId': cid, 'sourceId': source['sourceId']},
        headers={'Idempotency-Key': 'legacy-register'})
    assert response.status_code == 200, response.text
    return response.json()['data']


def test_backfill_preserves_reports_shared_mask_and_user_decisions(client, tmp_path):
    source, cid, mid, seed, item = legacy(client, tmp_path, partial=True)
    url = '/nifti-images/' + source['sourceId'] + '/masks/' + mid
    old_file = client.get(url).content
    with nifti_images.database() as db:
        old_row = db.execute('SELECT metadata FROM masks WHERE id=?', (mid,)).fetchone()[0]
    case = state(client, {'caseId': cid})
    assert len(case['reports']) == 1 and case['reports'][0]['id'] == 'existing-report'
    assert len(case['findings']) == 2 and len(case['entities']) == 1 and len(case['links']) == 2
    assert case['evidence'][0]['quote'] == '肺🙂 nodule.'
    assert case['evidence'][0]['end'] == len('肺🙂 nodule.')
    assert case['findings'][1]['evidenceIds'] == []
    assert case['entities'][0]['maskId'] == mid
    assert state(client, case) == case
    assert register(client, source, cid) == case
    with nifti_images.database() as db:
        assert db.execute('SELECT metadata FROM masks WHERE id=?', (mid,)).fetchone()[0] == old_row
    assert client.get(url).content == old_file
    history = client.get('/nifti-images/' + source['sourceId'] + '/masks/history', params={'maskId': mid}).json()
    assert history['items'][0]['annotationCaseId'] == cid
    case = op(client, case, 'unlink', linkId=case['links'][0]['id']).json()['data']
    assert len(state(client, case)['links']) == 1
    case = op(client, case, 'updateFinding', findingId=case['findings'][0]['id'], text='edited').json()['data']
    assert state(client, case)['findings'][0]['text'] == 'edited'
    case = op(client, case, 'deleteEntity', entityId=case['entities'][0]['id']).json()['data']
    assert state(client, case)['entities'] == []
    assert state(client, case)['links'] == []


def test_migrated_mask_saves_same_identity_and_restores_old_version(client, tmp_path):
    source, cid, mid, seed, _ = legacy(client, tmp_path)
    case = register(client, source, cid); entity = case['entities'][0]
    url = '/nifti-images/' + source['sourceId'] + '/masks/' + mid
    old_file = client.get(url).content
    seed[6] = 1
    response = save(client, source, case, entity, seed, version=1)
    assert response.status_code == 200, response.text
    assert response.json()['items'][0]['maskId'] == mid
    assert response.json()['items'][0]['version'] == 2
    assert client.get(url + '?version=1').content == old_file
    case = state(client, case)
    restored = client.post(url + '/restore', json={'version': 1, 'expectedVersion': 2,
        'requestId': 'b' * 32, 'annotationCaseId': cid, 'annotationEntityId': entity['id'],
        'expectedCaseRevision': case['revision']})
    assert restored.status_code == 200, restored.text
    assert restored.json()['item']['version'] == 3
    assert len(state(client, case)['entities']) == 1


def test_missing_mask_retry_and_foreign_ownership(client, tmp_path):
    source, cid, mid, _, item = legacy(client, tmp_path)
    with nifti_images.database() as db:
        record = db.execute('SELECT * FROM masks WHERE id=?', (mid,)).fetchone()
        db.execute('DELETE FROM masks WHERE id=?', (mid,))
    case = register(client, source, cid)
    assert not case['entities']
    assert case['legacyManifestImport']['warnings'][0]['code'] == 'MISSING_MASK'
    with nifti_images.database() as db:
        db.execute('INSERT INTO masks VALUES (' + ','.join('?' for _ in record) + ')', tuple(record))
        db.execute('INSERT INTO annotation_mask_owners VALUES (?,?,?,?)', (source['sourceId'], mid, 'foreign', 'entity'))
    case = state(client, case)
    assert not case['entities']
    assert case['legacyManifestImport']['warnings'][0]['code'] == 'MASK_OWNED_BY_OTHER_CASE'
    with nifti_images.database() as db:
        db.execute('DELETE FROM annotation_mask_owners WHERE mask_id=?', (mid,))
    case = state(client, case)
    assert len(case['entities']) == 1 and len(case['links']) == 2
    assert not case['legacyManifestImport']['warnings']
