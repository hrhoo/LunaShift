"""Regression tests for redesigned workspace behavior and persistence."""
import copy
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from lunashift.core import repair
from lunashift.data import demo_project, validate_project, validate_ui_state, project_summary
from run import Workspace

class WorkspaceV2Tests(unittest.TestCase):
    def test_autosave_survives_new_workspace(self):
        with tempfile.TemporaryDirectory() as folder:
            path=Path(folder)/'workspace.json'
            ws=Workspace(path)
            p=ws.snapshot();p['name']='My saved test'
            ws.replace(p)
            ws.save_ui({'selected_site_id':'C','fields':{'maxDark':'18','duration':'48','slopeCheck':False}})
            restored=Workspace(path)
            self.assertEqual(restored.snapshot()['name'],'My saved test')
            self.assertEqual(restored.snapshot()['ui_state']['selected_site_id'],'C')
            self.assertEqual(restored.snapshot()['ui_state']['fields']['duration'],'48')
            self.assertTrue(restored.storage_info()['persistent'])
    def test_colab_storage_is_explicitly_temporary(self):
        with tempfile.TemporaryDirectory() as folder:
            ws=Workspace(Path(folder)/'x.json',ephemeral=True)
            self.assertFalse(ws.storage_info()['persistent'])
            self.assertTrue(ws.storage_info()['temporary_runtime'])
    def test_no_autosave_is_in_memory(self):
        self.assertFalse(Workspace().storage_info()['autosave_enabled'])
    def test_corrupt_autosave_is_not_overwritten(self):
        with tempfile.TemporaryDirectory() as folder:
            path=Path(folder)/'bad.json';path.write_text('not json')
            ws=Workspace(path)
            self.assertIsNotNone(ws.warning)
            ws.save_ui({'fields':{'maxDark':'9'}})
            self.assertEqual(path.read_text(),'not json')
    def test_invalid_import_does_not_change_saved_file(self):
        with tempfile.TemporaryDirectory() as folder:
            path=Path(folder)/'state.json';ws=Workspace(path)
            ws.replace(demo_project());before=path.read_text()
            with self.assertRaises(ValueError):ws.replace({'schema_version':999})
            self.assertEqual(path.read_text(),before)
    def test_failed_disk_write_leaves_memory_unchanged(self):
        with tempfile.TemporaryDirectory() as folder:
            ws=Workspace(Path(folder)/'state.json')
            before=ws.snapshot();after=copy.deepcopy(before);after['name']='Changed'
            with patch('pathlib.Path.write_text',side_effect=OSError('test failure')):
                with self.assertRaises(OSError):ws.replace(after)
            self.assertEqual(ws.snapshot()['name'],before['name'])
    def test_ui_settings_round_trip_in_project_summary(self):
        p=demo_project();p['ui_state']={'selected_site_id':'B','fields':{'height':'4'}}
        self.assertEqual(project_summary(validate_project(p))['ui_state'],p['ui_state'])
    def test_ui_state_rejects_nested_objects(self):
        with self.assertRaises(ValueError):validate_ui_state({'fields':{'height':{}}},demo_project()['sites'])
    def test_ui_state_rejects_oversize_string(self):
        with self.assertRaises(ValueError):validate_ui_state({'fields':{'start':'x'*1000}},demo_project()['sites'])
    def test_ui_state_ignores_unknown_properties(self):
        r=validate_ui_state({'selected_site_id':'bad','fields':{'unexpected':'x','duration':'120'}},demo_project()['sites'])
        self.assertNotIn('unexpected',r['fields']);self.assertEqual(r['selected_site_id'],'A')
    def test_v1_project_remains_compatible(self):
        p=demo_project();self.assertNotIn('ui_state',p)
        self.assertEqual(validate_project(p)['schema_version'],1)

class SearchV2Tests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):cls.project=demo_project()
    def test_no_relocation_keeps_selected_site(self):
        r=repair(self.project,{'preferred_site_id':'A','allow_relocation':False})
        self.assertEqual(r['tested_combinations'],7*3)
        self.assertTrue(all(x['site_id']=='A' for x in r['envelope']))
        self.assertTrue(all(x['site_id']=='A' for x in r['alternatives']))
    def test_no_changes_tests_one_combination(self):
        r=repair(self.project,{'preferred_site_id':'A','allow_relocation':False,'max_delay_h':0,'max_height_m':2})
        self.assertEqual(r['tested_combinations'],1)
        self.assertIsNone(r['best'])
    def test_upper_delay_endpoint_is_included(self):
        r=repair(self.project,{'preferred_site_id':'A','max_delay_h':14,'delay_step_h':12,'max_height_m':2})
        self.assertEqual(r['delays_h'],[0,12,14])
    def test_missing_data_is_not_a_pass(self):
        p=copy.deepcopy(self.project);p['sites'][0]['terrain']=None
        r=repair(p,{'preferred_site_id':'A','allow_relocation':False,'max_delay_h':0,'max_height_m':2})
        self.assertEqual(r['missing_combinations'],1)
        self.assertIsNone(r['best']);self.assertEqual(r['envelope'][0]['status'],'unknown')


class ProvenanceV2Tests(unittest.TestCase):
    def test_synthetic_slope_survives_import_and_analysis(self):
        from lunashift.data import apply_csv
        from lunashift.core import analyze
        p=apply_csv(demo_project(),'B','attributes','site_id,slope_deg\nB,10\n','Synthetic test',{'synthetic':True})
        self.assertTrue(project_summary(p)['sites'][1]['slope_synthetic'])
        self.assertTrue(analyze(p,{})['results'][1]['synthetic_slope'])
    def test_real_slope_import_retains_its_source(self):
        from lunashift.data import apply_csv
        p=apply_csv(demo_project(),'B','attributes','site_id,slope_deg\nB,10\n','Example declared external source',{'synthetic':False})
        self.assertFalse(p['sites'][1]['slope_synthetic'])
        self.assertEqual(p['sites'][1]['slope_source'],'Example declared external source')

if __name__=='__main__':unittest.main()
