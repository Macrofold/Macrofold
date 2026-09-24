# Temporary, checksum-pinned recovery of the reviewed edit from this branch.
# The verification workflow removes this file after applying the source changes.
import hashlib
import urllib.request
source = urllib.request.urlopen('https://raw.githubusercontent.com/Macrofold/Macrofold/8ea5b09a567e66d5afee991d60482e3f2a471ab8/scripts/workers/resume-edit.py', timeout=30).read()
assert hashlib.sha1(b'blob '+str(len(source)).encode()+b'\0'+source).hexdigest() == '794c0401a30ec782e8ac228b65e84b2eb6b6e1a6'
text = source.decode()
old = '''replace(p,"{ provider: selected, phase: run.config.worker_id ? 'provision' : 'input', inputOffset: 0, failures: 0 }", "{ provider: selected, phase: 'provision', inputOffset: 0, failures: 0 }")'''
new = '''replace(p,"phase: run.config.worker_id ? 'provision' : 'input',", "phase: 'provision',")'''
assert text.count(old) == 1
exec(compile(text.replace(old, new), 'reviewed-runtime-unification', 'exec'))
