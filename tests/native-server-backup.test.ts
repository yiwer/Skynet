import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { createInterface } from 'node:readline';
import { mkdir,readFile,readdir,realpath,rename,writeFile,access } from 'node:fs/promises';
import { join,dirname,relative } from 'node:path';
import { randomUUID,createHash } from 'node:crypto';
import { setTimeout } from 'node:timers/promises';
import { createSandbox,command } from './support.js';
import { backupHelper } from './backup-support.js';
import { digest } from '../apps/server/database.js';

// Explicit native opt-in. CLI binaries are real, all provider responses and
// workspaces synthetic. No hooks, Task, setup/install or real user config.
test('server disaster recovery supplies packages for actual isolated Codex and Claude continuation',{timeout:240000},async()=>{
  const codex=process.env.SKYNET_CODEX_CLI,claude=process.env.SKYNET_CLAUDE_RUNTIME;assert.ok(codex&&claude);assert.equal(process.platform,'win32');assert.equal(process.arch,'x64');
  const source=await createSandbox(),directory=await realpath(source.directory);let target:Awaited<ReturnType<typeof createSandbox>>|undefined;
  const codexRequests:any[]=[],claudeRequests:any[]=[];let native:Awaited<ReturnType<typeof codexClient>>|undefined;
  const codexUser='SKYNET_BACKUP_CODEX_CONTEXT_271',codexTool='SKYNET_BACKUP_CODEX_TOOL_382',claudeUser='SKYNET_BACKUP_CLAUDE_CONTEXT_493',claudeTool='SKYNET_BACKUP_CLAUDE_TOOL_504';
  const codexProvider=createServer(async(request,response)=>{
    try{let raw='';for await(const part of request)raw+=part;if(request.method!=='POST'){response.writeHead(200,{'Content-Type':'application/json'});response.end('{"data":[]}');return;}
      const body=JSON.parse(raw);codexRequests.push(body);const n=codexRequests.length;
      const item=n===1?{id:'fc_backup',type:'function_call',status:'completed',call_id:'call_backup',name:'skynet_fixture_read',arguments:'{}'}:{id:`msg_${n}`,type:'message',status:'completed',role:'assistant',phase:'final_answer',content:[{type:'output_text',text:'Synthetic native turn complete.',annotations:[]}]};
      const result={id:`resp_${n}`,object:'response',created_at:Math.floor(Date.now()/1000),status:'completed',model:'skynet-fixture',output:[item],usage:{input_tokens:20,output_tokens:10,total_tokens:30}};
      response.writeHead(200,{'Content-Type':'text/event-stream'});const send=(type:string,fields:object)=>response.write(`event: ${type}\ndata: ${JSON.stringify({type,...fields})}\n\n`);
      send('response.created',{response:{...result,status:'in_progress',output:[]}});send('response.output_item.added',{output_index:0,item:{...item,status:'in_progress'}});send('response.output_item.done',{output_index:0,item});send('response.completed',{response:result});response.end();
    }catch{response.writeHead(500);response.end();}
  });
  const claudeSourceWorkspace=join(directory,'claude-source-workspace');
  const claudeProvider=createServer(async(request,response)=>{
    try{let raw='';for await(const part of request)raw+=part;const body=JSON.parse(raw||'{}');if(!request.url?.startsWith('/v1/messages')){response.writeHead(200,{'Content-Type':'application/json'});response.end('{}');return;}
      if(request.url.includes('/count_tokens')){response.writeHead(200,{'Content-Type':'application/json'});response.end('{"input_tokens":100}');return;}
      claudeRequests.push(body);const blocks=(body.messages??[]).flatMap((message:any)=>Array.isArray(message.content)?message.content:[]);
      const block=blocks.some((block:any)=>block.type==='tool_result')?{type:'text',text:'Synthetic native turn complete.'}:{type:'tool_use',id:'toolu_backup_read',name:'Read',input:{file_path:join(claudeSourceWorkspace,'marker.txt')}};
      const reason=block.type==='tool_use'?'tool_use':'end_turn',message={id:`msg_${randomUUID().replaceAll('-','')}`,type:'message',role:'assistant',model:body.model,content:[block],stop_reason:reason,stop_sequence:null,usage:{input_tokens:100,output_tokens:20}};
      if(!body.stream){response.writeHead(200,{'Content-Type':'application/json'});response.end(JSON.stringify(message));return;}
      response.writeHead(200,{'Content-Type':'text/event-stream'});const send=(type:string,value:unknown)=>response.write(`event: ${type}\ndata: ${JSON.stringify(value)}\n\n`);
      send('message_start',{type:'message_start',message:{...message,content:[],stop_reason:null,usage:{input_tokens:100,output_tokens:0}}});send('content_block_start',{type:'content_block_start',index:0,content_block:block.type==='tool_use'?{...block,input:{}}:{type:'text',text:''}});
      send('content_block_delta',{type:'content_block_delta',index:0,delta:block.type==='tool_use'?{type:'input_json_delta',partial_json:JSON.stringify(block.input)}:{type:'text_delta',text:block.text}});send('content_block_stop',{type:'content_block_stop',index:0});send('message_delta',{type:'message_delta',delta:{stop_reason:reason,stop_sequence:null},usage:{output_tokens:20}});send('message_stop',{type:'message_stop'});response.end();
    }catch{response.writeHead(500);response.end();}
  });
  const systemEnvironment=()=>Object.fromEntries(['SystemRoot','WINDIR','PATH','PATHEXT','COMSPEC','ProgramFiles','ProgramFiles(x86)','ProgramData'].filter(key=>process.env[key]).map(key=>[key,process.env[key]]));
  const codexEnvironment=(home:string)=>({...systemEnvironment(),CODEX_HOME:home,HOME:join(directory,'codex-isolated-user'),USERPROFILE:join(directory,'codex-isolated-user'),TEMP:join(directory,'native-tmp'),TMP:join(directory,'native-tmp'),APPDATA:join(directory,'codex-appdata'),LOCALAPPDATA:join(directory,'codex-localappdata')});
  async function codexClient(home:string,cwd:string){
    const child=spawn(codex!,['--no-daemon','app-server','--stdio'],{env:codexEnvironment(home),cwd,windowsHide:true,stdio:['pipe','pipe','pipe']});let stderr='';child.stderr.setEncoding('utf8');child.stderr.on('data',part=>stderr+=part);
    const events:any[]=[],pending=new Map<number,{resolve:(value:any)=>void;reject:(error:Error)=>void;timer:NodeJS.Timeout}>();let sequence=0;
    createInterface({input:child.stdout}).on('line',line=>{const item=JSON.parse(line);events.push(item);
      if(item.method==='item/tool/call'&&item.id!==undefined)child.stdin.write(JSON.stringify({id:item.id,result:{success:item.params.tool==='skynet_fixture_read',contentItems:[{type:'inputText',text:codexTool}]}})+'\n');
      else if(!item.method&&item.id!==undefined&&pending.has(item.id)){const waiter=pending.get(item.id)!;clearTimeout(waiter.timer);pending.delete(item.id);item.error?waiter.reject(new Error(JSON.stringify(item.error))):waiter.resolve(item.result);}
    });
    const fail=(error:Error)=>{for(const waiter of pending.values()){clearTimeout(waiter.timer);waiter.reject(error);}pending.clear();};child.on('error',fail);child.on('exit',code=>fail(new Error(`Owned native Codex exited${code}: ${stderr}`)));
    const rpc=(method:string,params:unknown)=>new Promise<any>((resolve,reject)=>{const id=++sequence,timer=globalThis.setTimeout(()=>{pending.delete(id);reject(new Error(`Owned native ${method} deadline: ${stderr}`));},25000);pending.set(id,{resolve,reject,timer});child.stdin.write(JSON.stringify({id,method,params})+'\n');});
    const close=async()=>{if(child.exitCode!==null||child.signalCode!==null)return;const exited=once(child,'exit');child.stdin.end();const timer=globalThis.setTimeout(()=>child.kill(),3000);try{await exited;}finally{clearTimeout(timer);}};
    try{await rpc('initialize',{clientInfo:{name:'skynet_backup_native',version:'1'},capabilities:{experimentalApi:true}});child.stdin.write(JSON.stringify({method:'initialized',params:{}})+'\n');}catch(error){await close();throw error;}
    return {rpc,events,close,turn:async(threadId:string,text:string)=>{const prior=events.length;await rpc('turn/start',{threadId,input:[{type:'text',text}]});for(let tick=0;tick<250;tick++){const done=events.slice(prior).find(event=>event.method==='turn/completed');if(done){assert.equal(done.params.turn.status,'completed');return;}await setTimeout(100);}throw new Error('Owned native turn deadline');}};
  }
  async function claudeEnvironment(home:string,config:string){for(const path of [home,config,join(home,'tmp'),join(home,'appdata'),join(home,'localappdata')])await mkdir(path,{recursive:true});
    return {...systemEnvironment(),HOME:home,USERPROFILE:home,HOMEDRIVE:home.slice(0,2),HOMEPATH:home.slice(2),APPDATA:join(home,'appdata'),LOCALAPPDATA:join(home,'localappdata'),TEMP:join(home,'tmp'),TMP:join(home,'tmp'),CLAUDE_CONFIG_DIR:config,CLAUDE_CODE_TMPDIR:join(home,'tmp'),CLAUDE_CODE_GIT_BASH_PATH:'C:\\Program Files\\Git\\bin\\bash.exe',ANTHROPIC_BASE_URL:`http://127.0.0.1:${(claudeProvider.address() as{port:number}).port}`,ANTHROPIC_API_KEY:'synthetic-loopback-only',CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC:'1',DISABLE_AUTOUPDATER:'1'};
  }
  async function claudeTurn(env:NodeJS.ProcessEnv,cwd:string,id:string,prompt:string,resume=false){
    const args=['--print','--output-format','stream-json','--verbose','--setting-sources','user','--strict-mcp-config','--mcp-config','{"mcpServers":{}}','--tools','Read','--allowedTools','Read','--permission-prompts','none','--model','claude-sonnet-4-5','--system-prompt','Use only the isolated synthetic fixture.',resume?'--resume':'--session-id',id];
    const output=await new Promise<string>((resolve,reject)=>{const child=spawn(claude!,args,{env,cwd,windowsHide:true,stdio:['pipe','pipe','pipe']});let output='',errors='';child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');child.stdout.on('data',part=>output+=part);child.stderr.on('data',part=>errors+=part);const timer=globalThis.setTimeout(()=>{child.kill();reject(new Error('Owned Claude exceeded45s'));},45000);child.once('error',error=>{clearTimeout(timer);reject(error);});child.once('close',code=>{clearTimeout(timer);code===0?resolve(output):reject(new Error(`Owned Claude exited${code}: ${errors}`));});child.stdin.end(prompt);});
    const result=output.trim().split('\n').map(line=>JSON.parse(line)).findLast(row=>row.type==='result');assert.equal(result?.is_error,false);assert.equal(result?.terminal_reason,'completed');assert.deepEqual(result?.permission_denials,[]);return output;
  }
  try{
    for(const provider of [codexProvider,claudeProvider]){provider.listen(0,'127.0.0.1');await once(provider,'listening');}
    const codexHome=join(directory,'codex-source'),claudeHome=join(directory,'claude-source'),claudeConfig=join(claudeHome,'.claude'),codexWorkspace=join(directory,'codex-source-workspace');
    for(const path of [codexHome,codexWorkspace,claudeSourceWorkspace,join(directory,'native-tmp'),join(directory,'codex-isolated-user')])await mkdir(path,{recursive:true});await writeFile(join(claudeSourceWorkspace,'marker.txt'),claudeTool+'\n');
    const configureCodex=async(home:string)=>writeFile(join(home,'config.toml'),`model = "skynet-fixture"\nmodel_provider = "skynet-local"\ncli_auth_credentials_store = "file"\n[analytics]\nenabled = false\n[feedback]\nenabled = false\n[model_providers.skynet-local]\nname = "Synthetic loopback"\nbase_url = "http://127.0.0.1:${(codexProvider.address() as{port:number}).port}/v1"\nwire_api = "responses"\nrequires_openai_auth = false\n`);
    await configureCodex(codexHome);const claudeEnv=await claudeEnvironment(claudeHome,claudeConfig);
    assert.equal((await command(codex,['--version'],codexEnvironment(codexHome))).trim(),'codex-cli 0.157.1');assert.equal((await command(claude,['--version'],claudeEnv)).trim(),'2.1.281 (Claude Code)');
    const employee=await source.provision('原生灾备合成来源'),origin=await source.startServer();const headers={Authorization:`Bearer ${employee.readerCredential}`};
    const api=(path:string,token=employee.readerCredential,body?:unknown)=>fetch(origin+path,{headers:{Authorization:`Bearer ${token}`,...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{method:'POST',body:JSON.stringify(body)})});
    const devices=await Promise.all(['Codex','Claude'].map(name=>api('/api/devices/enroll',employee.enrollmentCredential,{installationId:randomUUID(),name:'synthetic-native-'+name}).then(response=>response.json())));
    native=await codexClient(codexHome,codexWorkspace);const parameters={model:'skynet-fixture',modelProvider:'skynet-local',approvalPolicy:'never',sandbox:'read-only'};
    const started=await native.rpc('thread/start',{...parameters,cwd:codexWorkspace,dynamicTools:[{type:'function',name:'skynet_fixture_read',description:'Return one synthetic fixed marker; no side effects.',inputSchema:{type:'object',properties:{},additionalProperties:false}}]});const threadId=started.thread.id;
    await native.turn(threadId,codexUser);const codexRead=await native.rpc('thread/read',{threadId,includeTurns:true});assert.ok(native.events.some(event=>event.method==='item/tool/call'));await native.close();native=undefined;
    const codexPath=codexRead.thread.path??started.thread.path;assert.ok(!relative(await realpath(codexHome),await realpath(codexPath)).startsWith('..'));const codexBytes=await readFile(codexPath);assert.ok(codexBytes.includes(Buffer.from(codexTool)));
    const claudeId=randomUUID();await claudeTurn(claudeEnv,claudeSourceWorkspace,claudeId,claudeUser+' Read marker.txt.');
    let claudePath='';for(const folder of await readdir(join(claudeConfig,'projects'),{withFileTypes:true}))if(folder.isDirectory()){const path=join(claudeConfig,'projects',folder.name,claudeId+'.jsonl');try{await access(path);claudePath=path;break;}catch{}}assert.ok(claudePath);const claudeBytes=await readFile(claudePath);assert.ok(claudeBytes.includes(Buffer.from(claudeTool)));
    const archived:any[]=[];for(const [index,item]of [{id:threadId,source:'codex-cli',version:'0.157.1',bytes:codexBytes,cwd:codexWorkspace},{id:claudeId,source:'claude-code-cli',version:'2.1.281',bytes:claudeBytes,cwd:claudeSourceWorkspace}].entries()){
      const device=devices[index],hash=digest(item.bytes);assert.equal((await fetch(origin+'/api/chunks/'+hash,{method:'PUT',headers:{Authorization:`Bearer ${device.deviceCredential}`,'Content-Type':'application/octet-stream'},body:item.bytes})).status,201);
      const reply=await api('/api/snapshots',device.deviceCredential,{protocolVersion:1,sourceSessionId:item.id,source:item.source,sourceVersion:item.version,sourceOs:'win32',project:item.cwd,hash,byteLength:item.bytes.length,qualifiedAt:new Date().toISOString(),capability:'unverified'});assert.equal(reply.status,200);archived.push({...item,ack:await reply.json()});
    }
    const helper=await backupHelper(directory),backupDirectory=join(directory,'backups');const backup=JSON.parse(await helper.run({action:'backup',rawDirectory:'/data/raw',backupDirectory:'/backups',failureDomain:'same-host'},source.containerDatabaseUrl,[{source:source.env.RAW_DIRECTORY!,target:'/data/raw',readonly:true},{source:backupDirectory,target:'/backups'}]));assert.equal(backup.receipt.objects,2);
    await source.stopServer();const sourceRaw=await realpath(source.env.RAW_DIRECTORY!);assert.equal(dirname(sourceRaw),directory);await rename(sourceRaw,join(directory,'source-server-raw-unavailable'));
    for(const path of [codexHome,claudeHome,codexWorkspace,claudeSourceWorkspace]){assert.equal(dirname(path),directory);assert.equal(dirname(path+'-unavailable'),directory);await rename(path,path+'-unavailable');}
    for(const path of [codexHome,claudeHome,codexWorkspace,claudeSourceWorkspace])await assert.rejects(access(path),{code:'ENOENT'});
    target=await createSandbox();const restored=JSON.parse(await helper.run({action:'restore',bundleDirectory:'/bundle',rawDirectory:'/data/raw'},target.containerDatabaseUrl,[{source:join(backupDirectory,backup.receipt.id),target:'/bundle',readonly:true},{source:target.env.RAW_DIRECTORY!,target:'/data/raw'}]));const targetOrigin=await target.startServer();
    const receipts:any[]=[];for(const item of archived){const raw=await fetch(targetOrigin+`/api/snapshots/${item.ack.snapshotId}/raw`,{headers});assert.equal(raw.status,200);assert.deepEqual(Buffer.from(await raw.arrayBuffer()),item.bytes);
      const response=await fetch(targetOrigin+`/api/snapshots/${item.ack.snapshotId}/recovery`,{headers});assert.equal(response.status,200);const packagePath=join(directory,item.source+'.skynet-recovery.json');await writeFile(packagePath,Buffer.from(await response.arrayBuffer()));
      const home=join(directory,item.source+'-restored'),args=['dist/apps/collector/cli.js','restore','--package',packagePath,'--target',home,'--runtime',item.source==='codex-cli'?codex:claude,...(item.source==='codex-cli'?['--source-version','0.157.1']:[])];
      const receipt=JSON.parse(await command(process.execPath,args,target.env));assert.deepEqual(await readFile(receipt.rolloutPath),item.bytes);assert.equal(receipt.sourceSessionId,item.id);assert.deepEqual((await readdir(home)).sort(),item.source==='codex-cli'?['restore-receipt.json','sessions']:['projects','restore-receipt.json']);receipts.push(receipt);
    }
    const codexTarget=join(directory,'codex-cli-restored'),codexTargetWorkspace=join(directory,'codex-restored-workspace');await mkdir(codexTargetWorkspace);await configureCodex(codexTarget);native=await codexClient(codexTarget,codexTargetWorkspace);const resumed=await native.rpc('thread/resume',{...parameters,threadId,cwd:codexTargetWorkspace});assert.equal(resumed.thread.id,threadId);const beforeCodex=codexRequests.length;await native.turn(threadId,'Continue using only preserved prior context and tool history.');
    const codexHistory=JSON.stringify(codexRequests[beforeCodex]?.input);assert.ok(codexHistory.includes(codexUser));assert.ok(codexHistory.includes(codexTool));assert.ok(codexHistory.includes('skynet_fixture_read'));const continued=await native.rpc('thread/read',{threadId,includeTurns:true});assert.ok(continued.thread.turns.length>=2);await native.close();native=undefined;
    const claudeTarget=join(directory,'claude-code-cli-restored'),claudeTargetWorkspace=join(directory,'claude-restored-workspace');await mkdir(claudeTargetWorkspace);const claudeTargetEnv=await claudeEnvironment(join(directory,'claude-restored-user'),claudeTarget);const beforeClaude=claudeRequests.length;await claudeTurn(claudeTargetEnv,claudeTargetWorkspace,claudeId,'Continue using only preserved prior context and tool history.',true);const claudeHistory=JSON.stringify(claudeRequests[beforeClaude]?.messages);assert.ok(claudeHistory.includes(claudeUser));assert.ok(claudeHistory.includes(claudeTool));const blocks=claudeRequests[beforeClaude].messages.flatMap((message:any)=>Array.isArray(message.content)?message.content:[]);assert.ok(blocks.some((block:any)=>block.type==='tool_use'&&block.name==='Read'));assert.ok(blocks.some((block:any)=>block.type==='tool_result'&&JSON.stringify(block.content).includes(claudeTool)));
    const toolHash=async(path:string)=>createHash('sha256').update(await readFile(path)).digest('hex');
    await writeFile(join(directory,'native-server-backup-public.json'),JSON.stringify({testedAt:new Date().toISOString(),sourceHomesAndWorkspacesUnavailable:true,sourceServerStopped:true,sourceRawPathUnavailable:true,serverDownloadedPackagesOnly:true,backup:backup.receipt,restored,native:[{source:'codex-cli',version:'0.157.1',binarySha256:await toolHash(codex),contextAndToolHistory:true,turns:continued.thread.turns.length,requests:codexRequests.length},{source:'claude-code-cli',version:'2.1.281',binarySha256:await toolHash(claude),contextAndToolHistory:true,requests:claudeRequests.length}],snapshots:archived.map(item=>({id:item.ack.snapshotId,source:item.source,hash:digest(item.bytes),byteLength:item.bytes.length})),boundary:'actual Windows CLI backends; public synthetic binding/upload; loopback only; no normal installed capture/Task/Desktop UI/paid provider/second operator'},null,2));console.log(`Actual native server backup evidence: ${directory}`);
  }finally{try{await native?.close();}finally{for(const provider of [codexProvider,claudeProvider]){provider.closeAllConnections();provider.close();}await target?.close();await source.close();}}
});
