#!/usr/bin/env python3
"""Offline planning arithmetic. This never reads credentials or contacts a provider.

Vendor costs and retail usage value are distinct. Retail usage is not cash revenue:
subscription inclusion, refunds, credit timing, taxes and debt affect actual revenue.
"""
import argparse, csv, json, sys
from decimal import Decimal as D, ROUND_CEILING
from pathlib import Path

def dec(value):
    return D(str(value))

def estimate(spec, case):
    p=spec['per_run']; m=spec['monthly']; rates=spec['vendor_rates']; c=spec['cases'][case]
    runs=dec(m['runs']); duration=dec(p['seconds'])*dec(c['duration_multiplier'])
    attempts=D(1)+dec(c['additional_attempt_ratio'])
    cpu=min(D(1),dec(p['cpu_utilization'])*dec(c['cpu_multiplier']))
    billed_seconds=(duration/D(60)).to_integral_value(rounding=ROUND_CEILING)*60
    managed=1-dec(p['byok_fraction'])
    model=sum(dec(token['count'])*dec(token['usd_per_million'])/1000000 for token in p['token_categories'])
    per={
        'sandbox_active_cpu':duration*dec(p['vcpus'])*cpu/3600*dec(rates['cpu_per_active_vcpu_hour']),
        'sandbox_memory':billed_seconds*dec(p['memory_gb'])/3600*dec(rates['memory_per_gb_hour']),
        'sandbox_creation':dec(rates['sandbox_creation']),
        'managed_model':model*managed,
        'search':dec(p['searches'])*dec(rates['search']),
        'connector_tools':dec(p['connector_calls'])*dec(rates['connector_call']),
        'workflow_events':dec(p['workflow_events'])*dec(rates['workflow_event']),
        'functions_queues_other':dec(p['other_control_plane_usd']),
        'sandbox_network':dec(p['sandbox_network_gb'])*dec(rates['sandbox_network_per_gb']),
    }
    variable=sum(per.values())*runs*attempts
    monthly={
        'r2_retained_storage':dec(m['r2_gb'])*dec(rates['r2_per_gb_month']),
        'r2_class_a':dec(m['r2_class_a'])*dec(rates['r2_class_a_per_million'])/1000000,
        'r2_class_b':dec(m['r2_class_b'])*dec(rates['r2_class_b_per_million'])/1000000,
        'snapshot_cache':dec(m['snapshot_gb'])*dec(rates['snapshot_per_gb_month']),
        'workflow_data_written':dec(m['workflow_written_gb'])*dec(rates['workflow_written_per_gb']),
        'workflow_data_retained':dec(m['workflow_retained_gb'])*dec(rates['workflow_retained_per_gb_month']),
        'maintenance_recovery':dec(m['maintenance_recovery_usd'])*dec(c['maintenance_multiplier']),
        'fixed_services':dec(m['fixed_services_usd'])*dec(c['fixed_multiplier']),
        'payment_fees':dec(m['payment_volume_usd'])*dec(m['payment_fee_fraction'])+dec(m['payment_transactions'])*dec(m['payment_fixed_fee_usd']),
    }
    gross=variable+sum(monthly.values())
    # Only an operator-confirmed eligible amount is subtracted; never subtract a plan credit twice.
    credit=min(dec(m['confirmed_eligible_credit_usd']),gross)
    retail=spec['retail']
    usage_value=(duration/60*dec(retail['sandbox_per_minute'])+model*managed*(1+dec(retail['managed_model_markup']))+dec(p['searches'])*dec(retail['search'])+dec(p['connector_calls'])*dec(retail['connector_call']))*runs*attempts
    usage_value+=dec(m['billable_storage_gib_month'])*dec(retail['storage_per_gib_month'])
    return {'case':case,'assumptions_date':spec['assumptions_date'],'runs':str(runs),'expected_attempts':str(runs*attempts),
        'vendor_cost_per_attempt_usd':{k:str(v) for k,v in per.items()},'variable_vendor_cost_usd':str(variable),
        'monthly_vendor_cost_usd':{k:str(v) for k,v in monthly.items()},'gross_vendor_cost_usd':str(gross),
        'eligible_credit_applied_usd':str(credit),'net_vendor_cost_usd':str(gross-credit),
        'retail_usage_value_usd':str(usage_value),'usage_contribution_before_fixed_costs_usd':str(usage_value-variable),
        'byok_model_cost_paid_directly_by_users_usd':str(model*(1-managed)*runs*attempts),
        'qualification':'Planning assumptions, not a quote, margin guarantee, invoice or cash-revenue forecast. Recovery overhead may exceed the scenario.'}

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--scenario',default=str(Path(__file__).resolve().parents[1]/'docs/cost-inputs.json'))
    parser.add_argument('--runs',type=int);parser.add_argument('--byok',type=D)
    parser.add_argument('--csv',action='store_true')
    args=parser.parse_args(); spec=json.loads(Path(args.scenario).read_text())
    if args.runs is not None:
        if args.runs<0:parser.error('--runs must be nonnegative')
        spec['monthly']['runs']=args.runs
    if args.byok is not None:
        if not 0<=args.byok<=1:parser.error('--byok must be between 0 and 1')
        spec['per_run']['byok_fraction']=str(args.byok)
    results=[estimate(spec,c) for c in spec['cases']]
    if args.csv:
        names=['case','runs','expected_attempts','variable_vendor_cost_usd','gross_vendor_cost_usd','eligible_credit_applied_usd','net_vendor_cost_usd','retail_usage_value_usd','byok_model_cost_paid_directly_by_users_usd']
        writer=csv.DictWriter(sys.stdout,fieldnames=names,extrasaction='ignore');writer.writeheader();writer.writerows(results)
    else:print(json.dumps(results,indent=2))
if __name__=='__main__':main()
