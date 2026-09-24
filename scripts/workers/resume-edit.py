from pathlib import Path
import json
p=Path('docs/api/openapi.json'); spec=json.loads(p.read_text())
changed=[]
for name,schema in spec['components']['schemas'].items():
    properties=schema.get('properties',{})
    if name.endswith('RunAccepted') and 'worktree_id' in properties:
        properties['worker_id']={'type':['string','null'],'format':'uuid','description':'Explicit reusable compute target, independent of conversation and files.'}
        changed.append(name)
assert changed, 'Native accepted Run schema was not found'
candidates=[(path,op) for path,methods in spec['paths'].items() for method,op in methods.items()
            if method=='get' and 'billing' in path and 'usage' in path]
assert len(candidates)==1, [(path,list(methods)) for path,methods in spec['paths'].items() if 'usage' in path]
path,operation=candidates[0]
params=operation.setdefault('parameters',[])
if not any(param.get('name')=='worker_id' for param in params):
    params.append({'name':'worker_id','in':'query','required':False,'schema':{'type':'string','format':'uuid'},'description':'Filter by the Worker charged for compute. Organization usage authority is still required.'})
s=Path('scripts/workers/stress.ts');text=s.read_text()
assert text.count("'getBillingUsage'")==1
text=text.replace("'getBillingUsage'",repr(operation['operationId']))
p.write_text(json.dumps(spec,indent=2)+'\n');s.write_text(text)
print('RESPONSE_SCHEMAS',changed,'BILLING_OPERATION',operation['operationId'],path)
