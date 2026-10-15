import json
import os
import tempfile
import unittest
from unittest.mock import patch
from fastapi import FastAPI
from fastapi.testclient import TestClient
from monailabel.endpoints import annotation, nifti_images
from monailabel.endpoints.annotation_datasets import schema

class DatasetTests(unittest.TestCase):
    def test_membership_filter_progress_conflict_atomicity(self):
        with tempfile.TemporaryDirectory() as root, patch.dict(os.environ, {'NIFTI_IMAGES_DIR': root, 'ENABLE_NIFTI_LIBRARY': 'true', 'ENABLE_NIFTI_EDITING': 'true'}):
            app = FastAPI(); app.include_router(annotation.router)
            with nifti_images.database() as db:
                schema(db)
                for i in range(3):
                    c = {'caseId': str(i), 'name': 'case-' + str(i), 'sourceId': None, 'worklistId': 'manifest-m', 'revision': 2, 'completedRevision': 2 if i == 1 else None, 'reports': [], 'findings': [], 'entities': []}
                    db.execute('INSERT INTO annotation_cases VALUES (?,?,?,?,?)', (str(i), None, 'manifest-m', 'volume-' + str(i), json.dumps(c)))
            with TestClient(app) as client:
                root = '/api/annotation/v1/datasets'
                value = {'id':'rexgroundingct','name':'ReXGroundingCT','version':'dataset.json:sha'}
                self.assertEqual(client.post(root, json=value).status_code,200)
                self.assertEqual(client.post(root, json=value).status_code,200)
                self.assertEqual(client.post(root, json={**value,'version':'other'}).status_code,409)
                members = root + '/rexgroundingct/members'
                body = {'items':[{'caseId':'0','split':'train'},{'caseId':'1','split':'val'}]}
                self.assertEqual(client.post(members,json=body).status_code,200)
                self.assertEqual(client.post(members,json=body).status_code,200)
                self.assertEqual(client.post(members,json={'items':[{'caseId':'2','split':'train'},{'caseId':'0','split':'val'}]}).status_code,409)
                cases=root+'/rexgroundingct/cases'
                all_rows=client.get(cases).json();self.assertEqual(all_rows['totalCases'],2);self.assertEqual(all_rows['completionPercent'],50)
                val=client.get(cases+'?split=val').json();self.assertEqual(val['totalCases'],1);self.assertEqual(val['items'][0]['caseId'],'1');self.assertEqual(val['completionPercent'],100)
                self.assertEqual(client.get(cases+'?split=train&search=case-1').json()['totalCases'],0)
                self.assertEqual(client.get(cases+'?offset=1&limit=1').json()['items'][0]['caseId'],'1')
                self.assertEqual(client.get(cases+'?split=typo').status_code,422)
                self.assertEqual(len(client.get(root).json()['items']),1)
                with nifti_images.database() as db:
                    self.assertEqual(json.loads(db.execute('SELECT metadata FROM annotation_cases WHERE id="0"').fetchone()[0])['revision'],2)

if __name__ == '__main__': unittest.main()
