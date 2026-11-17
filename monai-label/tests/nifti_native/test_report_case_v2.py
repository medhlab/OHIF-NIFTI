import copy
import json
from pathlib import Path
import numpy as np
import pytest
from fastapi import HTTPException
from monailabel.utils.others.report_case_v2 import import_case_v2, validate
from test_annotation import client, setup_case, op, state, save
from test_report_extraction import fixture as legacy_fixture


def fixture(name='case_semantics_v2'):
    result = json.loads((Path(__file__).parent/'fixtures'/f'{name}.json').read_text())
    return {'reportSource': {'name': result['volumeName'], **{k:v['text'] for k,v in result['reports'].items()}},
            'result': result, 'runId': 'offline-v2'}


def empty():
    return {'reports': [], 'evidence': [], 'findings': [], 'entities': [], 'links': []}


@pytest.mark.parametrize('name', ['case_semantics_v2', 'temporal_group', 'temporal_statements'])
def test_lossless_no_inferred_objects(name):
    p=fixture(name); original=copy.deepcopy(p); c=empty()
    assert import_case_v2(c,p)
    assert c['caseV2Extraction']['sourcePayload']==original['result'] and p==original
    assert not c['findings'] and not c['entities']
    before=copy.deepcopy(c)
    assert import_case_v2(c,dict(p,runId='another-run')) is False and c==before
    for e in c['evidence']:
        section=next(s for s in c['reports'][0]['sections'] if s['id']==e['sectionId'])
        assert section['text'][e['start']:e['end']]==e['quote']


@pytest.mark.parametrize('change', [
    lambda r:r.update(schemaVersion='unknown/v3'),
    lambda r:r['reports']['findings'].update(sha256='bad'),
    lambda r:r['evidence'][0].update(start=True),
    lambda r:r['observations'][0]['evidenceIds'].append('missing'),
    lambda r:r['legacyIdMap'].update(old='missing'),
    lambda r:r['relations'].append({'id':'r','type':'compared_to','sourceIds':[r['observations'][0]['id']], 'targetIds':[], 'evidenceIds':[r['evidence'][0]['id']], 'status':'proposed'}),
    lambda r:r['labelAssignments'].append({'subjectId':'missing','labelSetId':'x','labelId':'x','status':'legacy_unverified'}),
])
def test_invalid_is_atomic(change):
    p=fixture();change(p['result']);c=empty();before=copy.deepcopy(c)
    with pytest.raises(HTTPException) as error: import_case_v2(c,p)
    assert error.value.status_code==422 and c==before


def test_group_hash_binding():
    p=fixture('temporal_group');p['result']['rawModelOutput']['mentions'][0]['term']='changed'
    with pytest.raises(HTTPException):validate(p['reportSource'],p['result'])


def test_api_save_reopen_conflicts_and_mask_preservation(client,tmp_path):
    source,case,_=setup_case(client,tmp_path)
    for text in ['人工描述 A','人工描述 B']:
        case=op(client,case,'finding',text=text,category='2d').json()['data']
    case=op(client,case,'entity',name='共享人工 Entity',findingIds=[f['id'] for f in case['findings']]).json()['data']
    seed=np.zeros(source['count'],dtype=np.uint8);seed[5:9]=1
    saved=save(client,source,case,case['entities'][0],seed)
    assert saved.status_code==200,saved.text
    import hashlib
    def mask_hashes():
        return {str(f): hashlib.sha256(f.read_bytes()).hexdigest()
                for f in (tmp_path/'state').rglob('*') if f.is_file() and '/masks/' in str(f)}
    mask_files = mask_hashes()
    assert mask_files
    case=state(client,case); before=copy.deepcopy(case)
    response=op(client,case,'reportExtraction',**fixture('temporal_group'))
    assert response.status_code==200,response.text
    case=response.json()['data']
    for key in ['findings','entities','links']:assert case[key]==before[key]
    assert state(client,case)==case
    replay=op(client,case,'reportExtraction',key='new-key',**fixture('temporal_group'))
    assert replay.status_code==200 and replay.json()['data']==case
    p=fixture('temporal_group');p['result']['modelName']='updated'
    assert op(client,case,'reportExtraction',key='changed',**p).status_code==409
    assert state(client,case)==case
    assert mask_files == mask_hashes()
    import nibabel as nib
    mask_path = next((tmp_path/'state').rglob('mask.nii.gz'))
    assert np.count_nonzero(nib.load(mask_path).get_fdata()) == 4



def test_explicit_legacy_mapping_preserves_edited_findings(client,tmp_path):
    _,case,_=setup_case(client,tmp_path)
    p=fixture();r=p['result'];s=p['reportSource'];_,legacy=legacy_fixture()
    legacy['volumeName']=s['name'];legacy['reportSha256']={k:v['sha256'] for k,v in r['reports'].items()}
    for i,o in enumerate(r['observations']):
        e=next(e for e in r['evidence'] if e['id']==o['sentenceEvidenceId'])
        span={'reportSection':e['section'],'start':e['start'],'end':e['end'],'text':e['text']}
        legacy['mentions'][i]['sourceReportSpan']=span
        legacy['lesions'][i].update(sourceReportSpan=span,text=e['text'])
        r['legacyIdMap'][f'm{i}']=o['id']
    case=op(client,case,'reportExtraction',reportSource=s,result=legacy,runId='legacy').json()['data']
    case=op(client,case,'updateFinding',findingId=case['findings'][0]['id'],text='人工修订',category=None).json()['data']
    before=copy.deepcopy(case)
    response=op(client,case,'reportExtraction',**p)
    assert response.status_code==200,response.text
    case=response.json()['data']
    assert case['findings']==before['findings'] and case['reportExtraction']==before['reportExtraction']
    assert case['reports']==before['reports']
    mapping=case['caseV2Extraction']['sourceIdMap']['observations']
    assert mapping[r['observations'][0]['id']]['findingIds']==[case['findings'][0]['id']]


def test_unicode_repeated_quote_order_and_unknown_semantics_retained():
    import hashlib
    p=fixture();r=p['result'];prefix='肺🙂 é。 '
    r['reports']['findings']['text']=prefix+r['reports']['findings']['text']
    r['reports']['findings']['sha256']=hashlib.sha256(r['reports']['findings']['text'].encode()).hexdigest()
    p['reportSource']['findings']=r['reports']['findings']['text']
    for e in r['evidence']:
        e['start']+=len(prefix);e['end']+=len(prefix)
    r['observations'].reverse()
    r['futureExtension']={'status':'preserve-only','value':[1,2]}
    c=empty();import_case_v2(c,p)
    x=c['caseV2Extraction']
    assert x['observations'][0]['term']=='renal cyst'
    assert x['sourcePayload']==r
    assert c['evidence'][0]['start']==len(prefix)


def test_bad_optional_shapes_are_validation_errors():
    for field in ['observations','evidence','relations','labelAssignments','legacyIdMap','provenance','temporalGroups']:
        p=fixture();p['result'][field]=[None]
        with pytest.raises(HTTPException) as e:import_case_v2(empty(),p)
        assert e.value.status_code==422
