import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { setTimeout } from 'node:timers/promises';
import { initializeControl } from '../apps/collector/runtime-control.js';
import { command, createSandbox, stop, syntheticSession } from './support.js';

export async function collectorRuntimeFixture() {
  const sandbox = await createSandbox(), state = join(sandbox.directory, 'installed-runtime'), home = join(sandbox.directory, 'isolated-home');
  const nativeRoot = join(home, '.codex', 'sessions'), runtime = resolve('.'), cli = join(runtime, 'dist/apps/collector/cli.js');
  const env: NodeJS.ProcessEnv = { ...Object.fromEntries(['SystemRoot','WINDIR','COMSPEC','PATHEXT','PATH'].map(key=>[key,process.env[key]])),
    HOME:home, USERPROFILE:home, LOCALAPPDATA:join(home,'local'), APPDATA:join(home,'roaming'), CODEX_HOME:join(home,'.codex'), CLAUDE_CONFIG_DIR:join(home,'.claude') };
  let child: ChildProcess | undefined, closed = true, diagnostic = '';
  const run = (action: string, directory = state, input = '') => command(process.execPath,[cli,action,'--state',directory],env,input,{timeoutMs:20_000,maxOutputBytes:4*1024*1024});
  try {
  const origin = await sandbox.startServer(), employee = await sandbox.provision('routing fairness synthetic employee'), installationId = randomUUID();
  const response = await fetch(origin+'/api/devices/enroll',{method:'POST',headers:{Authorization:`Bearer ${employee.enrollmentCredential}`,'Content-Type':'application/json'},
    body:JSON.stringify({installationId,name:'synthetic-routing-fairness'})});
  assert.equal(response.status,200);const device=await response.json();
  await mkdir(state,{recursive:true});await mkdir(nativeRoot,{recursive:true});
  await writeFile(join(state,'identity.json'),JSON.stringify({...device,server:origin,installationId}));
  const clients=['codex-cli','codex-desktop'].map(source=>({source,detected:true,version:'0.160.0',executable:null,nativeRoot,
    configPath:join(home,'.codex','hooks.json'),configured:true,capability:'unverified',notice:'synthetic fixture'}));
  await writeFile(join(state,'installation.json'),JSON.stringify({version:1,deploymentId:'synthetic-runtime-routing',node:process.execPath,launcher:cli,
    runtime,installedAt:new Date().toISOString(),clients,configurations:[]}));
  for(const {source} of clients){const directory=join(state,'sources',source);await mkdir(join(directory,'spool'),{recursive:true});
    await writeFile(join(directory,'settings.json'),JSON.stringify({sharedIdentity:'../../identity.json',nativeRoot,source,sourceVersion:'0.160.0',sourceOs:process.platform,enrolledAt:device.enrolledAt}));}
  await initializeControl(state);
  const api=(path:string)=>fetch(origin+path,{headers:{Authorization:`Bearer ${employee.readerCredential}`}});
  const status=async()=>JSON.parse(await run('status'));
  async function start(){assert.equal(closed,true);closed=false;diagnostic='';
    child=spawn(process.execPath,[cli,'background','--state',state],{env,windowsHide:true,stdio:['ignore','ignore','pipe']});
    child.stderr!.on('data',part=>{diagnostic=(diagnostic+part).slice(-4096);});child.once('close',()=>{closed=true;});child.once('error',error=>{diagnostic=error.message;closed=true;});
  }
  async function stopRuntime(){if(!child)return;try{if(!closed)await run('stop');const deadline=Date.now()+20_000;
    while(!closed&&Date.now()<deadline)await setTimeout(100);assert.equal(closed,true,'owned supervisor exits after authenticated stop');
  }finally{await stop(child);child=undefined;closed=true;}}
  async function native(originator='codex-tui'){
    const value=await syntheticSession(nativeRoot),lines=value.bytes.toString('utf8').split('\n'),meta=JSON.parse(lines[0]!);
    Object.assign(meta.payload,{source:'vscode',originator,cli_version:'0.160.0'});lines[0]=JSON.stringify(meta);const bytes=Buffer.from(lines.join('\n'));
    await writeFile(value.transcriptPath,bytes);return {...value,bytes};
  }
  return {...sandbox,state,nativeRoot,inbox:join(state,'inbox/codex'),api,status,start,stopRuntime,native,run,
    assertRunning:()=>assert.equal(closed,false,`owned runtime exited: ${diagnostic}`),
    close:async()=>{try{await stopRuntime();}finally{await sandbox.close();}}};
  } catch(error) { await sandbox.close(); throw error; }
}
