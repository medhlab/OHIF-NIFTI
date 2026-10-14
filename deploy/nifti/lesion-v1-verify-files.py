import sqlite3,json,hashlib,nibabel as nib,numpy as np
from pathlib import Path
root=Path('/code/nifti_images');sid='892591e030544bd3ad1d86cf83472600'
with sqlite3.connect(root/'index.sqlite3') as db:
 rows=db.execute('SELECT metadata FROM masks WHERE source=? ORDER BY id,version',(sid,)).fetchall()
results=[]
for (text,) in rows:
 m=json.loads(text);p=root/sid/'masks'/m['maskId']/str(m['version'])/'mask.nii.gz'
 sha=hashlib.sha256(p.read_bytes()).hexdigest();a=np.asanyarray(nib.load(p).dataobj).astype(np.uint8)
 # Native serialized vectors are x-fast (Fortran order for NIfTI xyz arrays).
 voxel=hashlib.sha256(a.tobytes(order='F')).hexdigest();count=int(np.count_nonzero(a))
 if m.get('fileSha256'):assert sha==m['fileSha256']
 if m.get('voxelHash'):assert voxel==m['voxelHash']
 if m.get('voxelCount') is not None:assert count==m['voxelCount']
 results.append({'maskId':m['maskId'],'version':m['version'],'fileSha256':sha,'voxelHash':voxel,'voxelCount':count,'anatomyReadOnly':m.get('anatomyReadOnly',False)})
print(json.dumps({'passed':True,'results':results},indent=2))
