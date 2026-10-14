"""Attach cached report results to a native manifest without LLM or image inference."""
import argparse
import hashlib
import json
import urllib.request
from pathlib import Path, PurePosixPath


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--base-url',required=True,help='Service root, e.g. http://localhost:1028/monai')
    p.add_argument('--data-dir',type=Path,required=True,help='pilot directory containing source.json and cases/')
    p.add_argument('--run-id',required=True)
    p.add_argument('--manifest-id')
    p.add_argument('--image-root',default='/datasets/ct-rate')
    p.add_argument('--output',type=Path,required=True)
    args=p.parse_args();base=args.base_url.rstrip('/')
    sources={s['name']:s for s in json.loads((args.data_dir/'source.json').read_text())['volumes']}
    records=[json.loads(f.read_text()) for f in sorted((args.data_dir/'cases').glob('*.json'))]
    if len({r['volumeName'] for r in records})!=len(records):raise ValueError('Duplicate volume identity')
    def request(path,body=None,key=None,ctype='application/json'):
        headers={'Content-Type':ctype}
        if key:headers['Idempotency-Key']=key
        data=json.dumps(body,ensure_ascii=False).encode() if isinstance(body,dict) else body
        r=urllib.request.Request(base+path,data=data,headers=headers)
        with urllib.request.urlopen(r,timeout=120) as reply:return json.load(reply)
    if args.manifest_id: manifest=request('/nifti-images/manifests/'+args.manifest_id)
    else:
        cases=[]
        for result in records:
            source=sources[result['volumeName']];parts=PurePosixPath(source['image_path']).parts
            if 'dataset' not in parts:raise ValueError('Input image_path must explicitly identify dataset root')
            relative=PurePosixPath(*parts[parts.index('dataset')+1:])
            if '..' in relative.parts or relative.is_absolute():raise ValueError('Invalid image path')
            cases.append({'caseId':result['volumeName'].removesuffix('.nii.gz'),'name':result['volumeName'].removesuffix('.nii.gz'),
                          'image':str(PurePosixPath(args.image_root)/relative),'modality':'CT'})
        boundary='report-result-import';raw=json.dumps({'cases':cases}).encode()
        multipart=(f'--{boundary}\r\nContent-Disposition: form-data; name="modality"\r\n\r\nCT\r\n--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="report-results.json"\r\nContent-Type: application/json\r\n\r\n'.encode()+raw+f'\r\n--{boundary}--\r\n'.encode())
        manifest=request('/nifti-images/manifest/preview',multipart,ctype='multipart/form-data; boundary='+boundary)
    invalid=[i for i in manifest['items'] if i['status']!='ready']
    if invalid:raise ValueError(f'{len(invalid)} CT paths unavailable; no report import performed')
    worklist=request('/api/annotation/v1/worklists',{'manifestId':manifest['id']})
    case_ids={r['externalCaseId']:r['caseId'] for r in worklist['items']};saved=[];seen=set();counts={}
    for result in records:
        key=result['volumeName'].removesuffix('.nii.gz')
        if key not in case_ids:raise ValueError('Result volume not in supplied manifest: '+key)
        cid=case_ids[key];source=sources[result['volumeName']]
        current=request(f'/api/annotation/v1/cases/{cid}/context')['data']
        digest=hashlib.sha256(json.dumps({'source':source,'result':result},ensure_ascii=False,sort_keys=True).encode()).hexdigest()
        prior=current.get('reportExtraction')
        if prior:
            if prior['runId']!=args.run_id or prior['inputSha256']!=digest:raise ValueError('Existing extraction differs; not overwritten: '+key)
        else:
            payload={'operation':'reportExtraction','expectedCaseRevision':current['revision'],'runId':args.run_id,'reportSource':source,'result':result}
            response=request(f'/api/annotation/v1/cases/{cid}/operations',payload,key='report-'+digest)
            prior=response['data']['reportExtraction']
        saved.append({'externalCaseId':key,'caseId':cid,'counts':prior['counts']})
        if result['sharedReportHash'] not in seen:
            seen.add(result['sharedReportHash'])
            for k,v in prior['counts'].items():counts[k]=counts.get(k,0)+v
    receipt={'manifestId':manifest['id'],'worklistId':worklist['worklistId'],'runId':args.run_id,'volumes':len(saved),
             'uniqueReports':len(seen),'uniqueReportCounts':counts,'items':saved,'passed':True}
    args.output.write_text(json.dumps(receipt,ensure_ascii=False,indent=2)+'\n');print(json.dumps({k:v for k,v in receipt.items() if k!='items'},ensure_ascii=False))


if __name__=='__main__':main()
