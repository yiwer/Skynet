import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import {writeFile,unlink} from 'node:fs/promises';
import {join} from 'node:path';
import {digest} from '../apps/server/database.js';
import {assessmentFixture} from './assessment-fixture.js';

test('continuous real source availability changes fail bounded profile composition and retain its fixed history',{timeout:120000},async()=>{
  const f=await assessmentFixture();let restore:()=>void=()=>{},source:{path:string;bytes:Buffer}|undefined;
  try{
    const owner=await f.owner('Changing profile source'),original=await f.session(owner,{prompts:3}),path='/api/capability-profiles/'+owner.employeeId;
    const first=await f.api(owner,path);assert.equal(first.status,200);const fixed=await first.json();
    source={path:join(f.directory,'raw',owner.deviceId,digest(original.bytes)),bytes:original.bytes};
    let present=true;
    const query=pg.Client.prototype.query;
    const change=async()=>{if(present)await unlink(source!.path);else await writeFile(source!.path,source!.bytes);present=!present;};
    // Change a real original after the last work snapshot is read. Query data
    // is never replaced; only the filesystem timing is controlled.
    pg.Client.prototype.query=function(this:pg.Client,...args:any[]){
      const sql=typeof args[0]==='string'?args[0]:args[0]?.text;
      if(sql!=='SELECT date FROM daily_report_periods WHERE employee_id=$1 AND date BETWEEN $2 AND $3 ORDER BY date')return (query as any).apply(this,args);
      const callback=args.at(-1);
      if(typeof callback==='function'){
        args[args.length-1]=(error:unknown,result:unknown)=>{if(error)callback(error);else void change().then(()=>callback(null,result),callback);};
        return (query as any).apply(this,args);
      }
      return (query as any).apply(this,args).then(async(result:unknown)=>{await change();return result;});
    } as any;
    restore=()=>{pg.Client.prototype.query=query;};
    const changing=await f.api(owner,path);restore();
    assert.equal(changing.status,409,await changing.clone().text());assert.match((await changing.json()).error,/来源正在更新/);
    const historical=await f.api(owner,path+'?version='+fixed.version);assert.equal(historical.status,200);assert.deepEqual(await historical.json(),fixed);
    await writeFile(source.path,source.bytes);const recovered=await f.api(owner,path);assert.equal(recovered.status,200);assert.deepEqual(await recovered.json(),fixed);
  }finally{restore();if(source)await writeFile(source.path,source.bytes);await f.close();}
});
