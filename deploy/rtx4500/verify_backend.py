import io
import json
import tempfile
import time
from pathlib import Path

import nibabel as nib
import numpy as np
import requests

base = 'http://127.0.0.1:8002/nifti-images'
def checked(response):
    response.raise_for_status()
    return response

def stored_body(response):
    if response.content:
        return response.content
    redirect = response.headers['X-Accel-Redirect']
    for prefix, directory in [('/_nifti-files/', '/code/nifti_images/'), ('/_nifti-stream-cache/', '/code/nifti_stream_cache/')]:
        if redirect.startswith(prefix):
            return Path(directory + redirect[len(prefix):]).read_bytes()
    raise AssertionError(redirect)

with tempfile.TemporaryDirectory() as directory:
    path = Path(directory)/'DEPLOYMENT-TEST-phantom.nii.gz'
    data = np.zeros((32,32,16), dtype=np.int16)
    data[8:24,8:24,4:12] = 100
    image = nib.Nifti1Image(data, np.diag([1.2,1.2,2,1]))
    image.header.set_xyzt_units('mm')
    nib.save(image,path)
    with path.open('rb') as stream:
        source = checked(requests.post(base, files={'file':(path.name,stream)},data={'modality':'CT'},timeout=60)).json()
    source_id = source['sourceId']
    mask = np.zeros((16,32,32),dtype=np.uint8)
    mask[6:10,12:20,12:20] = 1
    fields = {'raw':'true','geometryHash':source['geometryHash'],'label':'DEPLOYMENT-TEST mask'}
    first = checked(requests.post(base+'/'+source_id+'/masks', files={'file':('mask.raw',mask.tobytes())},data=fields,timeout=60)).json()['items'][0]
    mask[5:11,11:21,11:21] = 1
    fields.update(maskId=first['maskId'],expectedVersion='1')
    second = checked(requests.post(base+'/'+source_id+'/masks', files={'file':('mask.raw',mask.tobytes())},data=fields,timeout=60)).json()['items'][0]
    assert second['version'] == 2
    history = checked(requests.get(base+'/'+source_id+'/masks/history',params={'maskId':first['maskId']},timeout=30)).json()
    assert history['total']==2
    restored = stored_body(checked(requests.get(base+'/'+source_id+'/masks/'+first['maskId'],timeout=30)))
    assert len(restored)>0
    stream = checked(requests.post(base+'/'+source_id+'/stream/prepare',timeout=60))
    for _ in range(30):
        state = checked(requests.get(base+'/'+source_id+'/stream',timeout=30)).json()
        if state.get('status') == 'ready':
            break
        time.sleep(1)
    frame = checked(requests.get(base+'/'+source_id+'/frames/8',timeout=60))
    frame_data = stored_body(frame)
    assert frame_data
    result = {'passed':True,'sourceId':source_id,'maskId':first['maskId'],'versions':history['total'],'frameBytes':len(frame_data)}
    Path('/code/nifti_images/deployment-verification.json').write_text(json.dumps(result,indent=2))
    print(json.dumps(result),flush=True)
