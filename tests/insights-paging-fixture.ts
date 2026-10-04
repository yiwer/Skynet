import {randomUUID} from 'node:crypto';
import {assessmentFixture} from './assessment-fixture.js';

// The same ordinary 20-turn shape as AC32: 80 business records, all tool
// results retained, and only two representative model outcomes.
export async function insightPagingFixture(){
  const f=await assessmentFixture();
  try{
    const owner=await f.owner('分页洞察合成员工'),id=randomUUID();
    const time=(seconds:number)=>new Date(f.base.getTime()+seconds*1000).toISOString();
    const count=(n:number,timestamp:string)=>({timestamp,type:'event_msg',payload:{type:'token_count',info:{total_token_usage:{input_tokens:n*100,cached_input_tokens:n*20,output_tokens:n*25,reasoning_output_tokens:0,total_tokens:n*125}}}});
    const rows:object[]=[{timestamp:time(0),type:'session_meta',payload:{id}},count(0,new Date(Date.now()-86400000).toISOString())];
    for(let turn=0;turn<20;turn++)rows.push(
      {timestamp:time(turn*40+1),type:'response_item',payload:{type:'message',role:'user',content:[{type:'input_text',text:`请求 ${turn} elements=3：核查合成接口`}]}},
      {timestamp:time(turn*40+1),type:'event_msg',payload:{type:'task_started',turn_id:id+'/'+turn}},
      {timestamp:time(turn*40+2),type:'response_item',payload:{type:'function_call',name:'exec_command',call_id:id+'/'+turn,arguments:JSON.stringify({cmd:'node --test synthetic.test.js'})}},
      {timestamp:time(turn*40+3),type:'response_item',payload:{type:'function_call_output',call_id:id+'/'+turn,output:'# tests 3\n# pass 3\n# fail 0\n'}},
      {timestamp:time(turn*40+4),type:'response_item',payload:{type:'message',role:'assistant',content:[{type:'output_text',text:turn===0?'声称 1 项结果':'继续完成本轮'}]}},
      {timestamp:time(turn*40+5),type:'event_msg',payload:{type:'task_complete',turn_id:id+'/'+turn}},count(turn+1,time(turn*40+6)));
    const record=await f.upload(owner,rows,id,{project:'/synthetic/ac32/project-0'});
    const analysisId=await f.analyze(owner,record.snapshotId,{representativeOutcomes:true,verifyPreparedJob:{prompts:20,replies:20,outcomes:2}});
    return {...f,owner,record,analysisId,path:`/api/snapshots/${record.snapshotId}/insights`};
  }catch(error){await f.close();throw error;}
}

export function pageRows(view:any,section:string):any[]{
  if(['prompts','replies','outcomes','suggestions'].includes(section))return view.inferences?.[section]??[];
  if(section==='appliedCorrections'||section==='pendingCorrections')return view.corrections?.[section==='appliedCorrections'?'appliedIds':'pendingIds']??[];
  const match=/^(codeChanges|tests|commits)(Evidence|Contributions)$/.exec(section);
  if(!match)throw new Error('Unexpected public section '+section);
  return view.facts[match[1]!][match[2]==='Evidence'?'evidence':'contributions'];
}
