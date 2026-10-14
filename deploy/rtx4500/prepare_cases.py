import csv
import gzip
import html
import json
import re
import struct
from pathlib import Path

root = Path('/media/ant/新加卷1/ct-rate-v2/dataset')
output = Path('/home/ant/projects/OHIF-NIFTI/deployment/manifests')
output.mkdir(exist_ok=True)
cases = []
for row in csv.DictReader((root / 'radiology_text_reports/validation_reports.csv').open()):
    stem = row['VolumeName'].removesuffix('.nii.gz')
    parts = stem.split('_')
    relative = Path('valid_fixed') / '_'.join(parts[:2]) / '_'.join(parts[:3]) / row['VolumeName']
    path = root / relative
    if not path.is_file():
        continue
    with gzip.open(path, 'rb') as stream:
        header = stream.read(348)
    endian = '<' if struct.unpack('<i', header[:4])[0] == 348 else '>'
    dims = struct.unpack(endian+'8h', header[40:56])
    count = dims[1]*dims[2]*dims[3]
    if count*4 > 512*1024**2:
        continue
    statements = []
    for section, column in [('Findings', 'Findings_EN'), ('Impressions', 'Impressions_EN')]:
        text = row.get(column, '')
        for i, sentence in enumerate(re.split(r'(?<=[.!?])\s+|\n+', text)):
            if sentence.strip():
                statements.append({'id': f'{stem}-{section}-{i}', 'section': section, 'text': sentence.strip()})
    cases.append({'caseId': stem, 'name': 'CT-RATE '+stem, 'image': '/datasets/ct-rate/'+relative.as_posix(), 'modality': 'CT', 'segmentations': [], 'reports': [{'id': stem+'-report', 'name': 'CT-RATE original report', 'statements': statements}], 'findings': []})
    if len(cases) == 25:
        break
assert cases
(output/'ct-rate-validation-25.json').write_text(json.dumps({'cases': cases}, ensure_ascii=False, indent=2))
(output/'index.html').write_text('<!doctype html><meta charset="utf-8"><title>CT-RATE cases</title><h1>CT-RATE 病例清单</h1><p><a download href="ct-rate-validation-25.json">下载 25 例验证集及原文报告 JSON</a></p><p>在 OHIF 的 NIfTI 页面选择“导入病例清单”，导入此文件。</p><p><a href="/nifti">进入标注工作台</a></p>')
print(json.dumps({'cases': len(cases), 'first': cases[0]['caseId'], 'manifest': str(output/'ct-rate-validation-25.json')}))
