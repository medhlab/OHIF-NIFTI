import copy
import hashlib
import json
import pytest
from fastapi import HTTPException
from monailabel.utils.others import annotation_domain as domain
from monailabel.utils.others.report_extraction import normalize_result, observation_bindings
from test_annotation import client, setup_case, op, state


def fixture():
    source = {'name': 'case.nii.gz', 'findings': '肺🙂结节和胸膜增厚。', 'impressions': '可能结节。'}
    span = {'reportSection':'findings','start':1,'end':9,'text':source['findings'][1:9]}
    result = {'volumeName':source['name'],'modelName':'GLM-5.3','processingVersion':'test',
              'reportSha256':{s:hashlib.sha256(source[s].encode()).hexdigest() for s in ['findings','impressions']},
              'mentions':[], 'lesions':[], 'rejectedMentions':[], 'heldImpressionMentionIds':[],
              'crossSectionCandidates':[], 'reportContext':{'relations':[]}}
    for i, code in enumerate(['2d','2e']):
        result['mentions'].append({'mentionId':f'm{i}', 'categoryCode':code,'sourceReportSpan':span,'certainty':'uncertain','term':f'观察{i}'})
        result['lesions'].append({'sourceFindingId':f'f{i}','originMentionId':f'm{i}','categoryCode':code,'sourceReportSpan':span,'text':span['text']})
    result['counts']={'acceptedMentions':2,'rejectedMentions':0,'proposedLesions':2,'crossSectionCandidates':0,'heldImpressionMentions':0}
    return source, result


def test_unicode_shared_evidence_and_no_automatic_entities():
    source, result=fixture();report,evidence,findings,extraction=normalize_result(source,result,'run')
    assert len(evidence)==1 and len(findings)==2
    assert evidence[0]['quote']=='🙂结节和胸膜增厚'
    assert all(f['evidenceIds']==[evidence[0]['id']] and f['origin']=='model' for f in findings)
    assert len(extraction['observations'])==2


def test_semantic_only_and_rejected_formats_are_preserved():
    source,result=fixture();result['mentions'][0]['categoryCode']=''
    result['lesions']=result['lesions'][1:];result['counts']['proposedLesions']=1
    result['rejectedMentions']=[{'index':0,'reason':'negation_needs_review','sourceReportSpan':result['mentions'][0]['sourceReportSpan']},
        {'index':1,'reason':'invalid_mention_fields','rawMention':{'category_code':'2d nodule','source_text':'不能匹配的原文'}}]
    result['counts']['rejectedMentions']=2
    _,_,findings,x=normalize_result(source,result,'run')
    assert x['observations'][0]['category'] is None and x['observations'][0]['findingId'] is None
    assert x['rejected'][0]['evidenceIds'] and not x['rejected'][1]['evidenceIds']
    assert x['rejected'][1]['category']=='2d nodule'


@pytest.mark.parametrize('change',[lambda s,r:s.update(findings='原文改了'),
    lambda s,r:r['mentions'][0]['sourceReportSpan'].update(start=0),
    lambda s,r:r['counts'].update(proposedLesions=9),
    lambda s,r:r['crossSectionCandidates'].append({'findingsMentionId':'missing','impressionsMentionId':'m0'})])
def test_reject_mismatched_hash_span_count_or_relation(change):
    source,result=fixture();change(source,result)
    with pytest.raises(HTTPException) as error: normalize_result(source,result,'run')
    assert error.value.status_code==422


def test_import_preserves_human_data_and_replay_and_shared_links(client,tmp_path):
    _,case,_=setup_case(client,tmp_path)
    case=op(client,case,'finding',text='人工影像发现',category='2d').json()['data']
    case=op(client,case,'entity',name='人工病灶',findingIds=[case['findings'][0]['id']]).json()['data']
    source,result=fixture();base=case
    payload={'reportSource':source,'result':result,'runId':'run'}
    reply=op(client,case,'reportExtraction',key='import-real',**payload)
    assert reply.status_code==200,reply.text
    case=reply.json()['data'];assert len(case['entities'])==1 and len(case['findings'])==3
    assert op(client,base,'reportExtraction',key='import-real',**payload).json()==reply.json()
    assert op(client,case,'reportExtraction',key='new-import',**payload).status_code==409
    old=copy.deepcopy(case)
    bad=op(client,case,'link',findingId=case['findings'][1]['id'],entityId=case['entities'][0]['id'],observationIds=['missing'])
    assert bad.status_code==422 and state(client,case)==old
    case=op(client,case,'link',findingId=case['findings'][1]['id'],entityId=case['entities'][0]['id'],observationIds=['m0']).json()['data']
    assert len(case['links'])==2 and len(case['entities'])==1
    assert case['entities'][0]['reportObservations'][0]['observationId']=='m0'
