import copy
import pytest
from fastapi import HTTPException
from monailabel.utils.others.report_case_v2 import import_case_v2
from monailabel.utils.others.report_ontology import import_ontology, VERSION
from monailabel.utils.others.case_v2_contract.case_contract import digest
from test_report_case_v2 import fixture, empty

def overlay(c):
 x=c['caseV2Extraction'];items=[]
 for o in x['sourcePayload']['observations']:
  for key,text in [(o['id'],o['concept']['text'])]+[(o['id']+'/anatomy/'+str(i),a['text']) for i,a in enumerate(o['anatomy'])]:
   items.append({'key':key,'text':text,'state':'candidate','reason':'synthetic test','candidates':[{'code':'111','label':'Synthetic term'}],
    'mappings':[{'system':'SNOMED_CT','code':'111','label':'Synthetic term','status':'candidate','humanConfirmed':False,'indexValidated':True,'indexSha256':'a'*64}]})
 return {'schemaVersion':VERSION,'sourceSha256':digest(x['sourcePayload']),'indexSha256':'a'*64,'items':items,'humanConfirmed':False,'provenance':{'mode':'synthetic'}}

def seeded():
 c=empty();import_case_v2(c,fixture());return c

def test_preserves_original_objects_and_noop():
 c=seeded();c['findings']=[{'id':'manual','text':'人工修订'}];c['entities']=[{'id':'e','maskId':'original'}];c['links']=[{'findingId':'manual','entityId':'e'}]
 before=copy.deepcopy(c);o=overlay(c)
 assert import_ontology(c,{'ontology':o})
 assert {k:v for k,v in c.items() if k!='caseV2Ontology'}==before
 after=copy.deepcopy(c);assert import_ontology(c,{'ontology':o}) is False and c==after
 o['provenance']['mode']='changed'
 with pytest.raises(HTTPException) as e:import_ontology(c,{'ontology':o})
 assert e.value.status_code==409 and c==after

@pytest.mark.parametrize('bad',['hash','missing','invented','confirmed','duplicate','label'])
def test_invalid_atomic(bad):
 c=seeded();o=overlay(c);before=copy.deepcopy(c)
 if bad=='hash':o['sourceSha256']='bad'
 if bad=='missing':o['items'].pop()
 if bad=='invented':o['items'][0]['mappings'][0]['code']='222'
 if bad=='confirmed':o['humanConfirmed']=True
 if bad=='duplicate':o['items'][-1]=copy.deepcopy(o['items'][0])
 if bad=='label':o['items'][0]['mappings'][0]['label']='invented label'
 with pytest.raises(HTTPException):import_ontology(c,{'ontology':o})
 assert c==before

from test_annotation import client, setup_case, op, state, save
import numpy as np
import hashlib

def test_api_mask_preservation_and_reopen(client,tmp_path):
 source,c,_=setup_case(client,tmp_path)
 c=op(client,c,'finding',text='人工描述',category='2d').json()['data']
 c=op(client,c,'entity',name='保留 Entity',findingIds=[c['findings'][0]['id']]).json()['data']
 seed=np.zeros(source['count'],dtype=np.uint8);seed[5:9]=1
 assert save(client,source,c,c['entities'][0],seed).status_code==200
 c=state(client,c)
 c=op(client,c,'reportExtraction',**fixture()).json()['data']
 before=copy.deepcopy(c)
 def masks():return {str(p):hashlib.sha256(p.read_bytes()).hexdigest() for p in (tmp_path/'state').rglob('*') if p.is_file() and '/masks/' in str(p)}
 hashes=masks();assert hashes
 result=op(client,c,'ontologyMapping',ontology=overlay(c))
 assert result.status_code==200,result.text
 c=result.json()['data'];assert state(client,c)==c
 for k in ['findings','entities','links','reports','evidence','caseV2Extraction']:assert c[k]==before[k]
 again=op(client,c,'ontologyMapping',key='duplicate',ontology=overlay(c));assert again.json()['data']==c
 assert masks()==hashes
