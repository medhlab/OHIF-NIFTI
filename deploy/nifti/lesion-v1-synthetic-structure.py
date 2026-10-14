import nibabel as nib,numpy as np,json
p='/datasets/ct-rate/valid_fixed/valid_1/valid_1_a/valid_1_a_2.nii.gz'
s=nib.load(p)
a=np.zeros(s.shape,dtype=np.uint8)
a[205:225,240:260,249:254]=1
a[295:315,240:260,249:254]=2
nib.save(nib.Nifti1Image(a,s.affine),'/output/synthetic-structure-acceptance.nii.gz')
print(json.dumps({'shape':s.shape,'labelCounts':{str(i):int((a==i).sum()) for i in (1,2)},'synthetic':True}))
