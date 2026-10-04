import {createHash} from 'node:crypto';
import {mkdir,readFile,writeFile,lstat} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {z} from 'zod';
import {dimKeys,type CapabilityAssessment} from '../../packages/contracts/assessment.js';
import type {CapabilityPeople} from '../../packages/contracts/capability-people.js';
import type {UsageOutputPage} from '../../packages/contracts/usage-output.js';

// An operator-only artifact generator. Every request is a fixed, authenticated GET;
// it never publishes parameters, changes app state or interprets a reference as approval.
const hash=z.string().regex(/^[a-f0-9]{64}$/),text=z.string().trim().min(1).max(2000);
const inputSchema=z.object({origin:z.url(),peopleVersion:hash,employeeIds:z.array(z.uuid()).min(1).max(1000)
  .refine(ids=>new Set(ids).size===ids.length,'样本员工不能重复'),
  sample:z.object({kind:z.enum(['synthetic','pilot']),label:text,authorizationReference:text.nullable(),knownBiases:z.array(text).min(1).max(30)}).strict()
}).strict().refine(input=>input.sample.kind==='synthetic'?input.sample.authorizationReference===null:!!input.sample.authorizationReference,
  '实际试点需要已登记的授权引用；合成验证不填写真实授权引用');
const json=(value:unknown)=>JSON.stringify(value,null,2)+'\n';
const canonical=(value:unknown)=>JSON.stringify(value,(_key,item)=>item&&typeof item==='object'&&!Array.isArray(item)
  ?Object.fromEntries(Object.entries(item).sort(([a],[b])=>a.localeCompare(b))):item);
const digest=(value:string)=>createHash('sha256').update(value).digest('hex');
function distribution(values:(number|null)[]){
  const known=values.filter((value):value is number=>value!==null).sort((a,b)=>a-b),middle=Math.floor(known.length/2);
  const boundaries=[0,20,40,60,80,100];
  return {known:known.length,unknown:values.length-known.length,min:known[0]??null,max:known.at(-1)??null,
    median:known.length?(known.length%2?known[middle]!:(known[middle-1]!+known[middle]!)/2):null,
    bands:boundaries.slice(0,-1).map((from,index)=>({from,to:boundaries[index+1]!,includeUpper:index===4,
      count:known.filter(value=>value>=from&&(index===4?value<=boundaries[index+1]!:value<boundaries[index+1]!)).length}))};
}
const cell=(value:unknown)=>String(value??'未知').replace(/[\r\n]+/g,' ').replaceAll('|','\\|').replaceAll('<','&lt;').replaceAll('>','&gt;');
async function main(){
  if(process.argv.length!==4)throw new Error('用法：npm run calibration -- <样本清单.json> <新的输出目录>');
  const input=inputSchema.parse(JSON.parse(await readFile(resolve(process.argv[2]!),'utf8'))),output=resolve(process.argv[3]!);
  const origin=new URL(input.origin);
  if(origin.protocol!=='https:'||origin.username||origin.password||origin.pathname!=='/'||origin.search||origin.hash)throw new Error('origin 必须为不含路径、凭据或查询参数的 HTTPS 站点');
  const token=process.env.SKYNET_READER_CREDENTIAL;if(!token)throw new Error('请设置 SKYNET_READER_CREDENTIAL');
  try{await lstat(output);throw new Error('输出目录已存在；请使用新目录保留原资料');}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
  async function get<T>(path:string):Promise<T>{
    const response=await fetch(origin.origin+path,{headers:{Authorization:`Bearer ${token}`},redirect:'error',signal:AbortSignal.timeout(30000)});
    if(!response.ok)throw new Error(`固定资料读取失败：HTTP ${response.status} ${path.split('?')[0]}`);
    let size=0;const parts:Uint8Array[]=[];
    const reader=response.body!.getReader();try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;
      if(size>32*1024*1024)throw new Error('单份固定资料超过 32 MiB 上限');parts.push(value);}}finally{await reader.cancel();}
    return JSON.parse(Buffer.concat(parts).toString('utf8')) as T;
  }
  const people=await get<CapabilityPeople>('/api/capability-people/export?version='+input.peopleVersion);
  if(people.version!==input.peopleVersion||people.nextOffset!==null)throw new Error('员工一览不是完整的指定固定版本');
  const selected=new Set(input.employeeIds),cards=people.employees.filter(person=>selected.has(person.employeeId))
    .sort((a,b)=>a.employee.localeCompare(b.employee,'zh-CN')||a.employeeId.localeCompare(b.employeeId));
  if(cards.length!==selected.size)throw new Error('样本包含固定员工一览中不存在的员工');
  const usage=await get<UsageOutputPage>('/api/usage-output/export?'+new URLSearchParams({period:people.selection.period,version:people.usageVersion}));
  if(usage.version!==people.usageVersion||usage.nextOffset!==null)throw new Error('用量资料不是完整的指定固定版本');
  const assessments:CapabilityAssessment[]=[];
  for(const card of cards){
    const assessment=await get<CapabilityAssessment>(`/api/assessments/${card.employeeId}/export?version=${card.assessmentVersion}`);
    if(assessment.version!==card.assessmentVersion||assessment.employeeId!==card.employeeId||assessment.modelVersion!==people.modelVersion||assessment.inputs.usageVersion!==people.usageVersion
      ||assessment.inputs.baselineVersion!==people.baselineVersion||assessment.inputs.frontierVersion!==people.frontierVersion||assessment.inputPage.nextOffset!==null)throw new Error('评估与固定员工一览的来源版本不一致');
    assessments.push(assessment);
  }
  const parameters=await get<Record<string,unknown>>('/api/assessment-models/'+people.modelVersion);
  const sessions=usage.sessions.filter(session=>session.selected&&session.sessions>0&&selected.has(session.employeeId));
  const coverage=[...new Set(sessions.map(session=>session.source))].sort().map(source=>{
    const mine=sessions.filter(session=>session.source===source);
    return {source,employees:new Set(mine.map(session=>session.employeeId)).size,sessions:new Set(mine.map(session=>session.sessionId)).size,
      incompleteSessions:new Set(mine.filter(session=>!session.sourceInputsComplete).map(session=>session.sessionId)).size,
      unknownReasons:[...new Set(mine.flatMap(session=>session.unknownReasons))].sort()};
  });
  const pending=assessments.filter(value=>value.level==='待定').length;
  const report={format:'skynet-calibration-1',origin:origin.origin,sample:input.sample,
    inputs:{peopleVersion:people.version,modelVersion:people.modelVersion,usageVersion:people.usageVersion,baselineVersion:people.baselineVersion,frontierVersion:people.frontierVersion},
    selection:people.selection,range:usage.scope,dataAsOf:usage.dataAsOf,
    review:{state:input.sample.kind==='synthetic'?'pending-real-pilot':'pending-human-review',authorizationVerified:false,parameterDecision:null,releaseApproval:null},
    cohort:{employees:assessments.length,sessions:assessments.reduce((n,person)=>n+person.sample.sessions,0),prompts:assessments.reduce((n,person)=>n+person.sample.prompts,0)},
    distributions:{index:distribution(assessments.map(value=>value.index)),dimensions:Object.fromEntries(dimKeys.map(key=>[key,distribution(assessments.map(value=>value.dims[key].score))])),
      confidence:Object.fromEntries(['高','中','低'].map(key=>[key,assessments.filter(value=>value.confidence===key).length])),
      levels:Object.fromEntries(['较好','一般','需提升','待定'].map(key=>[key,assessments.filter(value=>value.level===key).length])),
      pending:{numerator:pending,denominator:assessments.length,value:pending/assessments.length}},
    coverage,models:[{version:people.modelVersion,parameters}],
    employees:assessments.map(value=>({employeeId:value.employeeId,employee:value.employee,assessment:value,
      profileUrl:origin.origin+'/#profile?'+new URLSearchParams({employeeId:value.employeeId,version:value.version}),
      issues:[...new Set([...(value.sample.sessions===0?['暂无会话']:[]),...(value.confidence==='低'?[value.reason]:[]),...value.coverageIssues])],
      metricStates:dimKeys.flatMap(key=>value.dims[key].metrics.filter(metric=>metric.state!=='scored').map(metric=>({key:metric.key,state:metric.state,reason:metric.reason})))}))};
  const serialized=json(report);if(Buffer.byteLength(serialized)>32*1024*1024)throw new Error('校准资料超过 32 MiB 上限，请缩小明确样本');
  const rows=Object.entries(report.distributions.dimensions).map(([key,value])=>`| ${assessments[0]!.dims[key as typeof dimKeys[number]].label} | ${value.known} | ${value.unknown} | ${value.min??'未知'} | ${value.median??'未知'} | ${value.max??'未知'} |`);
  const review=[`# ${cell(input.sample.label)}`, '',input.sample.kind==='synthetic'?'合成流程验证；尚未完成真实试点。':'实际试点资料待人工复核；所填授权引用尚未核验。','',
    `固定模型：${people.modelVersion}`,`范围：${usage.scope.from} 至 ${usage.scope.to}（北京时间）；方案：${people.selection.preset}`,
    `样本：${report.cohort.employees} 人 / ${report.cohort.sessions} 会话 / ${report.cohort.prompts} 条提示词`,
    `可信度：高 ${report.distributions.confidence.高} / 中 ${report.distributions.confidence.中} / 低 ${report.distributions.confidence.低}`,
    `待定：${pending}/${assessments.length}（${pending/assessments.length*100}%）`, '',
    '| 维度 | 已知人数 | 未知人数 | 最小值 | 中位数 | 最大值 |','| --- | --- | --- | --- | --- | --- |',...rows,'',
    '## 客户端覆盖','',...coverage.map(value=>`- ${value.source}：${value.employees} 人，${value.sessions} 个逻辑会话，${value.incompleteSessions} 个来源不完整。`),
    ...(coverage.length?[]:['没有纳入统计的客户端会话。']),'','客户端具体版本与未接入设备不由固定用量导出证明，需在试点登记中核对。','',
    '## 已登记偏差','',...input.sample.knownBiases.map(value=>'- '+cell(value)),'','## 逐人核查（按姓名）','',
    ...report.employees.map(value=>`- [${cell(value.employee)}](${value.profileUrl})：${value.assessment.level}；${cell(value.issues.join('；')||'未触发样本或覆盖提示')}。指标证据保存在 calibration.json 的固定评估中。`),'',
    '## 人工复核与发布记录','',`授权范围引用：${cell(input.sample.authorizationReference??'待登记（本次为合成验证）')}`,
    '异常个例及原句依据：待复核。以上提示只帮助选择核查对象，不自动判定异常。',
    '参数建议：待填写。每项注明当前值、建议值、对应分布/固定评估/原句和预期影响；也可建议维持现值。',
    '用户确认：待提供具体报告版本、参数差异和确认记录。',
    '模型发布：未执行。整体参数变更经确认后作为新代码版本发布，再生成新资料包比较；保留本目录和旧评估。',
    '全员开放门槛：未验收。此工具不执行试点签收、模型发布、通知或付费分析。',''].join('\n');
  const manifest={format:'skynet-calibration-manifest-1',version:digest(canonical(report)),input,
    files:[{path:'calibration.json',sha256:digest(serialized)},{path:'review.md',sha256:digest(review)}]};
  await mkdir(output,{recursive:false});await writeFile(join(output,'calibration.json'),serialized,{flag:'wx'});await writeFile(join(output,'review.md'),review,{flag:'wx'});
  await writeFile(join(output,'manifest.json'),json(manifest),{flag:'wx'});process.stdout.write(json({version:manifest.version,output}));
}
main().catch(error=>{process.stderr.write((error instanceof Error?error.message:'校准资料生成失败')+'\n');process.exitCode=1;});
