import './build-runtime';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { harnessNames } from '../packages/contracts/harnesses';

const selected=process.argv.slice(2);
const harnesses=selected.length?selected:harnessNames;
if(harnesses.some(value=>!harnessNames.includes(value as typeof harnessNames[number])))throw new Error('Choose a supported native harness.');
const fixtures=path.resolve(import.meta.dirname,'../tests/fixtures');
const image=process.env.DOCKER_RUNTIME_IMAGE || 'platform-runtime:0.1.0';
async function run(harness:string,mode:'concurrent'|'export'|'import',directory:string) {
  const name=`worker-acceptance-${randomUUID()}`;
  const args=['run','--rm','--name',name,'--network','none','--init','--cpus=2','--memory=4g','--memory-swap=4g','--pids-limit=4096',
    '--security-opt=no-new-privileges','--cap-drop=ALL',
    ...['CHOWN','DAC_OVERRIDE','FOWNER','SETGID','SETUID','KILL'].map(value=>`--cap-add=${value}`),
    '--mount',`type=bind,src=${fixtures},dst=/tests,readonly`,
    '--mount',`type=bind,src=${directory},dst=/worker-exchange${mode==='import'?',readonly':''}`,
    image,'node','/tests/worker-native.mjs',harness,mode];
  try { await new Promise<void>((resolve,reject)=>{
    const child=spawn('docker',args,{stdio:'inherit'});
    const timer=setTimeout(()=>child.kill('SIGTERM'),300000);
    child.once('error',error=>{clearTimeout(timer);reject(error);});
    child.once('exit',code=>{clearTimeout(timer);code===0?resolve():reject(new Error(`${harness} ${mode} acceptance failed (${code}).`));});
  }); } finally {
    await new Promise<void>(resolve=>{
      const cleanup=spawn('docker',['rm','-f',name],{stdio:'ignore'});
      cleanup.once('error',()=>resolve());cleanup.once('close',()=>resolve());
    });
  }
}
for(const harness of harnesses) {
  const directory=await mkdtemp(path.join(tmpdir(),'macrofold-worker-native-'));
  try {
    await run(harness,'concurrent',directory);
    await run(harness,'export',directory);
    // A different container has no surviving process or disk cache from the exported Host.
    await run(harness,'import',directory);
  } finally {await rm(directory,{recursive:true,force:true});}
}
