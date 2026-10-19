import json
import numpy as np
import nibabel as nib
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from monailabel.endpoints import nifti_images, annotation
from test_format import phantom


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv('NIFTI_IMAGES_DIR', str(tmp_path / 'state'))
    monkeypatch.setenv('ENABLE_NIFTI_LIBRARY', 'true')
    monkeypatch.setenv('ENABLE_NIFTI_EDITING', 'true')
    app = FastAPI(); app.include_router(nifti_images.router); app.include_router(annotation.router)
    with TestClient(app) as c:
        yield c


ROOT = '/api/annotation/v1'


def setup_case(client, tmp_path):
    path = tmp_path / 'ct.nii'; phantom(path)
    source = client.post('/nifti-images', data={'modality': 'CT'}, files={'file': ('ct.nii', path.read_bytes())}).json()
    response = client.post(ROOT + '/cases', json={'sourceId': source['sourceId']}, headers={'Idempotency-Key':'register'})
    assert response.status_code == 200, response.text
    return source, response.json()['data'], path


def op(client, case, operation, key=None, **values):
    return client.post(ROOT + f"/cases/{case['caseId']}/operations", headers={'Idempotency-Key': key or operation + str(case['revision'])},
                       json={'operation': operation, 'expectedCaseRevision': case['revision'], **values})


def state(client, case):
    return client.get(ROOT + f"/cases/{case['caseId']}/context").json()['data']


def save(client, source, case, entity, seed, key='save', version=0):
    return client.post(ROOT + f"/cases/{case['caseId']}/entities/{entity['id']}/mask-versions", headers={'Idempotency-Key': key},
                       data={'expectedCaseRevision': case['revision'], 'expectedMaskVersion': version, 'geometryHash': source['geometryHash'], 'label': 'lesion', 'labelOnly': str(not np.any(seed)).lower()},
                       files={'file': ('mask.bin', seed.tobytes())})


def test_report_codepoints_shared_entity_and_idempotency(client, tmp_path):
    source, case, _ = setup_case(client, tmp_path)
    report = op(client, case, 'report', sections=[{'name':'Findings','text':'肺🙂 nodule.'}]).json()['data']; case=report
    r = case['reports'][0]; s=r['sections'][0]
    evidence = {'reportId':r['id'],'reportVersion':1,'sectionId':s['id'],'start':1,'end':2,'quote':'🙂'}
    response = op(client, case, 'finding', text='A', category='2d', evidence=evidence)
    assert response.status_code == 200, response.text
    first=response.json()['data']; case=first
    bad=op(client,case,'finding',text='Bad',category='2d',evidence=dict(evidence,quote='x'))
    assert bad.status_code == 422
    assert state(client,case)['revision']==case['revision']
    case=op(client,case,'finding',text='B',category='2d').json()['data']
    base=case
    response=op(client,base,'entity',key='shared',name='same lesion',findingIds=[f['id'] for f in case['findings']])
    assert response.status_code==200
    same=op(client,base,'entity',key='shared',name='same lesion',findingIds=[f['id'] for f in case['findings']])
    assert same.json()==response.json()
    case=response.json()['data']; assert len(case['entities'])==1 and len(case['links'])==2
    assert op(client,base,'entity',key='shared',name='different',findingIds=[]).status_code==409
    assert op(client,base,'entity',key='new-conflict',name='stale',findingIds=[]).status_code==409


def test_mask_atomic_identity_complete_invalidation_and_restore(client, tmp_path):
    source, case, _=setup_case(client,tmp_path)
    case=op(client,case,'entity',name='lesion').json()['data']; entity=case['entities'][0]
    assert op(client,case,'complete').status_code==409
    seed=np.zeros(source['count'],dtype=np.uint8); seed[5]=1
    response=save(client,source,case,entity,seed)
    assert response.status_code==200,response.text
    replay=save(client,source,case,entity,seed)
    assert replay.json()==response.json()
    mid=response.json()['items'][0]['maskId']; old=case
    case=state(client,case)
    assert case['entities'][0]['maskId']==mid
    assert response.json()['items'][0]['voxelCount']==1
    case=op(client,case,'complete').json()['data']
    assert case['completedRevision']==case['revision']
    assert save(client,source,old,entity,seed,key='stale').status_code==409
    # Old write path cannot bypass Case revision checks for a registered lesion.
    bypass=client.post('/nifti-images/'+source['sourceId']+'/masks',data={'raw':'true','maskId':mid,'expectedVersion':1,'geometryHash':source['geometryHash']},files={'file':('seed.bin',seed.tobytes())})
    assert bypass.status_code==409
    seed[6]=1
    assert save(client,source,case,entity,seed,key='save2',version=1).status_code==200
    case=state(client,case); assert case['completedRevision']!=case['revision']
    restore=client.post('/nifti-images/'+source['sourceId']+'/masks/'+mid+'/restore',json={'version':1,'expectedVersion':2,'requestId':'a'*32,'annotationCaseId':case['caseId'],'annotationEntityId':entity['id'],'expectedCaseRevision':case['revision']})
    assert restore.status_code==200,restore.text
    assert restore.json()['item']['version']==3
    assert state(client,case)['revision']==case['revision']+1


def test_failed_file_commit_rolls_back_entity_binding(client,tmp_path,monkeypatch):
    source,case,_=setup_case(client,tmp_path)
    case=op(client,case,'entity',name='lesion').json()['data'];entity=case['entities'][0]
    def fail_write(*args): raise OSError('disk failed')
    monkeypatch.setattr(nifti_images,'write_mask',fail_write)
    seed=np.ones(source['count'],dtype=np.uint8)
    with pytest.raises(OSError): save(client,source,case,entity,seed)
    after=state(client,case)
    assert after['revision']==case['revision'] and after['entities'][0]['maskId'] is None
    with nifti_images.database() as db:
        assert db.execute('SELECT count(*) FROM annotation_mask_owners').fetchone()[0]==0


def test_worklist_progress_counts_unopened_cases(client,tmp_path,monkeypatch):
    path=tmp_path/'ct.nii';phantom(path);monkeypatch.setenv('NIFTI_IMPORT_ROOTS',json.dumps([str(tmp_path)]))
    manifest=client.post('/nifti-images/manifest/preview',data={'modality':'CT'},files={'file':('cases.json',json.dumps({'cases':[{'caseId':'a','image':'ct.nii'},{'caseId':'b','image':'ct.nii'}]}).encode())}).json()
    registered=client.post(ROOT+'/worklists',json={'manifestId':manifest['id']}).json()
    assert client.post(ROOT+'/worklists',json={'manifestId':manifest['id']}).json()==registered
    source=client.post('/nifti-images',data={'modality':'CT'},files={'file':('ct.nii',path.read_bytes())}).json()
    case=client.post(ROOT+'/cases',json={'caseId':registered['items'][0]['caseId'],'sourceId':source['sourceId']},headers={'Idempotency-Key':'register'}).json()['data']
    case=op(client,case,'complete').json()['data']
    p=client.get(ROOT+f"/worklists/{registered['worklistId']}/progress").json()
    assert p=={'totalCases':2,'completedCases':1,'completionPercent':50}
    case=op(client,case,'entity',name='new lesion').json()['data']
    assert client.get(ROOT+f"/worklists/{registered['worklistId']}/progress").json()['completedCases']==0


def test_anatomy_is_read_only_and_not_lesion_completion(client,tmp_path):
    source,case,path=setup_case(client,tmp_path)
    image=nib.load(path);data=np.zeros(image.shape,dtype=np.uint8);data[1,1,1]=1;data[2,2,2]=2
    file=tmp_path/'anatomy.nii';nib.save(nib.Nifti1Image(data,image.affine,image.header),file)
    url=ROOT+f"/cases/{case['caseId']}/anatomy-layers"
    bad=client.post(url,data={'labelMap':'{"1":"lung"}'},files={'file':('anatomy.nii',file.read_bytes())});assert bad.status_code==422
    response=client.post(url,data={'labelMap':'{"1":"lung","2":"heart"}'},files={'file':('anatomy.nii',file.read_bytes())})
    assert response.status_code==200,response.text
    after=state(client,case);assert after['revision']==case['revision'] and after['entities']==[] and len(after['anatomyLayers'])==1
    m=response.json()['items'][0];assert m['anatomyReadOnly']
    seed=np.ones(source['count'],dtype=np.uint8)
    write=client.post('/nifti-images/'+source['sourceId']+'/masks',data={'raw':'true','maskId':m['maskId'],'expectedVersion':1,'geometryHash':source['geometryHash']},files={'file':('seed.bin',seed.tobytes())})
    assert write.status_code==409
    assert op(client,after,'complete').status_code==200


def test_unknown_references_cannot_create_partial_entity(client,tmp_path):
    _,case,_=setup_case(client,tmp_path)
    response=op(client,case,'entity',name='lesion',findingIds=['other-case'])
    assert response.status_code==404
    assert state(client,case)['entities']==[]


def test_registration_retry_and_invalid_evidence_payload(client,tmp_path):
    source,case,_=setup_case(client,tmp_path)
    replay=client.post(ROOT+'/cases',json={'sourceId':source['sourceId']},headers={'Idempotency-Key':'register'})
    assert replay.json()['data']==case
    conflict=client.post(ROOT+'/cases',json={'sourceId':source['sourceId'],'caseId':case['caseId']},headers={'Idempotency-Key':'register'})
    assert conflict.status_code==409
    assert op(client,case,'finding',text='A',category=[]).status_code==422
    assert op(client,case,'finding',text='A',evidence=[]).status_code==422
    assert state(client,case)['findings']==[]


def test_presentation_only_save_keeps_completion(client,tmp_path):
    source,case,_=setup_case(client,tmp_path)
    case=op(client,case,'entity',name='lesion').json()['data'];entity=case['entities'][0]
    seed=np.zeros(source['count'],dtype=np.uint8);seed[5]=1
    assert save(client,source,case,entity,seed).status_code==200
    case=op(client,state(client,case),'complete').json()['data']
    response=client.post(ROOT+f"/cases/{case['caseId']}/entities/{entity['id']}/mask-versions",headers={'Idempotency-Key':'style'},
        data={'expectedCaseRevision':case['revision'],'expectedMaskVersion':1,'geometryHash':source['geometryHash'],'label':'lesion','provenance':json.dumps({'displayColor':[45,160,210,255]})},
        files={'file':('mask.bin',seed.tobytes())})
    assert response.status_code==200,response.text
    after=state(client,case)
    assert after['revision']==case['revision'] and after['completedRevision']==after['revision']
    assert response.json()['items'][0]['version']==1
    assert response.json()['items'][0]['saveStatus']=='metadata'


def test_delete_shared_entity_preserves_report_and_mask_history(client, tmp_path):
    source, case, _ = setup_case(client, tmp_path)
    case = op(client, case, 'finding', text='A', category='2d').json()['data']
    case = op(client, case, 'finding', text='B', category='2d').json()['data']
    case = op(client, case, 'entity', name='shared', findingIds=[f['id'] for f in case['findings']]).json()['data']
    entity = case['entities'][0]
    seed = np.ones(source['count'], dtype=np.uint8)
    saved = save(client, source, case, entity, seed)
    assert saved.status_code == 200
    mask_id = saved.json()['items'][0]['maskId']
    case = op(client, state(client, case), 'complete').json()['data']
    response = op(client, case, 'deleteEntity', key='delete-shared', entityId=entity['id'])
    assert response.status_code == 200
    after = response.json()['data']
    assert after['entities'] == [] and after['links'] == []
    assert after['findings'] == case['findings']
    assert after['revision'] == case['revision'] + 1
    assert after['completedRevision'] != after['revision']
    assert after['deletedEntities'][0]['maskId'] == mask_id
    assert op(client, case, 'deleteEntity', key='delete-shared', entityId=entity['id']).json() == response.json()
    assert op(client, after, 'deleteEntity', entityId='other-case').status_code == 404
    assert state(client, after)['revision'] == after['revision']
    assert client.get('/nifti-images/' + source['sourceId'] + '/masks/' + mask_id).status_code == 200
    # Deleted masks cannot be resurrected by either save API.
    assert save(client, source, after, entity, seed, key='deleted-save', version=1).status_code == 404
    bypass = client.post('/nifti-images/' + source['sourceId'] + '/masks',
        data={'raw':'true','maskId':mask_id,'expectedVersion':1,'geometryHash':source['geometryHash']},
        files={'file':('mask.bin',seed.tobytes())})
    assert bypass.status_code == 409


def test_delete_unsaved_entity_rejects_stale_revision(client, tmp_path):
    _, case, _ = setup_case(client, tmp_path)
    old = case
    case = op(client, case, 'entity', name='new').json()['data']
    entity = case['entities'][0]
    assert op(client, old, 'deleteEntity', entityId=entity['id']).status_code == 409
    after = op(client, case, 'deleteEntity', entityId=entity['id']).json()['data']
    assert not after['entities'] and after['deletedEntities'][0]['maskId'] is None


def test_gzip_mask_matches_raw_version_and_replays(client, tmp_path):
    import gzip
    source,case,_=setup_case(client,tmp_path)
    assert 'gzip' in source['capabilities']['maskEncodings']
    case=op(client,case,'entity',name='Entity').json()['data'];entity=case['entities'][0]
    seed=np.zeros(source['count'],dtype=np.uint8);seed[5:9]=1
    first=save(client,source,case,entity,seed).json()['items'][0]
    case=state(client,case)
    def packed():
        return client.post(ROOT+f"/cases/{case['caseId']}/entities/{entity['id']}/mask-versions",
            headers={'Idempotency-Key':'gzip-save'},
            data={'expectedCaseRevision':case['revision'],'expectedMaskVersion':1,'geometryHash':source['geometryHash'],'label':'Entity'},
            files={'file':('mask.bin.gz',gzip.compress(seed.tobytes()))})
    response=packed();assert response.status_code==200,response.text
    item=response.json()['items'][0]
    assert item['maskId']==first['maskId'] and item['version']==1
    assert item['voxelHash']==first['voxelHash'] and item['voxelCount']==4
    assert item['geometryHash']==first['geometryHash']
    assert packed().json()==response.json()


@pytest.mark.parametrize('invalid', ['truncated', 'crc', 'oversize', 'nonbinary'])
def test_invalid_gzip_mask_has_no_partial_version_or_binding(client,tmp_path,invalid):
    import gzip
    source,case,_=setup_case(client,tmp_path)
    case=op(client,case,'entity',name='Entity').json()['data'];entity=case['entities'][0]
    seed=bytes(source['count'])
    if invalid=='oversize': seed+=b'\x00'
    if invalid=='nonbinary': seed=b'\x02'+seed[1:]
    payload=gzip.compress(seed)
    if invalid=='truncated': payload=payload[:-4]
    if invalid=='crc': payload=payload[:-8]+bytes([payload[-8]^1])+payload[-7:]
    response=client.post(ROOT+f"/cases/{case['caseId']}/entities/{entity['id']}/mask-versions",
        headers={'Idempotency-Key':'bad-gzip'},
        data={'expectedCaseRevision':case['revision'],'expectedMaskVersion':0,'geometryHash':source['geometryHash'],'labelOnly':'true'},
        files={'file':('mask.bin.gz',payload)})
    assert response.status_code==422,response.text
    after=state(client,case)
    assert after['revision']==case['revision'] and after['entities'][0]['maskId'] is None
    with nifti_images.database() as db:
        assert db.execute('SELECT count(*) FROM annotation_mask_owners').fetchone()[0]==0
