import hashlib
import json
import uuid
import numpy as np
from test_annotation import client, setup_case, op, state, save
from monailabel.endpoints import nifti_images as api


def setup_mask(client, tmp_path):
    source, case, _ = setup_case(client, tmp_path)
    case = op(client, case, 'entity', name='lesion').json()['data']
    pixels = np.zeros(source['count'], dtype=np.uint8); pixels[5] = 1
    first = save(client, source, case, case['entities'][0], pixels).json()['items'][0]
    return source, state(client, case), pixels, first


def attributes(client, source, case, mask, key=None, **changes):
    return client.post(f"/nifti-images/{source['sourceId']}/masks/{mask['maskId']}/metadata",
        headers={'Idempotency-Key': key or str(uuid.uuid4())}, json={
            'expectedVersion': mask['version'], 'expectedMetadataRevision': mask.get('metadataRevision', 0),
            'annotationCaseId': case['caseId'], 'annotationEntityId': case['entities'][0]['id'],
            'expectedCaseRevision': case['revision'], **changes})


def test_noop_upload_and_legacy_hash_keep_version_and_completion(client, tmp_path):
    source, case, pixels, first = setup_mask(client, tmp_path)
    case = op(client, case, 'complete').json()['data']
    path = api.root()/source['sourceId']/'masks'/first['maskId']/'1'/'mask.nii.gz'
    before = path.read_bytes()
    # Emulate a pre-hash version without rewriting its voxel file.
    with api.database() as db:
        raw = dict(first); raw.pop('voxelHash')
        db.execute('UPDATE masks SET metadata=? WHERE source=? AND id=?', (json.dumps(raw),source['sourceId'],first['maskId']))
    result = save(client,source,case,case['entities'][0],pixels,key='repeat',version=1)
    assert result.status_code == 200, result.text
    assert result.json()['items'][0]['saveStatus'] == 'skipped'
    assert result.json()['items'][0]['version'] == 1
    assert state(client,case)==case
    assert path.read_bytes()==before
    assert not (path.parent.parent/'2').exists()
    assert save(client,source,case,case['entities'][0],pixels,key='repeat',version=1).json()==result.json()
    pixels[6]=1
    changed=save(client,source,case,case['entities'][0],pixels,key='changed',version=1)
    assert changed.json()['items'][0]['version']==2
    assert changed.json()['items'][0]['saveStatus']=='saved'
    assert state(client,case)['revision']>case['revision']


def test_name_color_metadata_do_not_rewrite_versions_and_replay(client, tmp_path):
    source, case, pixels, first = setup_mask(client,tmp_path)
    folder=api.root()/source['sourceId']/'masks'/first['maskId']
    files={str(p):p.read_bytes() for p in folder.rglob('*') if p.is_file()}
    response=attributes(client,source,case,first,key='metadata',name='renamed',displayColor=[1,2,3,255])
    assert response.status_code==200,response.text
    updated=response.json()['items'][0]
    assert updated['version']==1 and updated['metadataRevision']==1 and updated['saveStatus']=='metadata'
    assert attributes(client,source,case,first,key='metadata',name='renamed',displayColor=[1,2,3,255]).json()==response.json()
    case=state(client,case); assert case['entities'][0]['name']=='renamed'
    assert {str(p):p.read_bytes() for p in folder.rglob('*') if p.is_file()}==files
    url=f"/nifti-images/{source['sourceId']}/masks"
    item=client.get(url).json()['items'][0]
    assert item['name']=='renamed' and item['displayColor']==[1,2,3,255]
    assert attributes(client,source,case,updated,name='renamed').json()['items'][0]['saveStatus']=='skipped'
    assert attributes(client,source,case,first,name='stale').status_code==409
    assert attributes(client,source,case,updated,displayColor=[1,2,3,0]).status_code==422
    # The existing Entity rename operation uses the same metadata store.
    renamed=op(client,case,'entityMetadata',entityId=case['entities'][0]['id'],name='entity name')
    assert renamed.status_code==200,renamed.text
    assert client.get(url).json()['items'][0]['name']=='entity name'
    assert {str(p):p.read_bytes() for p in folder.rglob('*') if p.is_file()}==files


def test_metadata_owner_and_stale_voxel_version_are_enforced(client,tmp_path):
    source,case,pixels,first=setup_mask(client,tmp_path)
    url=f"/nifti-images/{source['sourceId']}/masks/{first['maskId']}/metadata"
    assert client.post(url,headers={'Idempotency-Key':'bypass'},json={'expectedVersion':1,'name':'bypass'}).status_code==409
    pixels[7]=1
    assert save(client,source,case,case['entities'][0],pixels,key='v2',version=1).status_code==200
    case=state(client,case)
    assert attributes(client,source,case,first,name='stale').status_code==409

def test_restore_keeps_current_metadata_and_deduplicates_next_save(client, tmp_path):
    from test_save_changes import setup_mask, attributes
    from test_annotation import state, save
    source, case, pixels, first = setup_mask(client, tmp_path)
    original = pixels.copy()
    pixels[6] = 1
    second = save(client, source, case, case['entities'][0], pixels, key='v2', version=1).json()['items'][0]
    case = state(client, case)
    metadata = attributes(client, source, case, second, name='current name', displayColor=[10,200,130,255])
    assert metadata.status_code == 200, metadata.text
    case = state(client, case)
    url = f"/nifti-images/{source['sourceId']}/masks/{first['maskId']}"
    body = {'version':1, 'expectedVersion':2, 'requestId':str(uuid.uuid4()), 'annotationCaseId':case['caseId'],
            'annotationEntityId':case['entities'][0]['id'], 'expectedCaseRevision':case['revision']}
    restored = client.post(url+'/restore', json=body)
    assert restored.status_code == 200, restored.text
    item = restored.json()['item']
    assert item['version'] == 3 and item['parentVersion'] == 2 and item['restoredFrom'] == 1
    assert item['name'] == 'current name' and item['displayColor'] == [10,200,130,255]
    replay = client.post(url+'/restore', json=body).json()
    assert replay['replayed'] and replay['item']['name'] == item['name']
    case = state(client, case)
    unchanged = client.post(f"/api/annotation/v1/cases/{case['caseId']}/entities/{case['entities'][0]['id']}/mask-versions",
        headers={'Idempotency-Key':'after-restore'}, data={'expectedCaseRevision':case['revision'], 'expectedMaskVersion':3,
        'geometryHash':source['geometryHash'], 'label':'current name'}, files={'file':('mask.bin',original.tobytes())})
    assert unchanged.status_code == 200, unchanged.text
    assert unchanged.json()['items'][0]['version'] == 3
    assert unchanged.json()['items'][0]['saveStatus'] == 'skipped'
