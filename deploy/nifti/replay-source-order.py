"""Replay cached model responses; never call a model or overwrite prior artifacts."""
import argparse, copy, hashlib, json, sys
from pathlib import Path

def main():
    p=argparse.ArgumentParser();p.add_argument('--input',type=Path,required=True);p.add_argument('--output',type=Path,required=True);a=p.parse_args()
    sys.path.insert(0,str(Path(__file__).parent/'pipeline'))
    import extract_report_lesions as extractor
    class NoIndex:
        def safe_match(self,*args,**kwargs):return None
    source=json.loads((a.input/'source.json').read_text());volumes={v['name']:v for v in source['volumes']}
    a.output.mkdir(parents=True,exist_ok=False);(a.output/'cases').mkdir()
    (a.output/'source.json').write_text(json.dumps(source,ensure_ascii=False,indent=2)+'\n')
    changed=[];seen=set();total=0
    def canonical(result):
        r=copy.deepcopy(result)
        for k in ['processingVersion','orderingPolicy']:r.pop(k,None)
        for k,idkey in [('mentions','mentionId'),('lesions','sourceFindingId')]:r[k].sort(key=lambda x:x[idkey])
        return r
    for path in sorted((a.input/'cases').glob('*.json')):
        old=json.loads(path.read_text());volume=volumes[old['volumeName']]
        raw=json.loads((a.input/'raw'/(old['sharedReportHash']+'.json')).read_text())['response']
        fresh=extractor.build_result(volume,raw,NoIndex(),model_name=old['modelName'])
        for k in ['terminologyMapping','sharedReportHash','reportStatements']:
            if k in old:fresh[k]=old[k]
        assert canonical(old)==canonical(fresh), 'Unexpected semantic change: '+path.name
        def position(item):
            s=item['sourceReportSpan'];return (['findings','impressions'].index(s['reportSection']),s['start'],s['end'])
        for k in ['mentions','lesions']:assert [position(x) for x in fresh[k]]==sorted(position(x) for x in fresh[k])
        if old['lesions']!=fresh['lesions']:changed.append(old['volumeName'])
        seen.add(old['sharedReportHash']);total+=1
        (a.output/'cases'/path.name).write_text(json.dumps(fresh,ensure_ascii=False,indent=2)+'\n')
    receipt={'volumes':total,'uniqueReports':len(seen),'findingOrderChangedVolumes':changed,'semanticEqualityIgnoringOrderAndVersion':True,'modelCalls':0,'processingVersion':extractor.PROCESSING_VERSION,'pipelineSHA256':hashlib.sha256(Path(extractor.__file__).read_bytes()).hexdigest()}
    (a.output/'replay-receipt.json').write_text(json.dumps(receipt,indent=2)+'\n');print(json.dumps(receipt))
if __name__=='__main__':main()
