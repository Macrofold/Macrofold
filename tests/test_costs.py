"""Offline arithmetic checks; no account, SDK, credential or network access."""
import copy, importlib.util, json, unittest
from pathlib import Path
from decimal import Decimal as D
ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('costs', ROOT/'scripts/estimate-costs.py')
costs=importlib.util.module_from_spec(spec);spec.loader.exec_module(costs)
class Costs(unittest.TestCase):
    def setUp(self):self.s=json.loads((ROOT/'docs/cost-inputs.json').read_text())
    def test_byok_has_no_platform_model_cost(self):
        self.s['per_run']['byok_fraction']=1
        result=costs.estimate(self.s,'base')
        self.assertEqual(D(result['vendor_cost_per_attempt_usd']['managed_model']),0)
        self.assertGreater(D(result['byok_model_cost_paid_directly_by_users_usd']),0)
    def test_token_subsets_and_credit_cap(self):
        base=costs.estimate(self.s,'base')
        self.assertEqual(D(base['vendor_cost_per_attempt_usd']['managed_model']),D('.12'))
        self.s['monthly']['confirmed_eligible_credit_usd']=1000000
        result=costs.estimate(self.s,'base')
        self.assertEqual(D(result['net_vendor_cost_usd']),0)
        self.assertEqual(result['eligible_credit_applied_usd'],result['gross_vendor_cost_usd'])
    def test_volume_and_memory_rounding(self):
        self.s['per_run']['seconds']=61
        r=costs.estimate(self.s,'base');per=r['vendor_cost_per_attempt_usd']
        self.assertEqual(D(per['sandbox_memory']),D(120)*4/3600*D('.0212'))
        self.s['monthly']['runs']*=2
        doubled=costs.estimate(self.s,'base')
        self.assertEqual(D(doubled['variable_vendor_cost_usd']),2*D(r['variable_vendor_cost_usd']))
        self.s['monthly']['runs']=0
        self.assertEqual(D(costs.estimate(self.s,'base')['variable_vendor_cost_usd']),0)
if __name__=='__main__':unittest.main()
