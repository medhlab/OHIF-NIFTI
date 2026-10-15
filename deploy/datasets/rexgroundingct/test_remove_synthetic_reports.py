import importlib.util
from pathlib import Path
import unittest

spec=importlib.util.spec_from_file_location('repair',Path(__file__).with_name('remove_synthetic_reports.py'))
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)

class RepairTests(unittest.TestCase):
    def test_preserves_original_report_mask_and_real_evidence(self):
        case={'reports':[{'id':'old','name':'ReXGroundingCT · 标注原文','sections':[{'name':'Annotated Findings','text':'finding'}]},
                         {'id':'real','name':'CT-RATE original report','sections':[{'text':'actual original'}]}],
              'findings':[{'id':'f','text':'finding','category':'2d','evidenceIds':['a','b']}],
              'evidence':[{'id':'a','reportId':'old'},{'id':'b','reportId':'real'}],
              'entities':[{'id':'e','maskId':'mask'}],'links':[{'findingId':'f','entityId':'e'}]}
        new,n=m.clean(case)
        self.assertEqual(n,1);self.assertEqual(new['reports'],case['reports'][1:])
        self.assertEqual(new['entities'],case['entities']);self.assertEqual(new['links'],case['links'])
        self.assertEqual(new['findings'][0]['evidenceIds'],['b']);self.assertEqual(len(case['reports']),2)
        self.assertEqual(m.clean(new),(new,0))
        case['reports'][0]['sections'][0]['text']='edited'
        with self.assertRaises(ValueError):m.clean(case)

if __name__=='__main__':unittest.main()
