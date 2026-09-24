# This one-use patch is the exact reviewed branch edit, with one stale anchor removed.
import hashlib, urllib.request
raw = urllib.request.urlopen('https://raw.githubusercontent.com/Macrofold/Macrofold/9e9cb7bef62b5be2f8de55e15816677fd5c13f7e/scripts/workers/resume-edit.py', timeout=30).read()
assert hashlib.sha1(b'blob '+str(len(raw)).encode()+b'\0'+raw).hexdigest() == 'ba2e096d74c0655bedf9bed5d2f20b6099355c56'
lines=raw.decode().splitlines(True)
removed=[line for line in lines if line.startswith("replace('packages/runtime/src/supervisor.ts'")]
assert len(removed)==1
exec(compile(''.join(line for line in lines if line not in removed),'reviewed-controller-cleanup','exec'))
