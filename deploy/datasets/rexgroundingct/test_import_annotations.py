"""CPU-only import tests against real annotation APIs with disposable storage."""
import gzip
import importlib.util
import json
import os
import struct
import tempfile
import unittest
import unittest.mock
from pathlib import Path

import numpy as np
from fastapi import FastAPI
from fastapi.testclient import TestClient
from monailabel.endpoints import annotation, nifti_images

spec = importlib.util.spec_from_file_location('rex_import', Path(__file__).with_name('import_annotations.py'))
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


def make_case(root):
    rex, ct = root / 'rex', root / 'ct'
    (rex / 'segmentations').mkdir(parents=True)
    name = 'train_1_a_1.nii.gz'
    image = ct / m.image_relative(name)
    image.parent.mkdir(parents=True)
    h = bytearray(352)
    struct.pack_into('<i', h, 0, 348)
    struct.pack_into('<8h', h, 40, 3, 3, 4, 5, 1, 1, 1, 1)
    struct.pack_into('<hh', h, 70, 2, 8)
    struct.pack_into('<8f', h, 76, 1, 1, 2, 3, 1, 1, 1, 1)
    struct.pack_into('<3f', h, 108, 352, 1, 0)
    h[123] = 2
    struct.pack_into('<h', h, 254, 1)
    struct.pack_into('<12f', h, 280, 1, 0, 0, 10, 0, 2, 0, -20, 0, 0, 3, 30)
    h[344:348] = b'n+1\0'
    image.write_bytes(gzip.compress(bytes(h) + np.arange(60, dtype=np.uint8).tobytes()))
    raw = np.zeros((60, 2), dtype=np.uint8)
    raw[2:5, :] = 1  # exact shared entity across Finding channels
    raw[20:22, 0] = 4  # non-contiguous labels must be preserved
    raw[30:34, 1] = 7
    struct.pack_into('<8h', h, 40, 4, 2, 3, 4, 5, 1, 1, 1)
    (rex / 'segmentations' / name).write_bytes(gzip.compress(bytes(h) + raw.tobytes()))
    record = {'name': name, 'shape': [3, 4, 5], 'findings': {'0': 'First 🙂 finding', '1': 'Second finding'},
              'categories': {'0': '2d', '1': '1f'}, 'pixels': {'0': 5, '1': 7},
              'entity_counts': {'0': 2, '1': 2}, 'protocol': 'protocol1'}
    (rex / 'dataset.json').write_text(json.dumps({'train': [record], 'val': []}))
    return rex, ct, raw


class Adapter:
    def __init__(self, client):
        self.client = client
        self.fail_once = False
        self.posts = 0

    def request(self, path, payload=None, key=None, file=None):
        headers = {'Idempotency-Key': key} if key else {}
        if file is not None:
            response = self.client.post(path, data=payload, files={'file': file}, headers=headers)
        elif payload is not None:
            response = self.client.post(path, json=payload, headers=headers)
        else:
            response = self.client.get(path, headers=headers)
        response.raise_for_status()
        if payload is not None:
            self.posts += 1
        if self.fail_once and payload and payload.get('operation') == 'finding':
            self.fail_once = False
            raise ConnectionError('Simulated response loss after commit')
        return response.json()


class ImportTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.rex, self.ct, self.raw = make_case(self.root)
        reports = self.ct / 'radiology_text_reports'
        reports.mkdir()
        with (reports / 'train_reports.csv').open('w', newline='') as stream:
            writer = m.csv.DictWriter(stream, fieldnames=['VolumeName', 'Findings_EN', 'Impressions_EN'])
            writer.writeheader()
            writer.writerow({'VolumeName': 'train_1_a_1.nii.gz', 'Findings_EN': ' Original report. ',
                             'Impressions_EN': 'Original impression.'})
        self.output = self.root / 'prepared'
        self.inventory = m.plan(self.rex, self.ct, 'dataset.json', ['train', 'val'])

    def tearDown(self):
        self.temp.cleanup()

    def prepare(self):
        folder = self.output / 'cases' / 'train_1_a_1'
        case = m.prepare_case(self.inventory['items'][0], folder)
        m.dump(self.output / 'package.json', {'release': 'dataset.json', 'releaseSha256': self.inventory['releaseSha256'],
            'cases': [{'caseFile': 'cases/train_1_a_1/case.json', 'sha256': m.file_hash(folder / 'case.json')}]})
        return case, folder

    def test_split_labels_grid_and_shared_entity(self):
        case, folder = self.prepare()
        self.assertEqual(len(case['entities']), 3)
        self.assertEqual(case['findings'][0]['entityKeys'][0], case['findings'][1]['entityKeys'][0])
        for e in case['entities']:
            data = np.frombuffer(gzip.decompress((folder / e['maskFile']).read_bytes()), np.uint8)
            for origin in e['origins']:
                np.testing.assert_array_equal(data, self.raw[:, origin['findingIndex']] == origin['label'])
        self.assertEqual(case['geometryHash'], self.inventory['items'][0]['geometryHash'])

    def test_reader_rejects_wrong_grid_and_truncated_payload(self):
        item = self.inventory['items'][0]
        mask = Path(item['maskPath'])
        raw = gzip.decompress(mask.read_bytes())
        for bad in (raw[:-1], raw + b'x'):
            mask.write_bytes(gzip.compress(bad))
            with self.assertRaisesRegex(ValueError, 'payload|trailing'):
                m.prepare_case(item, self.output)
        mask.write_bytes(gzip.compress(raw))
        item['record']['shape'] = [4, 3, 5]
        with self.assertRaisesRegex(ValueError, 'dimensions differ'):
            m.prepare_case(item, self.output)

    def test_generic_reader_still_rejects_channel_first_4d(self):
        with self.assertRaises(ValueError):
            m.geometry.read_nifti(Path(self.inventory['items'][0]['maskPath']))

    def test_invalid_count_rejected(self):
        item = self.inventory['items'][0]
        item['record']['pixels']['0'] = 999
        with self.assertRaisesRegex(ValueError, 'voxel count'):
            m.prepare_case(item, self.output)

    def test_declared_entities_are_warning_not_label_range(self):
        self.inventory['items'][0]['record']['entity_counts']['0'] = 5
        case, _ = self.prepare()
        self.assertEqual(case['warnings'][0]['observedLabels'], [1, 4])

    def test_bad_category_and_missing_mask_block_plan(self):
        data = json.loads((self.rex / 'dataset.json').read_text())
        data['train'][0]['categories']['0'] = 'unknown'
        (self.rex / 'dataset.json').write_text(json.dumps(data))
        self.assertEqual(m.plan(self.rex, self.ct, 'dataset.json', ['train'])['summary']['blockedCases'], 1)

    def test_real_api_resume_roundtrip_and_no_duplicate(self):
        prepared, folder = self.prepare()
        with unittest.mock.patch.dict(os.environ, {'NIFTI_IMAGES_DIR': str(self.root / 'state'),
                 'NIFTI_IMPORT_ROOTS': json.dumps([str(self.ct)]), 'ENABLE_NIFTI_LIBRARY': 'true', 'ENABLE_NIFTI_EDITING': 'true'}):
            app = FastAPI()
            app.include_router(nifti_images.router)
            app.include_router(annotation.router)
            with TestClient(app) as transport:
                client = Adapter(transport)
                client.fail_once = True
                with self.assertRaises(ConnectionError):
                    m.import_package(self.output, 'http://test', str(self.ct), client)
                result = m.import_package(self.output, 'http://test', str(self.ct), client)
                receipt = json.loads((self.output / 'receipt.json').read_text())
                cid = receipt['cases'][0]['caseId']
                context = client.request('/api/annotation/v1/cases/' + cid + '/context')['data']
                self.assertEqual((len(context['findings']), len(context['entities']), len(context['links'])), (2, 3, 4))
                self.assertIsNone(context['completedRevision'])
                self.assertEqual(len(context['reports']), 1)
                self.assertEqual(context['evidence'], [])
                self.assertTrue(all(not f['evidenceIds'] for f in context['findings']))
                self.assertEqual(context['reports'][0]['name'], 'CT-RATE original report')
                self.assertEqual(context['reports'][0]['sections'][0]['text'], ' Original report. ')
                for e in context['evidence']:
                    section = next(s['text'] for r in context['reports'] for s in r['sections'] if s['id'] == e['sectionId'])
                    self.assertEqual(section[e['start']:e['end']], e['quote'])
                source = context['sourceId']
                masks = client.request('/nifti-images/' + source + '/masks')['items']
                self.assertEqual({x['voxelHash'] for x in masks}, {x['key'] for x in prepared['entities']})
                for mask in masks:
                    response = transport.get(f"/nifti-images/{source}/masks/{mask['maskId']}")
                    out = self.root / (mask['maskId'] + '.nii.gz')
                    out.write_bytes(response.content)
                    meta, voxels = m.geometry.read_nifti(out, mask=True)
                    self.assertEqual(meta['geometryHash'], prepared['geometryHash'])
                    self.assertEqual(m.hashlib.sha256(voxels.astype(np.uint8).tobytes()).hexdigest(), mask['voxelHash'])
                prior_posts = client.posts
                self.assertEqual(m.import_package(self.output, 'http://test', str(self.ct), client), result)
                self.assertEqual(client.posts, prior_posts)
                (folder / prepared['entities'][0]['maskFile']).write_bytes(b'corrupt')
                with self.assertRaisesRegex(ValueError, 'mask changed'):
                    m.import_package(self.output, 'http://test', str(self.ct), client)

    def test_manifest_uncertain_outcome_is_not_repeated(self):
        journal = m.Journal(self.root / 'journal.json', 'one')
        class Failure:
            def request(self, *args):
                raise ConnectionError()
        with self.assertRaises(ConnectionError):
            journal.step(Failure(), 'manifest', '/manifest', {}, idempotent=False)
        with self.assertRaisesRegex(ValueError, 'Uncertain'):
            journal.step(Failure(), 'manifest', '/manifest', {}, idempotent=False)


if __name__ == '__main__':
    import unittest.mock
    unittest.main()
