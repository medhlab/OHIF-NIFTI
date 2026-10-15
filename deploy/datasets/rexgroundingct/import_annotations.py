"""ReXGroundingCT -> OHIF annotation/v1. Default: read-only header audit.

prepare writes binary gzip masks locally; import is explicit and uses a new worklist.
Run with the repository's numpy dependency. No model/GPU or database access.
"""
import argparse
import collections
import csv
import gzip
import hashlib
import importlib.util
import json
import re
import struct
import urllib.request
import uuid
from pathlib import Path, PurePosixPath


ROOT = Path(__file__).resolve().parents[3]
spec = importlib.util.spec_from_file_location('rex_native_geometry', ROOT / 'monai-label/monailabel/utils/others/nifti_source.py')
geometry = importlib.util.module_from_spec(spec)
spec.loader.exec_module(geometry)
spec = importlib.util.spec_from_file_location('native_rex', ROOT / 'monai-label/monailabel/utils/others/nifti_rexgroundingct.py')
rex_reader = importlib.util.module_from_spec(spec)
spec.loader.exec_module(rex_reader)
CODES = {f'1{x}' for x in 'abcdef'} | {f'2{x}' for x in 'abcdefgh'}


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=False).encode()).hexdigest()


def file_hash(path):
    h = hashlib.sha256()
    with Path(path).open('rb') as f:
        while chunk := f.read(4 * 1024 * 1024):
            h.update(chunk)
    return h.hexdigest()


def dump(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_suffix(path.suffix + '.tmp')
    temp.write_text(json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False) + '\n')
    temp.replace(path)


def header(path):
    with Path(path).open('rb') as f:
        zipped = f.read(2) == b'\x1f\x8b'
    with (gzip.open(path, 'rb') if zipped else Path(path).open('rb')) as f:
        return f.read(352)


def image_relative(name):
    if not re.fullmatch(r'(train|valid)_\d+_[a-z]+_\d+\.nii\.gz', name):
        raise ValueError('Unexpected CT name: ' + name)
    parts = name.removesuffix('.nii.gz').split('_')
    return Path(parts[0] + '_fixed') / '_'.join(parts[:2]) / '_'.join(parts[:3]) / name


def mask_header(raw, record):
    return rex_reader.validate_header(raw, record, record['shape'])


def plan(rex_root, ct_root, release, splits, names=(), limit=None):
    source = rex_root / release
    data = json.loads(source.read_text())
    originals = {}
    for csv_name in ('train_reports.csv', 'validation_reports.csv'):
        report_path = ct_root / 'radiology_text_reports' / csv_name
        if report_path.is_file():
            with report_path.open(newline='', encoding='utf-8-sig') as stream:
                for row in csv.DictReader(stream):
                    originals[row['VolumeName']] = {'file': csv_name, 'row': row}
    items, issues, seen = [], [], set()
    for split in splits:
        if split not in data:
            raise ValueError('Unknown split: ' + split)
        for record in data[split]:
            name = record['name']
            if names and name not in names:
                continue
            if name in seen:
                raise ValueError('Duplicate volume: ' + name)
            seen.add(name)
            if limit is not None and len(items) + len(issues) >= limit:
                continue
            try:
                relative = image_relative(name)
                ct, mask = ct_root / relative, rex_root / 'segmentations' / name
                if not ct.is_file() or not mask.is_file():
                    raise ValueError('CT or public segmentation missing')
                findings = record['findings']
                if not findings or set(findings) != {str(i) for i in range(len(findings))}:
                    raise ValueError('Finding indices must be contiguous zero-based channels')
                if set(record['categories']) != set(findings) or not set(record['categories'].values()) <= CODES:
                    raise ValueError('Categories differ from OHIF protocol')
                if any(not isinstance(t, str) or not t.strip() or len(t) > 10000 for t in findings.values()):
                    raise ValueError('Invalid Finding text')
                meta = geometry.parse_header(header(ct))
                if meta['dimensions'] != record['shape']:
                    raise ValueError('CT dimensions differ from annotation metadata')
                mask_header(header(mask), record)
                items.append({'name': name, 'split': split, 'record': record, 'ctPath': str(ct.resolve()),
                              'ctRelative': relative.as_posix(), 'maskPath': str(mask.resolve()),
                              'geometryHash': meta['geometryHash'], 'dimensions': meta['dimensions'],
                              'originalReport': originals.get(name)})
            except (ValueError, OSError, KeyError, struct.error) as e:
                issues.append({'name': name, 'split': split, 'reason': str(e)})
    missing_names = set(names) - seen
    if missing_names:
        raise ValueError('Requested names not in selected splits: ' + ', '.join(sorted(missing_names)))
    return {'schema': 'rex-ohif-import/v1', 'release': release, 'releaseSha256': file_hash(source),
            'splits': splits, 'items': items, 'issues': issues,
            'summary': {'eligibleCases': len(items), 'blockedCases': len(issues),
                        'findings': sum(len(x['record']['findings']) for x in items),
                        'payloadValidated': False}}


def prepare_case(item, directory):
    """Demultiplex x-fastest 4D bytes; inherit paired CT grid without resampling."""
    directory.mkdir(parents=True, exist_ok=True)
    record = item['record']
    meta, pixels = geometry.read_nifti(Path(item['ctPath']))
    del pixels
    if meta['geometryHash'] != item['geometryHash']:
        raise ValueError('CT changed after planning')
    converted = rex_reader.read_rexgroundingct(Path(item['maskPath']), record, meta, directory)
    result = {**item, 'contentHash': meta['contentHash'], 'sourceMaskSha256': file_hash(item['maskPath']), **converted}
    dump(directory / 'case.json', result)
    return result


class Client:
    def __init__(self, base):
        self.base = base.rstrip('/')

    def request(self, path, payload=None, key=None, file=None):
        headers = {}
        if key:
            headers['Idempotency-Key'] = key
        if file is not None:
            boundary = 'rex-' + uuid.uuid4().hex
            body = bytearray()
            for name, value in (payload or {}).items():
                body.extend(f'--{boundary}\r\nContent-Disposition: form-data; name="{name}"\r\n\r\n{value}\r\n'.encode())
            filename, data = file
            body.extend(f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="{filename}"\r\nContent-Type: application/octet-stream\r\n\r\n'.encode())
            body.extend(data)
            body.extend(f'\r\n--{boundary}--\r\n'.encode())
            headers['Content-Type'] = 'multipart/form-data; boundary=' + boundary
            body = bytes(body)
        else:
            body = json.dumps(payload, ensure_ascii=False).encode() if payload is not None else None
            headers['Content-Type'] = 'application/json'
        with urllib.request.urlopen(urllib.request.Request(self.base + path, data=body, headers=headers), timeout=600) as response:
            return json.load(response)


class Journal:
    """Persist exact requests before sending. Retry uncertain outcomes with the same key."""
    def __init__(self, path, identity):
        self.path = Path(path)
        self.data = json.loads(self.path.read_text()) if self.path.exists() else {'identity': identity, 'steps': {}}
        if self.data['identity'] != identity:
            raise ValueError('Journal belongs to a different package or server')
        dump(self.path, self.data)

    def step(self, client, name, path, payload, file=None, idempotent=True):
        record = self.data['steps'].get(name)
        if record and 'response' in record:
            return record['response']
        if record and not idempotent:
            raise ValueError('Uncertain non-idempotent manifest creation; recover manifestId into journal, do not repeat')
        if not record:
            record = {'path': path, 'payload': payload, 'key': 'rex-' + digest([self.data['identity'], name]),
                      'fileSha256': hashlib.sha256(file[1]).hexdigest() if file else None}
            self.data['steps'][name] = record
            dump(self.path, self.data)
        if record['path'] != path or record['fileSha256'] != (hashlib.sha256(file[1]).hexdigest() if file else None):
            raise ValueError('Pending request input changed')
        response = client.request(path, record['payload'], record['key'], file)
        record['response'] = response
        dump(self.path, self.data)
        return response


def import_package(package_dir, base_url, server_ct_root, client=None):
    package_dir = Path(package_dir)
    package = json.loads((package_dir / 'package.json').read_text())
    client = client or Client(base_url)
    if set(client.request('/api/annotation/v1/categories')['items']) != CODES:
        raise ValueError('Server category protocol differs')
    cases = []
    for row in package['cases']:
        p = package_dir / row['caseFile']
        if file_hash(p) != row['sha256']:
            raise ValueError('Prepared case changed')
        case = json.loads(p.read_text())
        for entity in case['entities']:
            if file_hash(p.parent / entity['maskFile']) != entity['fileSha256']:
                raise ValueError('Prepared mask changed')
        cases.append((case, p.parent))
    if not cases:
        raise ValueError('No prepared cases')
    identity = digest([package, base_url.rstrip('/'), server_ct_root])
    journal = Journal(package_dir / 'import-journal.json', identity)
    dataset_id = 'rexgroundingct' if package['release'] == 'dataset.json' else 'rexgroundingct-' + package['release'].removesuffix('.json').lower()
    journal.step(client, 'dataset', '/api/annotation/v1/datasets',
                 {'id': dataset_id, 'name': 'ReXGroundingCT', 'version': package['release'] + ':' + package['releaseSha256']})
    # Refuse duplicate batches before creating another worklist. Resuming this journal is allowed.
    existing = client.request('/api/annotation/v1/datasets/' + dataset_id + '/cases?limit=5000')['items']
    if 'manifest' not in journal.data['steps']:
        duplicates = {r['externalCaseId'] for r in existing} & {c['name'].removesuffix('.nii.gz') for c, _ in cases}
        if duplicates:
            raise ValueError('Cases already in dataset; exclude them from the new batch: ' + ', '.join(sorted(duplicates)))
    manifest_body = {'cases': [{'caseId': c['name'].removesuffix('.nii.gz'), 'name': c['name'], 'modality': 'CT',
                      'image': str(PurePosixPath(server_ct_root) / c['ctRelative'])} for c, _ in cases]}
    manifest = journal.step(client, 'manifest', '/nifti-images/manifest/preview', {'modality': 'CT'},
                            ('rexgroundingct.json', json.dumps(manifest_body).encode()), idempotent=False)
    if any(x['status'] != 'ready' for x in manifest['items']):
        raise ValueError('Server cannot read one or more CT paths; no annotations imported')
    worklist = journal.step(client, 'worklist', '/api/annotation/v1/worklists', {'manifestId': manifest['id']})
    ids = {x['externalCaseId']: x['caseId'] for x in worklist['items']}
    receipts = []
    for case, folder in cases:
        external = case['name'].removesuffix('.nii.gz')
        cid = ids[external]
        journal.step(client, external + '/dataset-member', '/api/annotation/v1/datasets/' + dataset_id + '/members',
                     {'items': [{'caseId': cid, 'split': case['split']}]})
        prefix = '/api/annotation/v1/cases/' + cid
        opened = journal.step(client, external + '/open', '/nifti-images/manifest/open',
                              {'manifestId': manifest['id'], 'caseId': external})
        source = opened['descriptor']
        if opened.get('errors') or source['geometryHash'] != case['geometryHash'] or source['contentHash'] != case['contentHash']:
            raise ValueError('Server CT content/grid differs from validated CT: ' + external)
        journal.step(client, external + '/register', '/api/annotation/v1/cases', {'sourceId': source['sourceId'], 'caseId': cid})
        def op(step, operation, **payload):
            current = client.request(prefix + '/context')['data']
            return journal.step(client, external + '/' + step, prefix + '/operations',
                                {'operation': operation, 'expectedCaseRevision': current['revision'], **payload})['data']
        original = case.get('originalReport')
        if original:
            fields = [('ClinicalInformation_EN', 'Clinical Information'), ('Technique_EN', 'Technique'),
                      ('Findings_EN', 'Findings'), ('Impressions_EN', 'Impressions')]
            sections = [{'name': label, 'text': original['row'][field]} for field, label in fields
                        if original['row'].get(field, '').strip()]
            if sections:
                op('original-report', 'report', name='CT-RATE original report', sections=sections)
        # ReX descriptions remain Findings, never a synthetic clinical report.
        # Evidence is absent until a real original-report span has been verified.
        fids = {}
        for finding in case['findings']:
            response = op('finding/' + str(finding['index']), 'finding', text=finding['text'],
                          category=finding['category'])
            fids[finding['index']] = response['findings'][-1]['id']
        for entity in case['entities']:
            key = entity['key']
            fid_list = list(dict.fromkeys(fids[o['findingIndex']] for o in entity['origins']))
            entity_name = 'ReX ' + ','.join(f"F{o['findingIndex'] + 1}/L{o['label']}" for o in entity['origins'])
            created = op('entity/' + key, 'entity', name=entity_name[:200], findingIds=fid_list)['entities'][-1]
            current = client.request(prefix + '/context')['data']
            provenance = {'dataset': 'ReXGroundingCT', 'release': package['release'], 'releaseSha256': package['releaseSha256'],
                          'protocol': case['record'].get('protocol'), 'sourceMaskSha256': case['sourceMaskSha256'],
                          'sourceOrigins': entity['origins'], 'originalLabel': entity['origins'][0]['label'],
                          'originalFile': case['name'], 'voxelHash': key,
                          'segmentationSet': {'id': digest([identity, external])[:32], 'name': 'ReXGroundingCT · 原始标注',
                                              'kind': 'import', 'sourceFile': case['name']}}
            result = journal.step(client, external + '/mask/' + key, prefix + '/entities/' + created['id'] + '/mask-versions',
                                  {'expectedCaseRevision': current['revision'], 'expectedMaskVersion': 0,
                                   'geometryHash': source['geometryHash'], 'label': entity_name[:200],
                                   'provenance': json.dumps(provenance)},
                                  ('mask.bin.gz', (folder / entity['maskFile']).read_bytes()))
            saved = result['items'][0]
            if saved['voxelHash'] != key or saved['voxelCount'] != entity['voxelCount']:
                raise ValueError('Saved mask verification failed')
        receipts.append({'name': case['name'], 'caseId': cid, 'findings': len(case['findings']), 'entities': len(case['entities'])})
        dump(package_dir / 'receipt.json', {'manifestId': manifest['id'], 'worklistId': worklist['worklistId'], 'cases': receipts})
    return {'manifestId': manifest['id'], 'cases': len(receipts)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('mode', choices=['plan', 'prepare', 'import'])
    parser.add_argument('--rex-root', type=Path, default=Path('/data/cache/datasets/ReXGroundingCT'))
    parser.add_argument('--ct-root', type=Path, default=Path('/data/cache/datasets/CT-RATE/dataset'))
    parser.add_argument('--release', choices=['dataset.json', 'MICCAI_challenge_dataset.json', 'MLHC_dataset_version.json'], default='dataset.json')
    parser.add_argument('--splits', nargs='+', default=['train', 'val'])
    parser.add_argument('--case', action='append', default=[])
    parser.add_argument('--limit', type=int)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--base-url')
    parser.add_argument('--server-ct-root', default='/datasets/ct-rate')
    args = parser.parse_args()
    if args.mode == 'import':
        if not args.base_url:
            parser.error('import requires --base-url')
        print(json.dumps(import_package(args.output, args.base_url, args.server_ct_root)))
        return
    inventory = plan(args.rex_root, args.ct_root, args.release, args.splits, args.case, args.limit)
    dump(args.output / 'plan.json', inventory)
    if args.mode == 'prepare':
        package = {'schema': 'rex-ohif-import/v1', 'release': inventory['release'],
                   'releaseSha256': inventory['releaseSha256'], 'cases': [], 'issues': list(inventory['issues'])}
        for item in inventory['items']:
            directory = args.output / 'cases' / item['name'].removesuffix('.nii.gz')
            try:
                prepare_case(item, directory)
                package['cases'].append({'caseFile': (directory / 'case.json').relative_to(args.output).as_posix(),
                                         'sha256': file_hash(directory / 'case.json')})
            except (ValueError, OSError) as e:
                package['issues'].append({'name': item['name'], 'reason': str(e)})
            dump(args.output / 'package.json', package)
            print(json.dumps({'prepared': len(package['cases']), 'blocked': len(package['issues'])}), flush=True)
        if not inventory['items']:
            dump(args.output / 'package.json', package)
    if args.mode == 'prepare':
        print(json.dumps({'preparedCases': len(package['cases']), 'blockedCases': len(package['issues']),
                          'preparedPayloadsValidated': True}))
    else:
        print(json.dumps(inventory['summary']))


if __name__ == '__main__':
    main()
