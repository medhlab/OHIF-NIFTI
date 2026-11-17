"""Read cached artifacts; verify additive ingestion and SQLite reopen. Never calls services."""
import argparse
import copy
import hashlib
import json
from pathlib import Path
import sqlite3
import sys
import tempfile
sys.path.insert(0, str(Path(__file__).resolve().parents[2]/'monai-label'))
from monailabel.utils.others import annotation_domain as domain
from monailabel.utils.others.report_extraction import import_result
from monailabel.utils.others.case_v2_contract.case_contract import digest


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--source',type=Path,required=True)
    p.add_argument('--legacy',type=Path,required=True)
    p.add_argument('--v2',type=Path,required=True)
    p.add_argument('--output',type=Path,required=True)
    a=p.parse_args()
    if a.output.exists(): raise ValueError('Output already exists')
    sources={s['name']:s for s in json.loads(a.source.read_text())['volumes']}
    unique={}; rows=[]
    with tempfile.TemporaryDirectory() as tmp:
        path=Path(tmp)/'isolated.sqlite3'
        for file in sorted(a.v2.glob('*.json')):
            v2=json.loads(file.read_text());s=sources[v2['volumeName']]
            legacy=json.loads((a.legacy/file.name).read_text())
            c={'caseId':file.stem,'sourceId':None,'revision':1,'reports':[],'evidence':[], 'findings':[], 'entities':[], 'links':[]}
            import_result(c,{'reportSource':s,'result':legacy,'runId':'legacy-cache'},file.stem)
            if c['findings']:
                c['findings'][0].update(text='Synthetic human edit for preservation test',category=None)
                c['entities']=[{'id':'human-entity','maskId':'existing-mask-reference'}]
                c['links']=[{'id':str(i),'findingId':f['id'],'entityId':'human-entity'} for i,f in enumerate(c['findings'][:2])]
            before=copy.deepcopy(c)
            payload={'operation':'reportExtraction','expectedCaseRevision':1,'reportSource':s,'result':v2,'runId':'reviewed-v2'}
            with sqlite3.connect(path) as db:
                domain.schema(db)
                db.execute('INSERT INTO annotation_cases VALUES (?,?,?,?,?)',(c['caseId'],None,'isolated',file.stem,json.dumps(c)))
                reply=domain.mutation(db,c['caseId'],'import',payload)['data']
            with sqlite3.connect(path) as db:
                reopened=domain.read(db,c['caseId']);assert reopened==reply
                payload['expectedCaseRevision']=reopened['revision']
                duplicate=domain.mutation(db,c['caseId'],'duplicate',payload)['data']
                assert duplicate==reopened
            for key in ('findings','entities','links','reportExtraction','reports'):
                assert reopened[key]==before[key],key
            x=reopened['caseV2Extraction'];assert x['sourcePayload']==v2
            mapping=x['sourceIdMap']['observations']
            linked={fid for m in mapping.values() for fid in m['findingIds']}
            assert linked=={f['id'] for f in c['findings']}
            evidence={e['id']:e for e in v2['evidence']}
            order=[(('findings','impressions').index(evidence[o['source']['sentenceEvidenceId']]['section']),evidence[o['source']['sentenceEvidenceId']]['start'],evidence[o['source']['sentenceEvidenceId']]['end']) for o in x['observations']]
            assert order==sorted(order)
            report_hash=digest(v2['reports'])
            unique.setdefault(report_hash,{'observations':len(v2['observations']),'groups':len(v2.get('temporalGroups',[]))})
            rows.append({'caseId':file.stem,'artifactSha256':hashlib.sha256(file.read_bytes()).hexdigest(),'mappedFindings':len(linked)})
    summary={'volumes':len(rows),'uniqueReports':len(unique),'observations':sum(u['observations'] for u in unique.values()),'temporalGroups':sum(u['groups'] for u in unique.values()),'sourceSha256':hashlib.sha256(a.source.read_bytes()).hexdigest(),'modelCalls':0,'onlineWrites':0,'sqliteReopen':True,'existingObjectsPreserved':True,'rows':rows}
    a.output.write_text(json.dumps(summary,indent=2)+'\n')
    print(json.dumps({k:v for k,v in summary.items() if k!='rows'}))

if __name__=='__main__':main()
