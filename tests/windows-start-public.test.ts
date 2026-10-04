import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {dirname,join,delimiter} from 'node:path';
import {mkdir,writeFile} from 'node:fs/promises';
import {command,createSandbox} from './support.js';
import {installAgent,stopInstalled} from './installed-support.js';

test('Windows npm start closes its caller after disabled-task fallback while its owned background remains alive',{skip:process.platform!=='win32',timeout:240_000},async()=>{
  const s=await createSandbox();let state:string|undefined;
  const observations:unknown[]=[];const started=performance.now();
  const record=(stage:string,details:object={})=>observations.push({stage,elapsedMs:Math.round(performance.now()-started),...details});
  const evidence=process.env.SKYNET_WINDOWS_START_EVIDENCE??s.directory;
  try{
    await mkdir(evidence,{recursive:true});
    const home=join(s.directory,'isolated user with spaces'),bin=join(home,'bin'),codex=join(home,'.codex'),local=join(home,'AppData','Local'),roaming=join(home,'AppData','Roaming');
    for(const path of [bin,codex,local,roaming,join(home,'tmp')])await mkdir(path,{recursive:true});
    // Only host discovery is synthetic; enrollment, npm shim, user task and background are real.
    for(const [name,scope,packageName,entry,version] of [['codex','@openai','codex','bin/codex.js','codex-cli 0.157.1'],['claude','@anthropic-ai','claude-code','cli.js','2.1.281 (Claude Code)']]){
      await writeFile(join(bin,name+'.cmd'),'@echo off\r\n');const file=join(bin,'node_modules',scope!,packageName!,entry!);await mkdir(dirname(file),{recursive:true});await writeFile(file,`console.log(${JSON.stringify(version)})`);
    }
    const env:NodeJS.ProcessEnv={...Object.fromEntries(['SystemRoot','WINDIR','COMSPEC','PATHEXT','ProgramFiles','ProgramFiles(x86)','ProgramData'].filter(key=>process.env[key]).map(key=>[key,process.env[key]])),
      PATH:[bin,dirname(process.execPath),join(process.env.SystemRoot!,'System32'),join(process.env.SystemRoot!,'System32','WindowsPowerShell','v1.0')].join(delimiter),
      HOME:home,USERPROFILE:home,APPDATA:roaming,LOCALAPPDATA:local,XDG_STATE_HOME:join(home,'state'),CODEX_HOME:codex,CLAUDE_CONFIG_DIR:join(home,'.claude'),TEMP:join(home,'tmp'),TMP:join(home,'tmp')};
    const employee=await s.provision('启动边界合成员工'),origin=await s.startServer();
    const installed=await installAgent(s.directory,origin,env,employee.enrollmentCredential);state=installed.status.stateDirectory;
    record('installed',{background:installed.status.background});assert.equal(installed.status.background,'running');
    const taskEnv={...env,SKYNET_TEST_TASK:installed.status.autostart.taskName};
    await command('powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from('Disable-ScheduledTask -TaskName $env:SKYNET_TEST_TASK | Out-Null','utf16le').toString('base64')],taskEnv);
    await installed.run('stop');record('stopped-disabled-task');
    const fallback=await new Promise<any>((resolve,reject)=>{
      const child=spawn('powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from('& $env:SKYNET_TEST_SHIM start; exit $LASTEXITCODE','utf16le').toString('base64')],
        {env:{...env,SKYNET_TEST_SHIM:join(installed.prefix,'skynet.cmd')},windowsHide:true,stdio:['pipe','pipe','pipe']});
      let stdout='',bytes=0,done=false,status:any;const commandStarted=performance.now();
      const finish=(error?:Error)=>{if(done)return;done=true;clearTimeout(timer);if(error)reject(error);else resolve(status);};
      const timer=setTimeout(()=>{record('deadline',{commandMs:Math.round(performance.now()-commandStarted),exitCode:child.exitCode,signalCode:child.signalCode,stdoutBytes:bytes,statusReceived:!!status});
        if(child.exitCode===null)child.kill('SIGKILL');child.stdout.destroy();child.stderr.destroy();finish(new Error('Public npm start did not close within its unchanged 120s command deadline'));},120_000);
      child.stdout.on('data',(part:Buffer)=>{bytes+=part.length;if(bytes>1024*1024){child.kill('SIGKILL');finish(new Error('Public start output exceeded 1MiB'));return;}stdout+=part.toString();
        if(!status&&stdout.endsWith('\n'))try{status=JSON.parse(stdout);record('status-output',{commandMs:Math.round(performance.now()-commandStarted),background:status.background,taskState:status.autostart?.taskState,fallback:!!status.autostart?.fallback?.observedAt});}catch{}});
      child.stderr.on('data',part=>record('stderr',{bytes:part.length}));
      child.once('error',error=>finish(error));child.once('exit',(code,signal)=>record('caller-exit',{commandMs:Math.round(performance.now()-commandStarted),code,signal}));
      child.once('close',(code,signal)=>{record('caller-close',{commandMs:Math.round(performance.now()-commandStarted),code,signal});finish(code===0?undefined:new Error('Public npm start exited unsuccessfully'));});child.stdin.end();
    });
    assert.equal(fallback.background,'running');assert.equal(fallback.autostart.taskState,'Disabled');assert.equal(fallback.autostart.state,'degraded');assert.ok(fallback.autostart.fallback?.observedAt);
    const still=JSON.parse(await installed.run('status'));assert.equal(still.background,'running');assert.equal(still.deviceId,installed.status.deviceId);assert.equal(still.worker.instance,fallback.worker.instance);assert.equal(still.supervisor.instance,fallback.supervisor.instance);
    record('background-survives-caller');
  }finally{
    await writeFile(join(evidence,'start-observations.json'),JSON.stringify({fixture:s.directory,observations},null,2));
    if(state)await stopInstalled(state);await s.close();
  }
});
