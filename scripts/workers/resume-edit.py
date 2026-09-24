import hashlib,urllib.request
raw=urllib.request.urlopen('https://raw.githubusercontent.com/Macrofold/Macrofold/847fe2eb9f0d449c9a2005c7713347e5589dc332/scripts/workers/resume-edit.py',timeout=30).read()
assert hashlib.sha1(b'blob '+str(len(raw)).encode()+b'\0'+raw).hexdigest()=='8a5f4eca1396ceaa2c8629812007db18eba8062d'
lines=raw.decode().splitlines(True)
obsolete=[line for line in lines if line.startswith(('replace(p,"import { getNativeRun, type NativeRunRow }"','replace(p,"const rows = (await tx.query<{ id: string }>','replace(p,"  const runs: NativeRunRow[] = [];'))]
assert len(obsolete)==3
exec(compile(''.join(line for line in lines if line not in obsolete),'reviewed-aggregate-scaling','exec'))
